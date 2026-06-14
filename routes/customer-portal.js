const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

// Middleware for Portal Auth
const authenticatePortal = (req, res, next) => {
    const token = req.cookies.portal_token;
    if (!token) {
        return res.redirect('/login');
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'customer') {
            return res.redirect('/login');
        }
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('portal_token');
        return res.redirect('/login');
    }
};

// ==========================================
// VIEWS
// ==========================================

router.get('/login', (req, res) => {
    if (req.cookies.portal_token) {
        try {
            jwt.verify(req.cookies.portal_token, JWT_SECRET);
            return res.redirect('/dashboard');
        } catch (_) {}
    }
    res.render('customer-portal/login');
});

router.get('/', (req, res) => res.redirect('/dashboard'));

router.get('/dashboard', authenticatePortal, (req, res) => {
    res.render('customer-portal/dashboard', { user: req.user, page: 'dashboard' });
});

router.get('/rewards', authenticatePortal, (req, res) => {
    res.render('customer-portal/rewards', { user: req.user, page: 'rewards' });
});

router.get('/tickets', authenticatePortal, (req, res) => {
    res.render('customer-portal/tickets', { user: req.user, page: 'tickets' });
});

// ==========================================
// APIs
// ==========================================

router.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        // Mock authentication for portal
        // In real system, check against customers table
        const [customers] = await db.query('SELECT * FROM customers WHERE phone = ? LIMIT 1', [phone]);
        
        if (customers.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const customer = customers[0];
        // Skip password check for demo simplicity, or add password to customers table
        
        const token = jwt.sign({ id: customer.id, name: customer.name, role: 'customer' }, JWT_SECRET, { expiresIn: '1d' });
        res.cookie('portal_token', token, { httpOnly: true });
        res.json({ success: true, message: 'Login successful' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/api/auth/logout', (req, res) => {
    res.clearCookie('portal_token');
    res.json({ success: true, message: 'Logged out' });
});

router.get('/api/me', authenticatePortal, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, name, phone, email, address, points, reward_points FROM customers WHERE id = ?', [req.user.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Support Tickets API
router.get('/api/tickets', authenticatePortal, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM tickets WHERE customer_id = ? ORDER BY created_at DESC', [req.user.id]);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/api/tickets', authenticatePortal, async (req, res) => {
    try {
        const { title, description, priority } = req.body;
        const ticketNumber = 'TICK-' + Date.now();
        await db.query(
            'INSERT INTO tickets (ticket_number, customer_id, title, description, priority, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())', 
            [ticketNumber, req.user.id, title, description, priority || 'medium', 'open']
        );
        res.json({ success: true, message: 'Ticket created successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Reward Redemption
router.get('/api/rewards/items', authenticatePortal, async (req, res) => {
    try {
        const [items] = await db.query('SELECT * FROM reward_items WHERE is_active = 1 ORDER BY points_required ASC');
        res.json({ success: true, data: items });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/api/rewards/redeem', authenticatePortal, async (req, res) => {
    try {
        const { item_id } = req.body;
        const customer_id = req.user.id;
        
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
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
