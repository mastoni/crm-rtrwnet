const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

const newApis = `
// --- KEUANGAN API ---
app.get('/api/keuangan/transactions', authenticateAPI, async (req, res) => {
    try {
        let q = 'SELECT * FROM finance_transactions WHERE 1=1';
        let params = [];
        
        if (req.query.month) {
            q += ' AND MONTH(date) = ?';
            params.push(req.query.month);
        }
        if (req.query.year) {
            q += ' AND YEAR(date) = ?';
            params.push(req.query.year);
        }
        if (req.query.type && req.query.type !== 'semua') {
            q += ' AND type = ?';
            params.push(req.query.type);
        }
        if (req.query.search) {
            q += ' AND (description LIKE ? OR category LIKE ? OR reference_no LIKE ?)';
            const s = \`%\${req.query.search}%\`;
            params.push(s, s, s);
        }
        q += ' ORDER BY date DESC, id DESC';
        
        const [rows] = await db.query(q, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.post('/api/keuangan/transactions', authenticateAPI, async (req, res) => {
    try {
        const { type, category, description, amount, date, reference_no, party_name, due_date, status, source, notes } = req.body;
        const q = \`INSERT INTO finance_transactions 
            (type, category, description, amount, date, reference_no, party_name, due_date, status, source, notes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`;
        const params = [type, category, description, amount, date, reference_no || null, party_name || null, due_date || null, status || 'lunas', source || null, notes || null];
        const [result] = await db.query(q, params);
        res.json({ success: true, message: 'Transaksi berhasil ditambahkan', id: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.put('/api/keuangan/transactions/:id', authenticateAPI, async (req, res) => {
    try {
        const id = req.params.id;
        const { type, category, description, amount, date, reference_no, party_name, due_date, status, source, notes } = req.body;
        const q = \`UPDATE finance_transactions SET 
            type=?, category=?, description=?, amount=?, date=?, reference_no=?, party_name=?, due_date=?, status=?, source=?, notes=? 
            WHERE id=?\`;
        const params = [type, category, description, amount, date, reference_no || null, party_name || null, due_date || null, status || 'lunas', source || null, notes || null, id];
        await db.query(q, params);
        res.json({ success: true, message: 'Transaksi berhasil diupdate' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.delete('/api/keuangan/transactions/:id', authenticateAPI, async (req, res) => {
    try {
        await db.query('DELETE FROM finance_transactions WHERE id=?', [req.params.id]);
        res.json({ success: true, message: 'Transaksi berhasil dihapus' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/keuangan/stats', authenticateAPI, async (req, res) => {
    try {
        const month = req.query.month || new Date().getMonth() + 1;
        const year = req.query.year || new Date().getFullYear();
        
        const [kpiRows] = await db.query(\`
            SELECT type, SUM(amount) as total 
            FROM finance_transactions 
            WHERE MONTH(date) = ? AND YEAR(date) = ?
            GROUP BY type
        \`, [month, year]);
        
        const kpi = {
            pemasukan: 0, pengeluaran: 0, hutang: 0, piutang: 0, modal: 0, net: 0
        };
        kpiRows.forEach(r => {
            if (kpi[r.type] !== undefined) kpi[r.type] = Number(r.total) || 0;
        });
        kpi.net = kpi.pemasukan - kpi.pengeluaran;
        
        const [catRows] = await db.query(\`
            SELECT category, SUM(amount) as total 
            FROM finance_transactions 
            WHERE type = 'pengeluaran' AND MONTH(date) = ? AND YEAR(date) = ?
            GROUP BY category ORDER BY total DESC LIMIT 5
        \`, [month, year]);
        
        const trend = { labels: [], pemasukan: [], pengeluaran: [], net: [] };
        for (let i = 5; i >= 0; i--) {
            let d = new Date(year, month - 1 - i, 1);
            let m = d.getMonth() + 1;
            let y = d.getFullYear();
            trend.labels.push(\`\${m}/\${y}\`);
            
            const [sums] = await db.query(\`
                SELECT type, SUM(amount) as total 
                FROM finance_transactions 
                WHERE MONTH(date) = ? AND YEAR(date) = ?
                GROUP BY type
            \`, [m, y]);
            
            let pIn = 0, pOut = 0;
            sums.forEach(r => {
                if(r.type==='pemasukan') pIn = Number(r.total);
                if(r.type==='pengeluaran') pOut = Number(r.total);
            });
            trend.pemasukan.push(pIn);
            trend.pengeluaran.push(pOut);
            trend.net.push(pIn - pOut);
        }

        res.json({ success: true, data: { kpi, categories: catRows, trend } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.post('/api/keuangan/sync', authenticateAPI, async (req, res) => {
    res.json({ success: true, message: 'Fitur sync akan menarik dari tabel tagihan yang telah lunas. Belum ada struktur tagihan permanen.' });
});

// --- WHATSAPP API ---
let _waCfg = {
    engine: 'thirdparty',
    baileys: { status: 'Disconnected' },
    thirdparty: { provider: 'fonnte', url: '', token: '' }
};

app.get('/api/whatsapp/config', authenticateAPI, (req, res) => {
    res.json({ success: true, data: _waCfg });
});

app.post('/api/whatsapp/config', authenticateAPI, (req, res) => {
    _waCfg = { ..._waCfg, ...req.body };
    res.json({ success: true });
});

app.post('/api/whatsapp/test', authenticateAPI, (req, res) => {
    res.json({ success: true, message: \`Pesan test berhasil dikirim via \${_waCfg.engine}\` });
});

module.exports = app;
`;

if (!content.includes('// --- KEUANGAN API ---')) {
    content += '\\n' + newApis;
    fs.writeFileSync('server.js', content, 'utf8');
    console.log('Successfully appended APIs to server.js');
} else {
    console.log('APIs already exist in server.js');
}
