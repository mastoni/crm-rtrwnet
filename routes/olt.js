const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all OLTs
router.get('/', async (req, res) => {
    try {
        const [olts] = await db.query('SELECT * FROM olts ORDER BY id DESC');
        res.json({ success: true, data: olts });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// GET single OLT
router.get('/:id', async (req, res) => {
    try {
        const [olts] = await db.query('SELECT * FROM olts WHERE id = ?', [req.params.id]);
        if (olts.length === 0) return res.status(404).json({ success: false, message: 'OLT not found' });
        res.json({ success: true, data: olts[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// CREATE OLT
router.post('/', async (req, res) => {
    const { name, host, brand, community, snmpPort, mibMode, enabled } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO olts (name, host, brand, community, snmpPort, mibMode, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, host, brand || 'hsgq', community || 'public', snmpPort || 161, mibMode || 'auto', enabled === undefined ? true : enabled]
        );
        res.json({ success: true, message: 'OLT created', data: { id: result.insertId } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// UPDATE OLT
router.put('/:id', async (req, res) => {
    const { name, host, brand, community, snmpPort, mibMode, enabled } = req.body;
    try {
        await db.query(
            'UPDATE olts SET name=?, host=?, brand=?, community=?, snmpPort=?, mibMode=?, enabled=? WHERE id=?',
            [name, host, brand, community, snmpPort, mibMode, enabled, req.params.id]
        );
        res.json({ success: true, message: 'OLT updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// DELETE OLT
router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM olts WHERE id=?', [req.params.id]);
        res.json({ success: true, message: 'OLT deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// TEST OLT SNMP
router.post('/:id/test', async (req, res) => {
    // Mock SNMP Test implementation
    res.json({ success: true, sysName: 'OLT-Test', sysDescr: 'Mock OLT Device' });
});

// SYNC ONE OLT
router.post('/:id/sync', async (req, res) => {
    try {
        await db.query('UPDATE olts SET lastSync=NOW() WHERE id=?', [req.params.id]);
        res.json({ success: true, message: 'Sync queued' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// SYNC ALL
router.post('/sync-all', async (req, res) => {
    try {
        await db.query('UPDATE olts SET lastSync=NOW() WHERE enabled=1');
        res.json({ success: true, message: 'Sync all queued' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
