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

        // Retrieve settings
        const [settingsRows] = await db.query('SELECT setting_key, setting_value FROM app_settings');
        const settings = {};
        settingsRows.forEach(r => { settings[r.setting_key] = r.setting_value; });

        let pointsPerAmount = parseInt(settings.reward_points_per_amount, 10);
        if (isNaN(pointsPerAmount) || pointsPerAmount <= 0) pointsPerAmount = 1000;
        
        const onTimeBonus = parseInt(settings.reward_points_ontime_bonus, 10) || 10;

        let basePoints = Math.floor(parseFloat(invoice.amount) / pointsPerAmount);
        let rewardEnabledForPkg = true;

        if (customer.package_id) {
            const [pkgs] = await db.query('SELECT reward_points, is_reward_enabled FROM packages WHERE id = ?', [customer.package_id]);
            if (pkgs.length > 0) {
                const pkg = pkgs[0];
                if (!pkg.is_reward_enabled) {
                    rewardEnabledForPkg = false;
                } else if (pkg.reward_points > 0) {
                    basePoints = pkg.reward_points;
                }
            }
        }

        if (!rewardEnabledForPkg) {
            console.log(`[REWARD] Rewards are disabled for customer package: ${customer.package_id}. Skipping.`);
            return;
        }

        // WIB Timezone normalization
        const todayWIB = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        let dueDateStr = invoice.due_date;
        if (dueDateStr instanceof Date) {
            dueDateStr = dueDateStr.toISOString().split('T')[0];
        } else if (typeof dueDateStr === 'string') {
            dueDateStr = dueDateStr.split('T')[0].split(' ')[0];
        }

        const d1 = new Date(todayWIB);
        const d2 = new Date(dueDateStr);
        const diffTime = d2.getTime() - d1.getTime(); // Positif = lebih awal, Negatif = terlambat
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        
        let totalPoints = basePoints;
        let description = '';

        if (diffDays === 0) {
            // Tepat waktu (H-0)
            totalPoints += onTimeBonus;
            description = `Pembayaran tagihan ${invoice.invoice_number} (Base: ${basePoints}) + Bonus Tepat Waktu: ${onTimeBonus}`;
        } else if (diffDays < 0) {
            // Terlambat (H+n)
            totalPoints = basePoints;
            description = `Pembayaran tagihan ${invoice.invoice_number} (Base: ${basePoints}) (Bonus Hilang) - Pembayaran terlambat ${Math.abs(diffDays)} hari.`;
        } else {
            // Lebih awal (H-n)
            const daysEarly = diffDays;
            const extraBonus = Math.round(Math.pow(1.1, daysEarly));
            totalPoints = basePoints + onTimeBonus + extraBonus;
            description = `Pembayaran tagihan ${invoice.invoice_number} (Base: ${basePoints}) + Bonus Tepat Waktu: ${onTimeBonus} + Reward Awal ${daysEarly} hari: ${extraBonus}`;
        }

        // Idempotency check (prevent double reward)
        const [alreadyRewarded] = await db.query(
            "SELECT id FROM reward_history WHERE customer_id = ? AND reference_id = ? AND type = 'earn_payment' LIMIT 1",
            [customer.id, invoiceId]
        );
        if (alreadyRewarded.length > 0) {
            console.log(`[REWARD] Invoice ${invoiceId} already rewarded, skipping.`);
            return;
        }

        // Simpan transaksi point
        await db.query(`
            INSERT INTO reward_history (customer_id, points, type, description, reference_id)
            VALUES (?, ?, 'earn_payment', ?, ?)
        `, [customer.id, totalPoints, description, invoice.id]);

        // Update poin pelanggan (Zero-floor protected)
        await db.query(`
            UPDATE customers SET 
                points = GREATEST(0, points + ?), 
                reward_points = GREATEST(0, reward_points + ?), 
                last_reward_at = NOW()
            WHERE id = ?
        `, [totalPoints, totalPoints, customer.id]);

        console.log(`[REWARD] Processed invoice ${invoiceId} for ${customer.name}: ${totalPoints} points (${description})`);

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
