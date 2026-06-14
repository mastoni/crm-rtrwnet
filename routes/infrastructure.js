const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM infrastructure_points ORDER BY id DESC');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/', async (req, res) => {
    const { name, type, latitude, longitude, description, status } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO infrastructure_points (name, type, latitude, longitude, description, status) VALUES (?, ?, ?, ?, ?, ?)',
            [name, type, latitude, longitude, description, status || 'active']
        );
        res.json({ success: true, data: { id: result.insertId } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/:id', async (req, res) => {
    const { name, type, latitude, longitude, description, status } = req.body;
    try {
        await db.query(
            'UPDATE infrastructure_points SET name=?, type=?, latitude=?, longitude=?, description=?, status=? WHERE id=?',
            [name, type, latitude, longitude, description, status, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM infrastructure_points WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
