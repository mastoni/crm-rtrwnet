const express = require('express');
const router = express.Router();
const db = require('../db');

// GET Stats
router.get('/stats', async (req, res) => {
    try {
        const [statusRows] = await db.query('SELECT status, COUNT(*) as count FROM assets GROUP BY status');
        const [valRows] = await db.query('SELECT SUM(purchase_price) as total_value FROM assets');
        const [catRows] = await db.query(`
      SELECT c.name as category_name, COUNT(a.id) as count 
      FROM assets a 
      LEFT JOIN asset_categories c ON a.category_id = c.id 
      GROUP BY a.category_id
    `);

        const by_status = {};
        let total = 0;
        statusRows.forEach(r => {
            by_status[r.status] = r.count;
            total += r.count;
        });

        const by_category = catRows.map(r => ({ category: { name: r.category_name }, count: r.count }));

        res.json({
            success: true,
            data: {
                total,
                total_value: valRows[0].total_value || 0,
                by_status,
                by_category
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET Categories
router.get('/categories', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM asset_categories');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/categories', async (req, res) => {
    try {
        const slug = req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const [result] = await db.query('INSERT INTO asset_categories (name, slug, color) VALUES (?, ?, ?)', [req.body.name, slug, req.body.color || '#94a3b8']);
        res.json({ success: true, data: { id: result.insertId } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/categories/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM asset_categories WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET all Assets
router.get('/', async (req, res) => {
    try {
        const [assets] = await db.query(`
      SELECT a.*, c.name as category_name, c.color as category_color, cust.name as customer_name, cust.customer_id as cust_code, i.name as infra_name
      FROM assets a
      LEFT JOIN asset_categories c ON a.category_id = c.id
      LEFT JOIN customers cust ON a.customer_id = cust.id
      LEFT JOIN infrastructure_points i ON a.infrastructure_id = i.id
      ORDER BY a.id DESC
    `);

        const formatted = assets.map(a => ({
            ...a,
            category: { id: a.category_id, name: a.category_name, color: a.category_color },
            customer: a.customer_id ? { id: a.customer_id, name: a.customer_name, customer_id: a.cust_code } : null,
            infrastructure: a.infrastructure_id ? { id: a.infrastructure_id, name: a.infra_name } : null
        }));

        res.json({ success: true, data: formatted, pagination: { pages: 1, page: 1 } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET single Asset
router.get('/:id', async (req, res) => {
    try {
        const [assets] = await db.query('SELECT * FROM assets WHERE id=?', [req.params.id]);
        if (!assets.length) return res.status(404).json({ success: false, message: 'Asset not found' });
        res.json({ success: true, data: assets[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// CREATE Asset
router.post('/', async (req, res) => {
    const body = req.body;
    const asset_code = 'AST-' + Date.now();
    try {
        const [result] = await db.query(
            'INSERT INTO assets (asset_code, name, category_id, brand, model, serial_number, status, `condition`, purchase_date, purchase_price, purchase_vendor, warranty_until, location, customer_id, infrastructure_id, ont_device_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [asset_code, body.name, body.category_id, body.brand, body.model, body.serial_number, body.status, body.condition, body.purchase_date, body.purchase_price, body.purchase_vendor, body.warranty_until, body.location, body.customer_id, body.infrastructure_id, body.ont_device_id, body.notes]
        );
        res.json({ success: true, data: { id: result.insertId } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// UPDATE Asset
router.put('/:id', async (req, res) => {
    const body = req.body;
    try {
        await db.query(
            'UPDATE assets SET name=?, category_id=?, brand=?, model=?, serial_number=?, status=?, `condition`=?, purchase_date=?, purchase_price=?, purchase_vendor=?, warranty_until=?, location=?, customer_id=?, infrastructure_id=?, ont_device_id=?, notes=? WHERE id=?',
            [body.name, body.category_id, body.brand, body.model, body.serial_number, body.status, body.condition, body.purchase_date, body.purchase_price, body.purchase_vendor, body.warranty_until, body.location, body.customer_id, body.infrastructure_id, body.ont_device_id, body.notes, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE Asset
router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM assets WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ASSIGN Asset
router.post('/:id/assign', async (req, res) => {
    try {
        await db.query('UPDATE assets SET customer_id=?, infrastructure_id=?, location=?, notes=?, status=? WHERE id=?',
            [req.body.customer_id, req.body.infrastructure_id, req.body.location, req.body.note, 'active', req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
