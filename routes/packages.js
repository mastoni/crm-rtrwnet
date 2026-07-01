const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all packages
router.get('/', async (req, res) => {
    try {
        const [packages] = await db.query('SELECT * FROM packages ORDER BY id DESC');
        res.json({ success: true, data: packages });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// GET single package
router.get('/:id', async (req, res) => {
    try {
        const [packages] = await db.query('SELECT * FROM packages WHERE id = ?', [req.params.id]);
        if (packages.length === 0) return res.status(404).json({ success: false, message: 'Package not found' });
        res.json({ success: true, data: packages[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// CREATE package
router.post('/', async (req, res) => {
    const { name, speed_down, speed_up, price, description, category, is_active, reward_points, is_reward_enabled } = req.body;
    try {
        // Generate new ID manually in case AUTO_INCREMENT is not set
        const [[{ maxId }]] = await db.query('SELECT MAX(id) as maxId FROM packages');
        const newId = (maxId || 0) + 1;

        await db.query(
            'INSERT INTO packages (id, name, speed_down, speed_up, price, description, category, is_active, reward_points, is_reward_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [newId, name, speed_down || 0, speed_up || 0, price || 0, description || '', category || 'home', is_active === undefined ? true : is_active, reward_points || 0, is_reward_enabled === undefined ? true : is_reward_enabled]
        );
        res.json({ success: true, message: 'Package created', data: { id: newId } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// UPDATE package
router.put('/:id', async (req, res) => {
    const { name, speed_down, speed_up, price, description, category, is_active, reward_points, is_reward_enabled } = req.body;
    try {
        // Check if updating only is_active
        if (Object.keys(req.body).length === 1 && req.body.is_active !== undefined) {
            await db.query('UPDATE packages SET is_active=? WHERE id=?', [req.body.is_active, req.params.id]);
        } else if (Object.keys(req.body).length === 1 && req.body.is_reward_enabled !== undefined) {
            await db.query('UPDATE packages SET is_reward_enabled=? WHERE id=?', [req.body.is_reward_enabled, req.params.id]);
        } else {
            await db.query(
                'UPDATE packages SET name=?, speed_down=?, speed_up=?, price=?, description=?, category=?, is_active=?, reward_points=?, is_reward_enabled=? WHERE id=?',
                [name, speed_down, speed_up, price, description, category, is_active, reward_points || 0, is_reward_enabled === undefined ? true : is_reward_enabled, req.params.id]
            );
        }
        res.json({ success: true, message: 'Package updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// DELETE package
router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM packages WHERE id=?', [req.params.id]);
        res.json({ success: true, message: 'Package deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

module.exports = router;
