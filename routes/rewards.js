const express = require('express');
const router = express.Router();
const db = require('../db');

// --- HELPER FUNCTION: Process Invoice Payment Points ---
// This should be called when an invoice changes status to "paid"
async function processPaymentReward(invoiceId) {
    try {
        const [invoices] = await db.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        if (invoices.length === 0) return;
        const invoice = invoices[0];
        
        const [customers] = await db.query('SELECT * FROM customers WHERE id = ?', [invoice.customer_id]);
        if (customers.length === 0) return;
        const customer = customers[0];
        
        if (!customer.is_reward_enabled) return;

        // Hitung selisih hari antara tanggal bayar dan jatuh tempo
        const paymentDate = new Date(); // Hari ini
        paymentDate.setHours(0,0,0,0);
        
        let dueObj;
        if (invoice.due_date) {
            dueObj = new Date(invoice.due_date);
        } else {
            // Default jika tidak ada due_date, anggap tepat waktu
            dueObj = new Date();
        }
        dueObj.setHours(0,0,0,0);

        const diffTime = dueObj - paymentDate;
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)); // Positif = lebih cepat, Negatif = telat
        
        let earnedPoints = 0;
        let description = '';

        if (diffDays === 0) {
            // Tepat waktu
            earnedPoints = 10;
            description = 'Bonus bayar tepat waktu';
        } else if (diffDays > 0) {
            // Sebelum jatuh tempo
            earnedPoints = 10 + diffDays; // Bonus 10 + 1 poin per hari lebih cepat
            description = `Bonus bayar lebih awal (${diffDays} hari)`;
        } else {
            // Terlambat (diffDays < 0)
            // Pengurangan 1 hari 1 poin (berarti ditambah nilai negatif)
            earnedPoints = diffDays; 
            description = `Pengurangan poin telat bayar (${Math.abs(diffDays)} hari)`;
        }

        // Simpan transaksi point
        await db.query(`
            INSERT INTO reward_history (customer_id, points, type, description, reference_id)
            VALUES (?, ?, ?, ?, ?)
        `, [customer.id, earnedPoints, earnedPoints >= 0 ? 'earn_ontime' : 'adjustment', description, invoice.id]);

        // Update poin pelanggan
        await db.query(`
            UPDATE customers SET points = points + ?, reward_points = reward_points + ?, last_reward_at = NOW()
            WHERE id = ?
        `, [earnedPoints, earnedPoints, customer.id]);

        console.log(`[REWARD] Processed invoice ${invoiceId} for ${customer.name}: ${earnedPoints} points (${description})`);

    } catch (err) {
        console.error('[REWARD] Error processing payment reward:', err);
    }
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Get all reward items
router.get('/items', async (req, res) => {
    try {
        const [items] = await db.query('SELECT * FROM reward_items WHERE is_active = 1 ORDER BY points_required ASC');
        res.json({ success: true, data: items });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// 2. Admin: Create reward item
router.post('/items', async (req, res) => {
    try {
        const { name, description, points_required, stock, image_url } = req.body;
        await db.query(`
            INSERT INTO reward_items (name, description, points_required, stock, image_url)
            VALUES (?, ?, ?, ?, ?)
        `, [name, description, points_required, stock, image_url]);
        res.json({ success: true, message: 'Item reward berhasil ditambahkan' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// 3. Get customer reward points & history
router.get('/history/:customerId', async (req, res) => {
    try {
        const [history] = await db.query(`
            SELECT h.*, i.name as item_name 
            FROM reward_history h 
            LEFT JOIN reward_items i ON h.item_id = i.id 
            WHERE h.customer_id = ? 
            ORDER BY h.created_at DESC
        `, [req.params.customerId]);
        
        const [customer] = await db.query('SELECT points, reward_points FROM customers WHERE id = ?', [req.params.customerId]);
        
        res.json({ 
            success: true, 
            data: {
                points: customer.length > 0 ? customer[0].points : 0,
                reward_points: customer.length > 0 ? customer[0].reward_points : 0,
                history 
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// 4. Admin: Manual adjustment
router.post('/adjust', async (req, res) => {
    try {
        const { customer_id, points, description } = req.body;
        await db.query(`
            INSERT INTO reward_history (customer_id, points, type, description)
            VALUES (?, ?, 'adjustment', ?)
        `, [customer_id, points, description || 'Penyesuaian manual admin']);

        await db.query(`
            UPDATE customers SET points = points + ?, reward_points = reward_points + ?, last_reward_at = NOW()
            WHERE id = ?
        `, [points, points, customer_id]);

        res.json({ success: true, message: 'Poin berhasil disesuaikan' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// 5. Redeem Point
router.post('/redeem', async (req, res) => {
    try {
        const { customer_id, item_id } = req.body;
        
        const [customers] = await db.query('SELECT reward_points FROM customers WHERE id = ?', [customer_id]);
        if (customers.length === 0) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });
        
        const [items] = await db.query('SELECT * FROM reward_items WHERE id = ?', [item_id]);
        if (items.length === 0) return res.status(404).json({ success: false, message: 'Item tidak ditemukan' });
        
        const customer = customers[0];
        const item = items[0];

        if (customer.reward_points < item.points_required) {
            return res.status(400).json({ success: false, message: 'Poin tidak cukup' });
        }
        if (item.stock <= 0) {
            return res.status(400).json({ success: false, message: 'Stok item habis' });
        }

        // Potong poin dan kurangi stok
        await db.query('UPDATE customers SET reward_points = reward_points - ?, points = points - ? WHERE id = ?', 
            [item.points_required, item.points_required, customer_id]);
        
        await db.query('UPDATE reward_items SET stock = stock - 1 WHERE id = ?', [item_id]);

        // Simpan histori
        await db.query(`
            INSERT INTO reward_history (customer_id, item_id, points, type, status, description)
            VALUES (?, ?, ?, 'redeem', 'pending', ?)
        `, [customer_id, item_id, -item.points_required, `Penukaran item: ${item.name}`]);

        res.json({ success: true, message: 'Berhasil menukarkan poin' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

module.exports = {
    router,
    processPaymentReward
};
