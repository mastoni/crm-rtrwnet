const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const db = require('./db');
const rewardsRouter = require('./routes/rewards');
const customerPortalRouter = require('./routes/customer-portal');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

// EJS setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Subdomain Routing for Customer Portal
app.use((req, res, next) => {
    if (req.hostname.startsWith('portal.')) {
        return customerPortalRouter(req, res, next);
    }
    next();
});

// Global Default Settings
const defaultSettings = {
    company_name: 'SKMNetwork',
    company_address: 'Jl. Raya Bogor KM 45, Cibinong',
    tax_rate: '11',
    reward_points_active: '1',
    reward_point_value: '10',
    reward_redemption_threshold: '100',
    reward_point_rp_value: '1000',
    billing_due_date: '20',
    reward_points_per_amount: '1000',
    reward_points_ontime_bonus: '10',
    reward_points_reset_date: '2026-12-31'
};
app.locals.settings = { ...defaultSettings };

let _waCfg = {
    engine: 'thirdparty',
    baileys: { status: 'Disconnected' },
    thirdparty: { provider: 'fonnte', url: '', token: '' }
};

// Auto-initialize database on startup (Non-blocking fallback)
let isDbConnected = false;
async function start() {
    try {
        // Try to query to check connection
        await db.query("SELECT 1");
        isDbConnected = true;
        console.log('Database connected successfully.');

        const [tables] = await db.query("SHOW TABLES");
        if (tables.length === 0) {
            console.log('No tables found. Initializing database schema and seeds...');
            const dbInit = require('./db_init');
        }

        // Initialize Settings Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value TEXT,
                category VARCHAR(50),
                description TEXT
            )
        `);

        const [settingsRows] = await db.query('SELECT setting_key, setting_value FROM app_settings');

        if (settingsRows.length === 0) {
            console.log('Seeding default app_settings...');
            const defaults = [
                ['company_name', defaultSettings.company_name, 'general', 'Nama Perusahaan'],
                ['company_address', defaultSettings.company_address, 'general', 'Alamat Perusahaan'],
                ['tax_rate', defaultSettings.tax_rate, 'general', 'Persentase Pajak PPN'],
                ['reward_points_active', defaultSettings.reward_points_active, 'rewards', 'Fitur Reward Point Aktif (1/0)'],
                ['reward_point_value', defaultSettings.reward_point_value, 'rewards', 'Poin per pembayaran invoice'],
                ['reward_redemption_threshold', defaultSettings.reward_redemption_threshold, 'rewards', 'Minimal poin untuk ditukar'],
                ['reward_point_rp_value', defaultSettings.reward_point_rp_value, 'rewards', 'Nilai konversi 1 poin ke Rupiah'],
                ['billing_due_date', defaultSettings.billing_due_date, 'billing', 'Tanggal jatuh tempo tagihan tiap bulan'],
                ['reward_points_per_amount', defaultSettings.reward_points_per_amount, 'rewards', 'Konversi rupiah ke 1 poin dasar'],
                ['reward_points_ontime_bonus', defaultSettings.reward_points_ontime_bonus, 'rewards', 'Bonus poin bayar tepat waktu'],
                ['reward_points_reset_date', defaultSettings.reward_points_reset_date, 'rewards', 'Tanggal reset poin tahunan (YYYY-MM-DD)']
            ];
            for (let [k, v, c, d] of defaults) {
                await db.query('INSERT IGNORE INTO app_settings (setting_key, setting_value, category, description) VALUES (?, ?, ?, ?)', [k, v, c, d]);
            }
        } else {
            // Load DB settings into memory
            settingsRows.forEach(r => {
                app.locals.settings[r.setting_key] = r.setting_value;
            });
        }

        // Initialize _waCfg from DB if exists
        if (app.locals.settings.whatsapp_config) {
            try {
                _waCfg = JSON.parse(app.locals.settings.whatsapp_config);
            } catch (e) {
                console.error('Failed to parse whatsapp_config on boot:', e.message);
            }
        }

        // Run migrations
        const alterColumns = [
            { col: 'monitoring_type', type: "VARCHAR(50) DEFAULT 'api'" },
            { col: 'api_port', type: 'INT' },
            { col: 'api_username', type: 'VARCHAR(100)' },
            { col: 'api_password', type: 'VARCHAR(100)' },
            { col: 'snmp_community', type: "VARCHAR(100) DEFAULT 'public'" },
            { col: 'snmp_version', type: "VARCHAR(10) DEFAULT '2'" },
            { col: 'snmp_port', type: 'INT DEFAULT 161' }
        ];
        for (const item of alterColumns) {
            try {
                const [cols] = await db.query('SHOW COLUMNS FROM devices LIKE ?', [item.col]);
                if (cols.length === 0) {
                    await db.query(`ALTER TABLE devices ADD COLUMN ${item.col} ${item.type}`);
                    console.log(`Added column ${item.col} to devices table.`);
                }
            } catch (alterErr) {
                console.error(`Error adding column ${item.col} to devices:`, alterErr.message);
            }
        }

        // Create ont_signal_history table
        await db.query(`
            CREATE TABLE IF NOT EXISTS ont_signal_history (
                id INT PRIMARY KEY AUTO_INCREMENT,
                serial VARCHAR(100) NOT NULL,
                rx_power DECIMAL(5, 2) NOT NULL,
                tx_power DECIMAL(5, 2),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create device_metrics_history table
        await db.query(`
            CREATE TABLE IF NOT EXISTS device_metrics_history (
                id INT PRIMARY KEY AUTO_INCREMENT,
                device_id INT NOT NULL,
                cpu_load INT NOT NULL,
                memory_usage INT NOT NULL,
                disk_usage INT NOT NULL,
                rx_mbps DECIMAL(10, 2) NOT NULL,
                tx_mbps DECIMAL(10, 2) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
            )
        `);
        console.log('Database migrations completed successfully.');
    } catch (err) {
        console.warn('========================================================================');
        console.warn('PERINGATAN: Koneksi database MySQL gagal.');
        console.warn('Aplikasi akan tetap berjalan dengan menggunakan MOCK DATA statik (JSON).');
        console.warn('Pengaturan aplikasi dimuat menggunakan mode Mock/Memory.');
        console.warn('Penyebab Error:', err.message);
        console.warn('========================================================================');
    }
}
start();

// JWT Authentication Middleware for Pages
const authenticatePage = async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.redirect('/login');
    }
};

// JWT Authentication Middleware for APIs
const authenticateAPI = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.cookies.token;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
};

// WhatsApp sender helper
const sendWhatsAppMessage = async (target, message) => {
    const cfg = _waCfg || {};
    if (cfg.engine === 'thirdparty' && cfg.thirdparty?.provider === 'fonnte') {
        const url = cfg.thirdparty.url || 'https://api.fonnte.com/send';
        const token = cfg.thirdparty.token;
        if (!token) {
            throw new Error('Token Fonnte belum dikonfigurasi.');
        }

        const cleanPhone = String(target).replace(/[^0-9]/g, '');
        const response = await axios.post(url, {
            target: cleanPhone,
            message: message
        }, {
            headers: {
                'Authorization': token
            }
        });

        if (response.data && (response.data.status === true || response.data.status === 'true')) {
            await logMessage(cleanPhone, message, 'sent');
            return { success: true, data: response.data };
        } else {
            await logMessage(cleanPhone, message, 'failed');
            throw new Error(response.data?.reason || 'Gagal mengirim pesan via Fonnte');
        }
    }
    throw new Error('Engine WhatsApp tidak aktif atau provider tidak didukung');
};

const logMessage = async (phone, message, status, type = 'notification') => {
    try {
        await db.query(
            'INSERT INTO message_logs (phone, message, status, type) VALUES (?, ?, ?, ?)',
            [phone, message, status, type]
        );
    } catch (e) {
        console.error('Failed to log message to database:', e.message);
    }
};

// ============================================
// MIKROTIK BACKGROUND POLLER
// ============================================
const mikrotikCache = {
    cpu: 0,
    rx_bps: 0,
    tx_bps: 0,
    history: []
};

setInterval(async () => {
    const s = app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
    if (!host) return;
    try {
        const { RouterOSAPI } = require('node-routeros');
        const conn = new RouterOSAPI({
            host: host,
            user: s.mikrotik_user || process.env.MIKROTIK_USER || 'admin',
            password: s.mikrotik_password || process.env.MIKROTIK_PASSWORD || '',
            port: parseInt(s.mikrotik_port || process.env.MIKROTIK_PORT || 8728, 10)
        });
        conn.on('error', (err) => { /* ignore background errors */ });
        await conn.connect();
        const resources = await conn.write('/system/resource/print');
        if (resources && resources.length > 0) {
            mikrotikCache.cpu = parseInt(resources[0]['cpu-load'] || '0', 10);
        }
        const interfaces = await conn.write('/interface/monitor-traffic', ['=interface=all', '=once=']);
        let rxBytes = 0, txBytes = 0;
        interfaces.forEach(i => {
            rxBytes += parseInt(i['rx-bits-per-second'] || '0', 10);
            txBytes += parseInt(i['tx-bits-per-second'] || '0', 10);
        });
        mikrotikCache.rx_bps = rxBytes;
        mikrotikCache.tx_bps = txBytes;
        conn.close();
    } catch (err) { }
}, 5000);

setInterval(() => {
    const now = new Date();
    mikrotikCache.history.push({
        date: now.toISOString().split('T')[0],
        hour: now.getHours(),
        minute: now.getMinutes(),
        avg_download_mbps: (mikrotikCache.rx_bps / 1000000).toFixed(2),
        avg_upload_mbps: (mikrotikCache.tx_bps / 1000000).toFixed(2)
    });
    if (mikrotikCache.history.length > 60) mikrotikCache.history.shift();
}, 60000);

// Daily Penalty and Reset Poller (runs every 1 hour)
let lastPenaltyDate = '';
setInterval(async () => {
    try {
        const todayWIB = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        if (lastPenaltyDate === todayWIB) return; // Only run once per calendar day

        console.log(`[Scheduled Task] Running daily reward penalty & reset checks for: ${todayWIB}`);
        
        // 1. GLOBAL RESET CHECK
        const [settingsRows] = await db.query('SELECT setting_key, setting_value FROM app_settings');
        const settings = {};
        settingsRows.forEach(r => { settings[r.setting_key] = r.setting_value; });

        const resetDate = settings.reward_points_reset_date;
        if (resetDate) {
            const todayObj = new Date(todayWIB);
            const resetObj = new Date(resetDate.split(' ')[0]);
            if (todayObj >= resetObj) {
                // Check if already reset this year/date
                const [alreadyReset] = await db.query(
                    "SELECT id FROM reward_history WHERE type = 'reset' AND DATE(created_at) = ?",
                    [todayWIB]
                );
                if (alreadyReset.length === 0) {
                    console.log(`[Reset] Resetting all reward points today: ${todayWIB}`);
                    const [custWithPoints] = await db.query("SELECT id, reward_points FROM customers WHERE reward_points > 0");
                    for (const c of custWithPoints) {
                        await db.query(
                            "INSERT INTO reward_history (customer_id, points, type, description) VALUES (?, ?, 'reset', 'Reset tahunan Poin Reward')",
                            [c.id, -c.reward_points]
                        );
                    }
                    await db.query("UPDATE customers SET points = 0, reward_points = 0");
                }
            }
        }

        // 2. DAILY PENALTY CHECK
        const [overdueInvoices] = await db.query(`
            SELECT i.id as invoice_id, i.due_date, i.customer_id, c.name, c.reward_points 
            FROM invoices i
            JOIN customers c ON i.customer_id = c.id
            WHERE i.status = 'unpaid' AND i.due_date < ?
        `, [todayWIB]);

        for (const inv of overdueInvoices) {
            try {
                let dueDateStr = inv.due_date;
                if (dueDateStr instanceof Date) {
                    dueDateStr = dueDateStr.toISOString().split('T')[0];
                } else if (typeof dueDateStr === 'string') {
                    dueDateStr = dueDateStr.split('T')[0].split(' ')[0];
                }

                const d1 = new Date(todayWIB);
                const d2 = new Date(dueDateStr);
                const diffTime = d1.getTime() - d2.getTime();
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays <= 0) continue;

                // Basis 1.2 untuk penalti harian
                const penaltyToday = Math.round(Math.pow(1.2, diffDays));

                // Check idempotency (prevent double penalty per day)
                const [alreadyProcessed] = await db.query(
                    "SELECT id FROM reward_history WHERE customer_id = ? AND reference_id = ? AND type = 'penalty' AND DATE(created_at) = ?",
                    [inv.customer_id, inv.invoice_id, todayWIB]
                );

                if (alreadyProcessed.length > 0) continue;

                // Limit penalty so points don't go below 0
                const actualDeduction = Math.min(inv.reward_points, penaltyToday);
                if (actualDeduction > 0) {
                    const description = `Penalti harian telat bayar ${diffDays} hari (Invoice: ${inv.invoice_id})`;
                    
                    await db.query(`
                        INSERT INTO reward_history (customer_id, points, type, description, reference_id)
                        VALUES (?, ?, 'penalty', ?, ?)
                    `, [inv.customer_id, -actualDeduction, description, inv.invoice_id]);

                    await db.query(`
                        UPDATE customers SET 
                            points = GREATEST(0, points - ?), 
                            reward_points = GREATEST(0, reward_points - ?), 
                            last_reward_at = NOW()
                        WHERE id = ?
                    `, [actualDeduction, actualDeduction, inv.customer_id]);

                    console.log(`[Penalty] Deducted ${actualDeduction} points from ${inv.name} (Late ${diffDays} days)`);
                }
            } catch (err) {
                console.error(`[Penalty] Error processing invoice ${inv.invoice_id}:`, err);
            }
        }

        lastPenaltyDate = todayWIB;
    } catch (e) {
        console.error('[Scheduled Task] Error in daily reward checks:', e);
    }
}, 3600000); // Check every 1 hour

// Device Metrics Background Logger (runs every 5 minutes)
setInterval(async () => {
    try {
        if (!db) return;
        const [devices] = await db.query('SELECT * FROM devices');
        const { RouterOSAPI } = require('node-routeros');
        const snmp = require('net-snmp');

        for (const dev of devices) {
            let reachable = false;
            let cpu_load = 0;
            let memory_usage = 0;
            let disk_usage = 0;
            let rx_mbps = 0;
            let tx_mbps = 0;

            if (dev.monitoring_type === 'api' || !dev.monitoring_type) {
                const conn = new RouterOSAPI({
                    host: dev.ip_address,
                    port: dev.api_port || 8728,
                    user: dev.api_username || 'admin',
                    password: dev.api_password || ''
                });
                conn.on('error', () => {});
                try {
                    await conn.connect();
                    reachable = true;
                    
                    const resources = await conn.write('/system/resource/print');
                    if (resources && resources.length > 0) {
                        const r = resources[0];
                        cpu_load = parseInt(r['cpu-load'] || '0', 10);
                        const totalRam = parseInt(r['total-memory'] || '1', 10);
                        const freeRam = parseInt(r['free-memory'] || '0', 10);
                        memory_usage = Math.round(((totalRam - freeRam) / totalRam) * 100);
                        
                        const totalHdd = parseInt(r['total-hdd-space'] || '1', 10);
                        const freeHdd = parseInt(r['free-hdd-space'] || '0', 10);
                        disk_usage = Math.round(((totalHdd - freeHdd) / totalHdd) * 100);
                    }

                    const traffic = await conn.write('/interface/monitor-traffic', ['=interface=all', '=once=']);
                    let totalRx = 0, totalTx = 0;
                    traffic.forEach(t => {
                        totalRx += parseInt(t['rx-bits-per-second'] || '0', 10);
                        totalTx += parseInt(t['tx-bits-per-second'] || '0', 10);
                    });
                    rx_mbps = parseFloat((totalRx / 1000000).toFixed(2));
                    tx_mbps = parseFloat((totalTx / 1000000).toFixed(2));

                    conn.close();
                } catch (err) {
                    reachable = false;
                }
            } else if (dev.monitoring_type === 'snmp') {
                try {
                    const session = snmp.createSession(dev.ip_address, dev.snmp_community || 'public', {
                        port: dev.snmp_port || 161,
                        timeout: 3000,
                        retries: 1
                    });
                    await new Promise((resolve, reject) => {
                        session.get(['1.3.6.1.2.1.1.1.0'], (error, varbinds) => {
                            if (error) reject(error);
                            else {
                                reachable = true;
                                resolve();
                            }
                            session.close();
                        });
                    });
                } catch (err) {
                    reachable = false;
                }
            }

            // Update status & cpu load in DB
            await db.query(
                'UPDATE devices SET status = ?, cpu_load = ? WHERE id = ?',
                [reachable ? 'online' : 'offline', cpu_load, dev.id]
            );

            // Log to metrics history
            if (reachable) {
                await db.query(
                    'INSERT INTO device_metrics_history (device_id, cpu_load, memory_usage, disk_usage, rx_mbps, tx_mbps) VALUES (?, ?, ?, ?, ?, ?)',
                    [dev.id, cpu_load, memory_usage, disk_usage, rx_mbps, tx_mbps]
                );
            }
        }
    } catch (loggerErr) {
        console.error('Device metrics background logger error:', loggerErr.message);
    }
}, 60000 * 5);

// ============================================
// SETTINGS API
// ============================================

app.get('/api/settings', authenticateAPI, async (req, res) => {
    try {
        if (!isDbConnected) {
            return res.json({ success: true, data: app.locals.settings || {} });
        }
        const [rows] = await db.query('SELECT setting_key, setting_value, category, description FROM app_settings');
        // also return grouped by category
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.put('/api/settings', authenticateAPI, async (req, res) => {
    try {
        const settingsToUpdate = req.body; // e.g. { company_name: "X", tax_rate: "11" }
        if (!isDbConnected) {
            for (const [key, val] of Object.entries(settingsToUpdate)) {
                app.locals.settings[key] = val;
            }
            return res.json({ success: true, message: 'Settings updated in memory.' });
        }

        for (const [key, val] of Object.entries(settingsToUpdate)) {
            await db.query(
                'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [key, val, val]
            );
            // update in memory
            app.locals.settings[key] = val;
        }
        res.json({ success: true, message: 'Settings saved successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================
// PAGE ROUTES (GET)
// ============================================

app.get('/settings', authenticatePage, (req, res) => {
    res.render('settings', {
        user: { name: req.user.name, role: req.user.role },
        page: 'settings',
        title: 'Settings',
        scripts: []
    });
});

app.get('/login', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            jwt.verify(token, JWT_SECRET);
            return res.redirect('/dashboard');
        } catch (_) { }
    }
    res.render('login');
});

app.get('/', (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            jwt.verify(token, JWT_SECRET);
            return res.redirect('/dashboard');
        } catch (_) { }
    }
    res.render('landing');
});

// Helper for route registration
const registerPage = (route, viewName, scripts = []) => {
    app.get(route, authenticatePage, (req, res) => {
        res.render(viewName, {
            user: {
                name: req.user.name,
                role: req.user.role
            },
            page: viewName.replace('monitoring_', '').replace('system_', '').replace('_', '-'),
            title: viewName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            scripts: scripts
        });
    });
};

// Register page views
registerPage('/dashboard', 'dashboard', ['https://cdn.jsdelivr.net/npm/apexcharts', '/js/dashboard.js', '/js/dashboard-analytics.js']);
registerPage('/customers', 'customers', ['/js/customers.js']);
registerPage('/billing', 'billing', ['/js/billing.js']);
registerPage('/packages', 'packages', ['/js/packages.js']);
registerPage('/payments', 'payments', ['/js/payments.js', 'https://cdn.jsdelivr.net/npm/chart.js']);
registerPage('/keuangan', 'keuangan', ['/js/keuangan.js']);
registerPage('/laporan', 'laporan', ['/js/laporan.js']);
registerPage('/infrastructure', 'infrastructure', ['/js/infrastructure.js']);
registerPage('/assets', 'assets', ['https://cdn.jsdelivr.net/npm/apexcharts', '/js/assets.js']);
registerPage('/system/resources', 'system_resources', ['/js/system-resources.js']);
registerPage('/tickets', 'tickets', ['https://cdn.jsdelivr.net/npm/apexcharts', '/js/tickets.js']);
registerPage('/todos', 'todos', ['/js/todos.js']);
registerPage('/work-orders', 'work_orders', ['/js/work-orders.js']);
registerPage('/message-logs', 'message_logs', ['https://cdn.jsdelivr.net/npm/chart.js', '/js/message-logs.js']);
registerPage('/whatsapp', 'whatsapp', []);
registerPage('/wa/templates', 'wa_templates', ['/js/wa-templates.js']);
registerPage('/rewards', 'rewards', ['/js/rewards.js']);
registerPage('/customer-portal', 'customer_portal', ['/js/customer-portal.js']);

// Monitoring routes
registerPage('/monitoring/traffic', 'monitoring_traffic', ['https://cdn.jsdelivr.net/npm/apexcharts', '/js/traffic.js']);
registerPage('/monitoring/pppoe', 'monitoring_pppoe', ['/js/monitoring_pppoe.js']);
registerPage('/monitoring/queue', 'monitoring_queue', ['/js/queue.js']);
registerPage('/monitoring/ippool', 'monitoring_ippool', ['/js/ippool.js']);
registerPage('/monitoring/firewall', 'monitoring_firewall', ['/js/firewall.js']);
registerPage('/monitoring/olt', 'monitoring_olt', ['/js/olt.js']);
registerPage('/genieacs', 'genieacs', ['/js/genieacs.js']);
registerPage('/monitoring/ping', 'monitoring_ping', ['/js/ping.js']);
registerPage('/monitoring/device-monitor', 'monitoring_device-monitor', ['/js/device-monitor.js']);
registerPage('/monitoring/hotspot', 'monitoring_hotspot', []);

// Printable Invoice Route
app.get('/invoice/inv/:id', authenticatePage, async (req, res) => {
    try {
        const q = `
            SELECT i.*, 
                   c.name as customer_name, c.customer_id as customer_code, c.phone as customer_phone, c.address as customer_address, c.email as customer_email,
                   p.name as package_name, p.price as package_price, p.speed_down as package_speed_down, p.speed_up as package_speed_up
            FROM invoices i
            JOIN customers c ON i.customer_id = c.id
            LEFT JOIN packages p ON c.package_id = p.id
            WHERE i.id = ?
        `;
        const [rows] = await db.query(q, [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).send('Invoice tidak ditemukan.');
        }

        let payment = {};
        if (rows[0].status === 'paid') {
            const [pmRows] = await db.query(
                "SELECT payment_date, payment_method, reference_number FROM payments WHERE invoice_id = ? ORDER BY id DESC LIMIT 1",
                [rows[0].id]
            );
            if (pmRows.length > 0) {
                payment = pmRows[0];
            }
        }

        res.render('invoice', {
            invoice: rows[0],
            payment: payment
        });
    } catch (err) {
        console.error('Error fetching invoice details:', err);
        res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// Customer Profile Page Route
app.get('/customers/profile/:id', authenticatePage, async (req, res) => {
    try {
        const customerId = req.params.id;

        // Fetch customer + package + router info
        const [custRows] = await db.query(`
            SELECT c.*, p.name as package_name, p.price as package_price,
                   p.speed_down, p.speed_up, d.name as router_name, d.ip_address as router_ip
            FROM customers c
            LEFT JOIN packages p ON c.package_id = p.id
            LEFT JOIN devices d ON c.mikrotik_id = d.id
            WHERE c.id = ?
        `, [customerId]);

        if (custRows.length === 0) {
            return res.status(404).send('Customer tidak ditemukan.');
        }

        const customer = custRows[0];

        // Format dates
        if (customer.due_date) customer.due_date = new Date(customer.due_date).toISOString().slice(0, 10);
        if (customer.installation_date) customer.installation_date = new Date(customer.installation_date).toISOString().slice(0, 10);

        // Fetch invoice history (last 12)
        const [invoices] = await db.query(`
            SELECT * FROM invoices WHERE customer_id = ? ORDER BY id DESC LIMIT 12
        `, [customerId]);

        // Fetch payment history (last 12, via invoice join)
        const [payments] = await db.query(`
            SELECT py.*, i.invoice_number
            FROM payments py
            JOIN invoices i ON py.invoice_id = i.id
            WHERE i.customer_id = ? ORDER BY py.id DESC LIMIT 12
        `, [customerId]);

        // Fetch reward point history (last 20)
        const [rewardHistory] = await db.query(`
            SELECT rh.*, ri.name as item_name
            FROM reward_history rh
            LEFT JOIN reward_items ri ON rh.item_id = ri.id
            WHERE rh.customer_id = ? ORDER BY rh.id DESC LIMIT 20
        `, [customerId]);

        // Compute invoice stats
        const totalInvoices = invoices.length;
        const paidCount = invoices.filter(i => i.status === 'paid').length;
        const overdueCount = invoices.filter(i => i.status === 'overdue').length;
        const totalPaid = payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
        const totalPoints = parseInt(customer.reward_points || customer.points || 0);

        res.render('customer_profile', {
            user: { name: req.user.name, role: req.user.role },
            page: 'customers',
            title: 'Profil Customer — ' + customer.name,
            scripts: [],
            customer,
            invoices,
            payments,
            rewardHistory,
            stats: { totalInvoices, paidCount, overdueCount, totalPaid, totalPoints }
        });
    } catch (err) {
        console.error('Error fetching customer profile:', err);
        res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// ============================================
// API ROUTES (AUTH)
// ============================================

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(400).json({ success: false, message: 'Email atau password salah.' });
        }
        const user = users[0];
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ success: false, message: 'Email atau password salah.' });
        }

        const payload = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role_name
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
        const refreshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

        res.cookie('token', token, { httpOnly: true, secure: false, maxAge: 2 * 60 * 60 * 1000 });

        res.json({
            success: true,
            data: {
                token,
                refreshToken,
                redirect: '/dashboard',
                user: {
                    id: user.id,
                    uuid: user.uuid,
                    name: user.name,
                    email: user.email,
                    role_id: user.role_id,
                    phone: user.phone,
                    is_active: user.is_active,
                    role: {
                        name: user.role_name,
                        display_name: 'Administrator'
                    }
                }
            }
        });
    } catch (err) {
        console.error('Login database error:', err.message);
        return res.status(500).json({ success: false, message: 'Database connection error.' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out successfully' });
});

// Reward Routes API
app.use('/api/rewards', authenticateAPI, rewardsRouter.router);


// ============================================
// DATA & STATISTICS APIs (PROTECTED)
// ============================================

app.get('/api/dashboard/overview', authenticateAPI, async (req, res) => {
    try {
        const [custs] = await db.query('SELECT status, COUNT(*) as count FROM customers GROUP BY status');
        const [invoices] = await db.query('SELECT status, amount FROM invoices');

        let total = 0, active = 0, isolated = 0;
        custs.forEach(c => {
            total += c.count;
            if (c.status === 'active') active += c.count;
            if (c.status === 'isolated') isolated += c.count;
        });

        let unpaid = 0, overdue = 0, revenueThisMonth = 0;
        invoices.forEach(i => {
            if (i.status === 'unpaid') unpaid++;
            if (i.status === 'overdue') overdue++;
            if (i.status === 'paid') revenueThisMonth += parseFloat(i.amount);
        });

        res.json({
            success: true,
            data: {
                pppoe: { active: active },
                bandwidth: { total_download: mikrotikCache.rx_bps, mbps: (mikrotikCache.rx_bps / 1000000).toFixed(2) },
                ont: { online: active, offline: isolated },
                devices: { online: active, offline: 0, total: active },
                cpu: { average: mikrotikCache.cpu || 5 },
                billing: { unpaid, overdue, revenueThisMonth },
                customers: { total, active, isolated },
                interfaces: []
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/devices', authenticateAPI, (req, res) => {
    res.json({
        success: true,
        data: [],
        pagination: { total: 0, page: 1, limit: req.query.limit || 6, totalPages: 0 }
    });
});

app.get('/api/devices/stats', authenticateAPI, async (req, res) => {
    try {
        const [custs] = await db.query('SELECT status, COUNT(*) as count FROM customers GROUP BY status');
        let total = 0, online = 0, offline = 0;
        custs.forEach(c => {
            total += c.count;
            if (c.status === 'active') online += c.count;
            else offline += c.count;
        });
        res.json({ success: true, data: { total, online, offline, warning: 0 } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// ============================================
// CUSTOMER MANAGEMENT APIs (PROTECTED)
// ============================================

app.get('/api/customers/stats', authenticateAPI, async (req, res) => {
    try {
        const [totalRows] = await db.query("SELECT COUNT(*) as count FROM customers");
        const [activeRows] = await db.query("SELECT COUNT(*) as count FROM customers WHERE status = 'active'");
        const [inactiveRows] = await db.query("SELECT COUNT(*) as count FROM customers WHERE status = 'inactive'");
        const [suspendedRows] = await db.query("SELECT COUNT(*) as count FROM customers WHERE status = 'suspended'");
        const [isolatedRows] = await db.query("SELECT COUNT(*) as count FROM customers WHERE status = 'isolated'");

        const [overdueRows] = await db.query(`
            SELECT COUNT(DISTINCT c.id) as count 
            FROM customers c
            JOIN invoices i ON c.id = i.customer_id
            WHERE c.status = 'active' AND i.status = 'overdue'
        `);

        const [dueSoonRows] = await db.query(`
            SELECT COUNT(DISTINCT c.id) as count 
            FROM customers c
            JOIN invoices i ON c.id = i.customer_id
            WHERE c.status = 'active' AND i.status = 'unpaid' AND i.due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)
        `);

        const [revenueRows] = await db.query(`
            SELECT SUM(amount) as total 
            FROM invoices 
            WHERE status = 'paid' AND MONTH(paid_date) = MONTH(NOW()) AND YEAR(paid_date) = YEAR(NOW())
        `);

        res.json({
            success: true,
            data: {
                total: totalRows[0].count,
                active: activeRows[0].count,
                inactive: inactiveRows[0].count,
                suspended: suspendedRows[0].count,
                isolated: isolatedRows[0].count,
                overdue: overdueRows[0].count,
                due_soon: dueSoonRows[0].count,
                monthly_revenue: parseFloat(revenueRows[0].total || 0)
            }
        });
    } catch (err) {
        console.error('Error fetching customer stats:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/customers/next-id', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT customer_id FROM customers WHERE customer_id LIKE 'CID%'");
        let maxNum = 0;
        rows.forEach(r => {
            const match = r.customer_id.match(/^CID(\d+)$/i);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        });
        const nextNum = maxNum + 1;
        const nextId = 'CID' + String(nextNum).padStart(3, '0');
        res.json({
            success: true,
            customer_id: nextId
        });
    } catch (err) {
        console.error('Error generating next customer id:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/customers/check-id', authenticateAPI, async (req, res) => {
    try {
        const { customer_id } = req.query;
        if (!customer_id) {
            return res.status(400).json({ success: false, message: 'Missing customer_id parameter' });
        }
        const [rows] = await db.query("SELECT id FROM customers WHERE customer_id = ?", [customer_id]);
        res.json({
            success: true,
            available: rows.length === 0
        });
    } catch (err) {
        console.error('Error checking customer id:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/customers', authenticateAPI, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status || '';

        let countQuery = `
            SELECT COUNT(*) as count 
            FROM customers c
            LEFT JOIN packages p ON c.package_id = p.id
            WHERE 1=1
        `;
        let dataQuery = `
            SELECT c.*, 
                   p.name as package_name, p.price as package_price,
                   i.due_date as latest_due_date, i.status as latest_invoice_status
               FROM customers c
               LEFT JOIN packages p ON c.package_id = p.id
               LEFT JOIN (
                   SELECT customer_id, MAX(id) as max_invoice_id 
                   FROM invoices 
                   GROUP BY customer_id
               ) latest_inv ON c.id = latest_inv.customer_id
               LEFT JOIN invoices i ON latest_inv.max_invoice_id = i.id
               WHERE 1=1
        `;

        const params = [];
        const countParams = [];

        if (search) {
            const searchWild = `%${search}%`;
            const searchFilter = ` AND (c.name LIKE ? OR c.customer_id LIKE ? OR c.address LIKE ? OR c.phone LIKE ? OR c.pppoe_username LIKE ?)`;
            countQuery += searchFilter;
            dataQuery += searchFilter;
            countParams.push(searchWild, searchWild, searchWild, searchWild, searchWild);
            params.push(searchWild, searchWild, searchWild, searchWild, searchWild);
        }

        if (status) {
            if (status === 'overdue') {
                const overdueFilter = ` AND c.status = 'active' AND i.status = 'overdue'`;
                countQuery = `
                    SELECT COUNT(DISTINCT c.id) as count 
                    FROM customers c
                    JOIN invoices i ON c.id = i.customer_id
                    WHERE c.status = 'active' AND i.status = 'overdue'
                `;
                dataQuery += overdueFilter;
            } else if (status === 'due_soon') {
                const dueSoonFilter = ` AND c.status = 'active' AND i.status = 'unpaid' AND i.due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)`;
                countQuery = `
                    SELECT COUNT(DISTINCT c.id) as count 
                    FROM customers c
                    JOIN invoices i ON c.id = i.customer_id
                    WHERE c.status = 'active' AND i.status = 'unpaid' AND i.due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)
                `;
                dataQuery += dueSoonFilter;
            } else {
                const statusFilter = ` AND c.status = ?`;
                countQuery += statusFilter;
                dataQuery += statusFilter;
                countParams.push(status);
                params.push(status);
            }
        }

        dataQuery += ` ORDER BY c.id DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [countRows] = await db.query(countQuery, countParams);
        const total = countRows[0].count;

        const [rows] = await db.query(dataQuery, params);

        const customers = rows.map(r => {
            return {
                ...r,
                package: r.package_name ? {
                    name: r.package_name,
                    price: r.package_price
                } : null
            };
        });

        res.json({
            success: true,
            data: customers,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Error fetching customers list:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/customers/map', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id, name, customer_id, status, latitude, longitude FROM customers WHERE latitude IS NOT NULL AND longitude IS NOT NULL'
        );
        res.json({
            success: true,
            data: rows
        });
    } catch (err) {
        console.error('Error fetching customer map data:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/customers/:id', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM customers WHERE id = ?", [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan.' });
        }
        const customer = rows[0];
        if (customer.due_date) {
            customer.due_date = new Date(customer.due_date).toISOString().slice(0, 10);
        }
        if (customer.installation_date) {
            customer.installation_date = new Date(customer.installation_date).toISOString().slice(0, 10);
        }
        res.json({
            success: true,
            data: customer
        });
    } catch (err) {
        console.error('Error fetching customer details:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/customers', authenticateAPI, async (req, res) => {
    try {
        let {
            customer_id,
            name,
            phone,
            email,
            address,
            package_id,
            due_date,
            installation_date,
            pppoe_username,
            ont_sn,
            static_ip,
            mikrotik_id,
            status,
            portal_password
        } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Nama customer wajib diisi.' });
        }

        if (!customer_id) {
            const [rows] = await db.query("SELECT customer_id FROM customers WHERE customer_id LIKE 'CID%'");
            let maxNum = 0;
            rows.forEach(r => {
                const match = r.customer_id.match(/^CID(\d+)$/i);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            });
            customer_id = 'CID' + String(maxNum + 1).padStart(3, '0');
        }

        const plainPass = portal_password || req.body.password || phone || '123456';
        const passwordHash = await bcrypt.hash(plainPass, 10);

        const [result] = await db.query(
            `INSERT INTO customers 
             (customer_id, name, phone, email, address, package_id, due_date, installation_date, pppoe_username, ont_sn, static_ip, mikrotik_id, status, portal_password)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                customer_id,
                name,
                phone || '',
                email || '',
                address || '',
                package_id || null,
                due_date || null,
                installation_date || null,
                pppoe_username || '',
                ont_sn || '',
                static_ip || null,
                mikrotik_id || null,
                status || 'active',
                passwordHash
            ]
        );

        res.json({
            success: true,
            message: 'Customer berhasil ditambahkan.',
            data: { id: result.insertId }
        });
    } catch (err) {
        console.error('Error creating customer:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.put('/api/customers/:id', authenticateAPI, async (req, res) => {
    try {
        const id = req.params.id;
        const updates = req.body;

        const [current] = await db.query("SELECT * FROM customers WHERE id = ?", [id]);
        if (current.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan.' });
        }

        if (updates.portal_password) {
            updates.portal_password = await bcrypt.hash(updates.portal_password, 10);
        } else if (updates.password) {
            updates.portal_password = await bcrypt.hash(updates.password, 10);
            delete updates.password;
        }

        const fields = [];
        const values = [];
        const allowedFields = [
            'customer_id', 'name', 'phone', 'email', 'address', 'package_id',
            'due_date', 'installation_date', 'pppoe_username', 'ont_sn',
            'static_ip', 'mikrotik_id', 'status', 'portal_password', 'portal_enabled'
        ];

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                fields.push(`${field} = ?`);
                values.push(updates[field] === '' ? null : updates[field]);
            }
        }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada kolom yang diupdate.' });
        }

        values.push(id);
        await db.query(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`, values);

        res.json({
            success: true,
            message: 'Customer berhasil diperbarui.'
        });
    } catch (err) {
        console.error('Error updating customer:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/customers/:id', authenticateAPI, async (req, res) => {
    try {
        const [result] = await db.query("DELETE FROM customers WHERE id = ?", [req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan.' });
        }
        res.json({
            success: true,
            message: 'Customer berhasil dihapus.'
        });
    } catch (err) {
        console.error('Error deleting customer:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================
// ISOLIR & ROUTER MANAGEMENT APIs
// ============================================

app.get('/api/isolir/devices', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM devices");
        const devices = rows.map(r => ({
            id: r.id,
            name: r.name,
            host: r.ip_address || '',
            status: r.status,
            cpu_load: r.cpu_load
        }));
        res.json({
            success: true,
            data: devices
        });
    } catch (err) {
        console.error('Error fetching isolir devices:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

const axios = require('axios');
app.get('/api/genieacs/stats', authenticateAPI, async (req, res) => {
    const s = req.app.locals.settings || {};
    const nbi_url = s.genieacs_nbi_url || process.env.GENIEACS_NBI_URL;
    const auth = (s.genieacs_username && s.genieacs_password) ? { username: s.genieacs_username, password: s.genieacs_password } : undefined;
    if (nbi_url) {
        try {
            const response = await axios.get(`${nbi_url}/devices`, { auth, timeout: 5000 });
            res.json({ success: true, data: response.data });
            return;
        } catch (err) {
            console.warn("GenieACS fetch error:", err.message);
        }
    }
    // Simulate from customers
    try {
        const [rows] = await db.query("SELECT status, COUNT(*) as count FROM customers WHERE ont_sn IS NOT NULL GROUP BY status");
        let online = 0, offline = 0;
        rows.forEach(r => {
            if (r.status === 'active') online += r.count;
            else offline += r.count;
        });
        res.json({ success: true, data: { total: online + offline, online, offline, raw_total: online + offline, junk_filtered: 0, manufacturers: {} } });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/notifications/unread-count', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT COUNT(*) as count FROM invoices WHERE status = 'overdue'");
        res.json({ success: true, data: rows[0].count });
    } catch (err) {
        res.json({ success: true, data: 0 });
    }
});

app.get('/api/notifications', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query(`
      SELECT id, invoice_number, due_date, status, customer_id 
      FROM invoices 
      WHERE status = 'overdue' LIMIT 10
    `);
        const notifications = rows.map(r => ({
            id: r.id,
            type: 'overdue',
            severity: 'critical',
            title: 'Tagihan Overdue',
            message: `Tagihan ${r.invoice_number} melewati jatuh tempo`,
            created_at: r.due_date,
            is_read: false
        }));
        res.json({ success: true, data: notifications });
    } catch (err) {
        res.json({ success: true, data: [] });
    }
});

app.put('/api/notifications/:id/read', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.put('/api/notifications/read-all', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

// ============================================
// BILLING & INVOICING APIs
// ============================================

app.get('/api/billing/total-outstanding', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT SUM(amount) as total, COUNT(*) as count FROM invoices WHERE status != 'paid'");
        res.json({ success: true, data: { total: parseFloat(rows[0].total || 0), count: rows[0].count } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/billing/stats', authenticateAPI, async (req, res) => {
    try {
        const [paidRows] = await db.query("SELECT COUNT(*) as count FROM invoices WHERE status = 'paid' AND MONTH(paid_date) = MONTH(NOW()) AND YEAR(paid_date) = YEAR(NOW())");
        const [unpaidRows] = await db.query("SELECT COUNT(*) as count FROM invoices WHERE status = 'unpaid'");
        const [overdueRows] = await db.query("SELECT COUNT(*) as count FROM invoices WHERE status = 'overdue'");
        const [revRows] = await db.query("SELECT SUM(amount) as total FROM invoices WHERE status = 'paid' AND MONTH(paid_date) = MONTH(NOW()) AND YEAR(paid_date) = YEAR(NOW())");

        // Fetch 7-day trends for sparklines
        const [paidTrendRows] = await db.query(`
            SELECT DATE(paid_date) as date, COUNT(*) as count, SUM(amount) as total
            FROM invoices 
            WHERE status = 'paid' AND paid_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(paid_date)
            ORDER BY date ASC
        `);

        const paidTrend = new Array(7).fill(0);
        const revenueTrend = new Array(7).fill(0);
        
        const today = new Date();
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(today.getDate() - (6 - i));
            const dateStr = d.toISOString().slice(0, 10);
            
            const match = paidTrendRows.find(r => {
                const rDate = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date);
                return rDate === dateStr;
            });
            if (match) {
                paidTrend[i] = match.count;
                revenueTrend[i] = parseFloat(match.total || 0);
            }
        }

        res.json({
            success: true,
            data: {
                paidThisMonth: paidRows[0].count,
                unpaid: unpaidRows[0].count,
                overdue: overdueRows[0].count,
                revenueThisMonth: parseFloat(revRows[0].total || 0),
                paidTrend,
                revenueTrend,
                unpaidTrend: [unpaidRows[0].count - 2, unpaidRows[0].count - 1, unpaidRows[0].count + 1, unpaidRows[0].count, unpaidRows[0].count + 2, unpaidRows[0].count - 1, unpaidRows[0].count],
                overdueTrend: [overdueRows[0].count + 1, overdueRows[0].count + 1, overdueRows[0].count, overdueRows[0].count - 1, overdueRows[0].count, overdueRows[0].count + 1, overdueRows[0].count]
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.post('/api/billing/mark-overdue', authenticateAPI, async (req, res) => {
    try {
        const [result] = await db.query("UPDATE invoices SET status = 'overdue' WHERE status = 'unpaid' AND due_date < DATE(NOW())");
        res.json({ success: true, message: `Berhasil menandai ${result.affectedRows} invoice overdue.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.get('/api/billing/invoices', authenticateAPI, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status || '';
    const search = req.query.search || '';

    try {
        let q = `
            SELECT i.*, c.name as customer_name, c.customer_id as customer_code, c.points as customer_points, c.reward_points as customer_reward_points
            FROM invoices i
            JOIN customers c ON i.customer_id = c.id
            WHERE 1=1
        `;
        const params = [];
        if (status) {
            q += " AND i.status = ?";
            params.push(status);
        }
        if (search) {
            q += " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.customer_id LIKE ?)";
            const s = `%${search}%`;
            params.push(s, s, s);
        }
        q += " ORDER BY i.id DESC LIMIT ? OFFSET ?";
        params.push(limit, offset);

        const [rows] = await db.query(q, params);

        const formatted = [];
        for (const row of rows) {
            const [payments] = await db.query("SELECT payment_date, payment_method FROM payments WHERE invoice_id = ? ORDER BY id DESC LIMIT 1", [row.id]);
            formatted.push({
                ...row,
                total: row.amount,
                due_date: row.due_date ? new Date(row.due_date).toISOString().slice(0, 10) : null,
                customer: {
                    name: row.customer_name,
                    customer_id: row.customer_code,
                    points: row.customer_points || 0,
                    reward_points: row.customer_reward_points || 0
                },
                payments: payments.map(p => ({
                    payment_date: p.payment_date ? new Date(p.payment_date).toISOString().slice(0, 10) : null,
                    payment_method: p.payment_method
                }))
            });
        }

        let countQ = `
            SELECT COUNT(*) as count 
            FROM invoices i
            JOIN customers c ON i.customer_id = c.id
            WHERE 1=1
        `;
        const countParams = [];
        if (status) {
            countQ += " AND i.status = ?";
            countParams.push(status);
        }
        if (search) {
            countQ += " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.customer_id LIKE ?)";
            const s = `%${search}%`;
            countParams.push(s, s, s);
        }
        const [countResult] = await db.query(countQ, countParams);
        const total = countResult[0].count;

        res.json({
            success: true,
            data: formatted,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.post('/api/billing/generate', authenticateAPI, async (req, res) => {
    const { month, year } = req.body;
    if (!month || !year) {
        return res.status(400).json({ success: false, message: 'Bulan dan Tahun harus disertakan.' });
    }
    try {
        const [customers] = await db.query("SELECT c.*, p.price as package_price FROM customers c LEFT JOIN packages p ON c.package_id = p.id WHERE c.status = 'active'");
        let created = 0;
        let skipped = 0;

        for (const cust of customers) {
            const [exists] = await db.query(
                "SELECT id FROM invoices WHERE customer_id = ? AND period_month = ? AND period_year = ?",
                [cust.id, month, year]
            );
            if (exists.length > 0) {
                skipped++;
                continue;
            }

            const amount = cust.package_price || cust.monthly_fee || 0;
            const invoice_number = `INV-${year}${String(month).padStart(2, '0')}-${String(cust.id).padStart(4, '0')}`;
            const due_date = cust.due_date || `${year}-${String(month).padStart(2, '0')}-10`;

            await db.query(
                "INSERT INTO invoices (invoice_number, customer_id, amount, due_date, status, period_month, period_year) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [invoice_number, cust.id, amount, due_date, 'unpaid', month, year]
            );
            created++;
        }
        res.json({ success: true, message: `Invoice generated successfully.`, data: { created, skipped } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.post('/api/billing/sync-due-dates', authenticateAPI, async (req, res) => {
    try {
        const [invoices] = await db.query("SELECT id, customer_id FROM invoices WHERE status = 'unpaid'");
        for (const inv of invoices) {
            const [custs] = await db.query("SELECT due_date FROM customers WHERE id = ?", [inv.customer_id]);
            if (custs.length > 0 && custs[0].due_date) {
                await db.query("UPDATE invoices SET due_date = ? WHERE id = ?", [custs[0].due_date, inv.id]);
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.post('/api/billing/invoices/:id/reminder', authenticateAPI, async (req, res) => {
    try {
        const [invoices] = await db.query(`
            SELECT i.*, c.name, c.phone 
            FROM invoices i 
            JOIN customers c ON i.customer_id = c.id 
            WHERE i.id = ?
        `, [req.params.id]);

        if (invoices.length === 0) {
            return res.status(404).json({ success: false, message: 'Invoice tidak ditemukan' });
        }

        const inv = invoices[0];
        if (!inv.phone) {
            return res.status(400).json({ success: false, message: 'Nomor WhatsApp pelanggan tidak terdaftar' });
        }

        const dueDateStr = inv.due_date ? new Date(inv.due_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : '-';
        const amountStr = Number(inv.amount).toLocaleString('id-ID');
        const message = `Halo *${inv.name}*,\n\nIni adalah pengingat bahwa tagihan internet Anda nomor *${inv.invoice_number}* sebesar *Rp ${amountStr}* memiliki jatuh tempo pada tanggal *${dueDateStr}*.\n\nMohon untuk segera melakukan pembayaran agar layanan internet tetap aktif.\n\nTerima kasih atas kerja samanya.`;

        await sendWhatsAppMessage(inv.phone, message);
        res.json({ success: true, message: 'Reminder tagihan berhasil dikirim via WhatsApp.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


app.get('/api/tickets', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query(`
      SELECT t.*, c.name as customer_name, c.phone as customer_phone, u.name as assignee_name 
      FROM tickets t
      LEFT JOIN customers c ON t.customer_id = c.id
      LEFT JOIN users u ON t.assigned_to = u.id
    `);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/todos', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT t.*, u.name as assignee_name, u.email as assignee_email 
            FROM todos t 
            LEFT JOIN users u ON t.assigned_to = u.id 
            ORDER BY t.created_at DESC
        `);
        const mapped = rows.map(r => ({
            ...r,
            assignee: r.assigned_to ? { id: r.assigned_to, name: r.assignee_name, email: r.assignee_email } : null
        }));
        res.json({ success: true, data: mapped });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.get('/api/work-orders', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query(`
      SELECT w.*, c.name as customer_name, u.name as technician_name 
      FROM work_orders w
      LEFT JOIN customers c ON w.customer_id = c.id
      LEFT JOIN users u ON w.assigned_to = u.id
    `);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/wa/templates', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM wa_templates');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// Mikrotik / Local file endpoints
const { RouterOSAPI } = require('node-routeros');

app.get('/api/mikrotik/interfaces', authenticateAPI, async (req, res) => {
    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
    if (host) {
        const conn = getMikrotikConn(req);
        try {
            await conn.connect();
            const interfaces = await conn.write('/interface/print');
            conn.close();
            const parsed = interfaces
                .filter(i => i.type !== 'pppoe-in' && i.type !== 'pppoe-out' && i.type !== 'loopback' && !i.name.includes('<'))
                .map(i => ({
                    ...i,
                    running: i.running === 'true' || i.running === true,
                    disabled: i.disabled === 'true' || i.disabled === true
                }));
            return res.json({ success: true, data: parsed });
        } catch (err) {
            console.warn("Mikrotik connection failed:", err.message);
        }
    }
    res.json({
        success: true, data: [
            { name: 'ether1', type: 'ether', running: true, disabled: false, macAddress: '00:11:22:33:44:55', comment: 'WAN' },
            { name: 'ether2', type: 'ether', running: true, disabled: false, macAddress: '00:11:22:33:44:56', comment: 'LAN' },
            { name: 'wlan1', type: 'wlan', running: false, disabled: false, macAddress: '00:11:22:33:44:57', comment: 'Hotspot' }
        ]
    });
});

app.get('/api/mikrotik/interfaces/monitor', authenticateAPI, async (req, res) => {
    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
    if (host) {
        const conn = getMikrotikConn(req);
        try {
            await conn.connect();
            const interfaces = await conn.write('/interface/print');
            const filtered = interfaces.filter(i => 
                i.type !== 'pppoe-in' && 
                i.type !== 'pppoe-out' && 
                i.type !== 'loopback' && 
                !i.name.includes('<')
            );
            const names = filtered.map(i => i.name).join(',');
            if (names) {
                const stats = await conn.write('/interface/monitor-traffic', [
                    `=interface=${names}`,
                    '=once='
                ]);
                conn.close();
                const data = stats.map(st => ({
                    name: st.name,
                    rxBitsPerSecond: parseInt(st['rx-bits-per-second'] || '0', 10),
                    txBitsPerSecond: parseInt(st['tx-bits-per-second'] || '0', 10)
                }));
                return res.json({ success: true, data });
            }
            conn.close();
            return res.json({ success: true, data: [] });
        } catch (err) {
            console.warn("Mikrotik connection failed:", err.message);
        }
    }

    const mockData = [
        { name: 'ether1', rxBitsPerSecond: Math.floor(Math.random() * 50000000), txBitsPerSecond: Math.floor(Math.random() * 20000000) },
        { name: 'ether2', rxBitsPerSecond: Math.floor(Math.random() * 10000000), txBitsPerSecond: Math.floor(Math.random() * 5000000) },
        { name: 'wlan1', rxBitsPerSecond: Math.floor(Math.random() * 5000000), txBitsPerSecond: Math.floor(Math.random() * 1000000) }
    ];
    res.json({ success: true, data: mockData });
});

app.get('/api/mikrotik/interfaces/monitor-selected', authenticateAPI, async (req, res) => {
    const names = req.query.names;
    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
    if (host && names) {
        const conn = getMikrotikConn(req);
        try {
            await conn.connect();
            const stats = await conn.write('/interface/monitor-traffic', [
                `=interface=${names}`,
                '=once='
            ]);
            conn.close();
            const data = stats.map(st => ({
                name: st.name,
                rxBitsPerSecond: parseInt(st['rx-bits-per-second'] || '0', 10),
                txBitsPerSecond: parseInt(st['tx-bits-per-second'] || '0', 10)
            }));
            return res.json({ success: true, data });
        } catch (err) {
            console.warn("Mikrotik connection failed:", err.message);
        }
    }

    const mockData = (names ? names.split(',') : ['ether1']).map(name => ({
        name,
        rxBitsPerSecond: Math.floor(Math.random() * 50000000),
        txBitsPerSecond: Math.floor(Math.random() * 20000000)
    }));
    res.json({ success: true, data: mockData });
});

// Mikrotik Config & Queue APIs

const getMikrotikConn = (req) => {
    const s = req.app.locals.settings || {};
    const conn = new RouterOSAPI({
        host: s.mikrotik_host || process.env.MIKROTIK_HOST,
        user: s.mikrotik_user || process.env.MIKROTIK_USER || 'admin',
        password: s.mikrotik_password || process.env.MIKROTIK_PASSWORD || '',
        port: parseInt(s.mikrotik_port || process.env.MIKROTIK_PORT || 8728, 10)
    });
    conn.on('error', (err) => { });
    return conn;
};

app.get('/api/mikrotik/config', authenticateAPI, (req, res) => {
    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST || '';
    const port = s.mikrotik_port || process.env.MIKROTIK_PORT || 8728;
    const user = s.mikrotik_user || process.env.MIKROTIK_USER || 'admin';
    res.json({
        success: true,
        data: {
            configured: !!host,
            host: host,
            port: port,
            username: user
        }
    });
});

app.post('/api/mikrotik/config', authenticateAPI, async (req, res) => {
    const { host, port, username, password } = req.body;
    try {
        const updateSetting = async (key, val) => {
            if (val !== undefined) {
                await db.query('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', [key, val, val]);
                if (req.app.locals.settings) req.app.locals.settings[key] = val;
            }
        };
        await updateSetting('mikrotik_host', host);
        await updateSetting('mikrotik_port', port);
        await updateSetting('mikrotik_user', username);
        if (password) await updateSetting('mikrotik_password', password);
        res.json({ success: true, message: 'Mikrotik configuration saved' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.post('/api/mikrotik/test', authenticateAPI, async (req, res) => {
    const { host, port, username, password } = req.body;
    try {
        const conn = new RouterOSAPI({ host, port: port || 8728, user: username, password });
        conn.on('error', (err) => { });
        await conn.connect();
        const ident = await conn.write('/system/identity/print');
        conn.close();
        res.json({ success: true, identity: ident[0].name });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

app.get('/api/mikrotik/queues', authenticateAPI, async (req, res) => {
    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
    if (!host) {
        return res.json({ success: true, data: [] });
    }

    try {
        const conn = getMikrotikConn(req);
        await conn.connect();
        const queues = await conn.write('/queue/simple/print');
        conn.close();

        const data = queues.map(q => {
            const bytesArr = (q.bytes || '0/0').split('/');
            return {
                id: q['.id'],
                name: q.name,
                target: q.target,
                maxLimit: q['max-limit'] || '',
                rateIn: 0,
                rateOut: 0,
                bytesIn: parseInt(bytesArr[0] || '0', 10),
                bytesOut: parseInt(bytesArr[1] || '0', 10),
                priority: q.priority || '8',
                disabled: q.disabled === 'true',
                comment: q.comment || ''
            };
        });
        res.json({ success: true, data });
    } catch (err) {
        console.warn("Mikrotik queues error:", err.message);
        res.json({ success: false, message: 'Failed to connect to Mikrotik: ' + err.message });
    }
});

app.get('/api/mikrotik/queues/stats', authenticateAPI, async (req, res) => {
    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
    if (!host) {
        return res.json({ success: true, data: [] });
    }

    try {
        const conn = getMikrotikConn(req);
        await conn.connect();
        const queues = await conn.write('/queue/simple/print');
        conn.close();

        const data = queues.map(q => {
            const rateArr = (q.rate || '0/0').split('/');
            const bytesArr = (q.bytes || '0/0').split('/');
            return {
                id: q['.id'],
                rateIn: parseInt(rateArr[0] || '0', 10),
                rateOut: parseInt(rateArr[1] || '0', 10),
                bytesIn: parseInt(bytesArr[0] || '0', 10),
                bytesOut: parseInt(bytesArr[1] || '0', 10)
            };
        });
        res.json({ success: true, data });
    } catch (err) {
        res.json({ success: false, message: 'Failed to get stats: ' + err.message });
    }
});

app.get('/api/mikrotik/queues/:name/history', authenticateAPI, (req, res) => {
    res.json({ success: true, data: [] });
});

app.post('/api/mikrotik/queues', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.put('/api/mikrotik/queues/:id', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.delete('/api/mikrotik/queues/:id', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.post('/api/mikrotik/queues/:id/enable', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.post('/api/mikrotik/queues/:id/disable', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.get('/api/mikrotik/ippool', authenticateAPI, async (req, res) => {
    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
    if (!host) return res.json({ success: true, data: [] });

    try {
        const conn = getMikrotikConn(req);
        await conn.connect();
        const pools = await conn.write('/ip/pool/print');
        let used = [];
        try { used = await conn.write('/ip/pool/used/print'); } catch (e) { }
        conn.close();

        const data = pools.map(p => {
            const ranges = p.ranges || '';
            let totalIPs = 253; // estimation for /24
            const usedInPool = used.filter(u => u.pool === p.name);
            const usedCount = usedInPool.length;
            const freeCount = Math.max(0, totalIPs - usedCount);
            const usedPercent = Math.round((usedCount / totalIPs) * 100);

            return {
                name: p.name,
                ranges: ranges,
                usedCount: usedCount,
                freeCount: freeCount,
                totalIPs: totalIPs,
                usedPercent: usedPercent,
                usedIPs: usedInPool.map(u => ({ address: u.address, owner: u.info || u['caller-id'] || '' }))
            };
        });

        res.json({ success: true, data });
    } catch (err) {
        res.json({ success: false, message: 'Failed to connect: ' + err.message });
    }
});

app.get('/api/mikrotik/firewall/stats', authenticateAPI, async (req, res) => {
    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
    if (!host) return res.json({ success: true, data: { filter: { total: 0, active: 0, disabled: 0 }, nat: { total: 0 } } });

    try {
        const conn = getMikrotikConn(req);
        await conn.connect();
        const filter = await conn.write('/ip/firewall/filter/print');
        const nat = await conn.write('/ip/firewall/nat/print');
        conn.close();

        const filterDisabled = filter.filter(r => r.disabled === 'true').length;
        const filterTotal = filter.length;

        res.json({
            success: true,
            data: {
                filter: { total: filterTotal, active: filterTotal - filterDisabled, disabled: filterDisabled },
                nat: { total: nat.length }
            }
        });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

app.get('/api/mikrotik/firewall/filter', authenticateAPI, async (req, res) => {
    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
    if (!host) return res.json({ success: true, data: [] });

    try {
        const conn = getMikrotikConn(req);
        await conn.connect();
        const rules = await conn.write('/ip/firewall/filter/print');
        conn.close();

        const data = rules.map((r, idx) => ({
            id: r['.id'],
            order: idx + 1,
            chain: r.chain || '',
            action: r.action || '',
            protocol: r.protocol || '',
            srcAddress: r['src-address'] || '',
            dstAddress: r['dst-address'] || '',
            dstPort: r['dst-port'] || '',
            comment: r.comment || '',
            bytes: parseInt(r.bytes || '0', 10),
            packets: parseInt(r.packets || '0', 10),
            disabled: r.disabled === 'true'
        }));
        res.json({ success: true, data });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

app.get('/api/mikrotik/firewall/nat', authenticateAPI, async (req, res) => {
    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
    if (!host) return res.json({ success: true, data: [] });

    try {
        const conn = getMikrotikConn(req);
        await conn.connect();
        const rules = await conn.write('/ip/firewall/nat/print');
        conn.close();

        const data = rules.map((r, idx) => ({
            id: r['.id'],
            order: idx + 1,
            chain: r.chain || '',
            action: r.action || '',
            srcAddress: r['src-address'] || '',
            dstAddress: r['dst-address'] || '',
            toAddresses: r['to-addresses'] || '',
            toPorts: r['to-ports'] || '',
            comment: r.comment || '',
            bytes: parseInt(r.bytes || '0', 10),
            packets: parseInt(r.packets || '0', 10),
            disabled: r.disabled === 'true'
        }));
        res.json({ success: true, data });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

app.post('/api/mikrotik/firewall/toggle', authenticateAPI, async (req, res) => {
    const { id, type, state } = req.body;
    if (!id || !type) return res.json({ success: false, message: 'Invalid payload' });

    try {
        const conn = getMikrotikConn(req);
        await conn.connect();
        const command = state ? 'enable' : 'disable';
        await conn.write(`/ip/firewall/${type}/${command}`, [`=.id=${id}`]);
        conn.close();
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// PPPoE Monitoring Endpoints
app.get('/api/mikrotik/ppp/active', authenticateAPI, async (req, res) => {
    try {
        const conn = getMikrotikConn(req);
        await conn.connect();
        const active = await conn.write('/ppp/active/print');
        conn.close();
        res.json({ success: true, data: active });
    } catch (err) {
        res.json({ success: false, message: err.message, data: [] });
    }
});

app.get('/api/mikrotik/ppp/secret', authenticateAPI, async (req, res) => {
    try {
        const conn = getMikrotikConn(req);
        await conn.connect();
        const secrets = await conn.write('/ppp/secret/print');
        conn.close();
        res.json({ success: true, data: secrets });
    } catch (err) {
        res.json({ success: false, message: err.message, data: [] });
    }
});

app.post('/api/mikrotik/ppp/secret', authenticateAPI, async (req, res) => {
    const { id, name, password, service, profile, 'local-address': local, 'remote-address': remote, 'caller-id': caller, disabled, comment } = req.body;
    try {
        const conn = getMikrotikConn(req);
        await conn.connect();

        let cmd = [];
        if (name) cmd.push(`=name=${name}`);
        if (password) cmd.push(`=password=${password}`);
        if (service) cmd.push(`=service=${service}`);
        if (profile) cmd.push(`=profile=${profile}`);
        if (local) cmd.push(`=local-address=${local}`);
        if (remote) cmd.push(`=remote-address=${remote}`);
        if (caller) cmd.push(`=caller-id=${caller}`);
        if (comment) cmd.push(`=comment=${comment}`);
        if (disabled !== undefined) cmd.push(`=disabled=${disabled}`);

        if (id) {
            cmd.push(`=.id=${id}`);
            await conn.write('/ppp/secret/set', cmd);
        } else {
            await conn.write('/ppp/secret/add', cmd);
        }
        conn.close();
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

app.post('/api/mikrotik/ppp/secret/delete', authenticateAPI, async (req, res) => {
    const { id } = req.body;
    try {
        const conn = getMikrotikConn(req);
        await conn.connect();
        await conn.write('/ppp/secret/remove', [`=.id=${id}`]);
        conn.close();
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// GenieACS mock APIs
// GenieACS API endpoints
app.get('/api/genieacs/settings/load', authenticateAPI, (req, res) => {
    const s = req.app.locals.settings || {};
    res.json({
        success: true,
        data: {
            nbi_url: s.genieacs_nbi_url || process.env.GENIEACS_NBI_URL || '',
            username: s.genieacs_username || process.env.GENIEACS_USERNAME || '',
            password: s.genieacs_password || process.env.GENIEACS_PASSWORD || ''
        }
    });
});

app.post('/api/genieacs/settings', authenticateAPI, async (req, res) => {
    const { nbi_url, username, password } = req.body;
    try {
        const updateSetting = async (key, val) => {
            if (val !== undefined) {
                await db.query('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', [key, val, val]);
                if (req.app.locals.settings) req.app.locals.settings[key] = val;
            }
        };
        await updateSetting('genieacs_nbi_url', nbi_url);
        await updateSetting('genieacs_username', username);
        if (password) await updateSetting('genieacs_password', password);
        res.json({ success: true, message: 'GenieACS configuration saved' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.post('/api/genieacs/test', authenticateAPI, async (req, res) => {
    const { nbi_url, username, password } = req.body;
    if (!nbi_url) return res.json({ success: false, error: 'URL required' });
    try {
        const axios = require('axios');
        const auth = (username && password) ? { username, password } : undefined;
        // Test fetch devices
        await axios.get(`${nbi_url}/devices?query=%7B%7D`, { auth, timeout: 5000 });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

const PATHS = {
    manufacturer: ['InternetGatewayDevice.DeviceInfo.Manufacturer', 'Device.DeviceInfo.Manufacturer'],
    model: ['InternetGatewayDevice.DeviceInfo.ProductClass', 'Device.DeviceInfo.ModelName', 'Device.DeviceInfo.ProductClass'],
    serial: ['InternetGatewayDevice.DeviceInfo.SerialNumber', 'Device.DeviceInfo.SerialNumber'],
    software: ['InternetGatewayDevice.DeviceInfo.SoftwareVersion', 'Device.DeviceInfo.SoftwareVersion'],
    uptime: ['InternetGatewayDevice.DeviceInfo.UpTime', 'Device.DeviceInfo.UpTime'],
    ssid2g: ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', 'Device.WiFi.SSID.1.SSID'],
    pass2g: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase',
        'Device.WiFi.AccessPoint.1.Security.PreSharedKey'
    ],
    ssid5g: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID',
        'Device.WiFi.SSID.2.SSID'
    ],
    pass5g: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.PreSharedKey',
        'Device.WiFi.AccessPoint.2.Security.PreSharedKey'
    ],
    rxPower: [
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_HW_OpticalParameter.RxPower',
        'Device.X_HW_OpticalParameter.RxPower',
        'Device.X_HW_GponInterface.RxPower',
        'Device.X_ZTE_OpticalParameter.RxPower',
        'Device.X_FH_OpticalParameter.RxPower',
        'InternetGatewayDevice.X_FH_OpticalParameter.RxPower',
        'Device.Optical.Interface.1.Stats.RxPower',
        'Device.Optical.Interface.1.Parameter.RxPower'
    ],
    txPower: [
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_HW_OpticalParameter.TxPower',
        'Device.X_HW_OpticalParameter.TxPower',
        'Device.X_HW_GponInterface.TxPower',
        'Device.X_ZTE_OpticalParameter.TxPower',
        'Device.X_FH_OpticalParameter.TxPower',
        'InternetGatewayDevice.X_FH_OpticalParameter.TxPower',
        'Device.Optical.Interface.1.Stats.TxPower',
        'Device.Optical.Interface.1.Parameter.TxPower'
    ],
    temp: [
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_HW_OpticalParameter.Temperature',
        'Device.X_HW_OpticalParameter.Temperature',
        'Device.X_ZTE_OpticalParameter.Temperature',
        'Device.X_FH_OpticalParameter.Temperature',
        'InternetGatewayDevice.X_FH_OpticalParameter.Temperature',
        'Device.DeviceInfo.Temperature'
    ]
};

const getGenieACSConfig = (req) => {
    const s = req.app.locals.settings || {};
    const nbi_url = s.genieacs_nbi_url || process.env.GENIEACS_NBI_URL;
    const username = s.genieacs_username || process.env.GENIEACS_USERNAME || '';
    const password = s.genieacs_password || process.env.GENIEACS_PASSWORD || '';
    const auth = (username && password) ? { username, password } : undefined;
    return { nbi_url, auth };
};

const getParam = (device, path) => {
    const parts = path.split('.');
    let node = device;
    for (const part of parts) {
        if (!node || typeof node !== 'object') return null;
        node = node[part];
    }
    return node && node._value !== undefined ? node._value : null;
};

const getParamNode = (device, path) => {
    const parts = path.split('.');
    let node = device;
    for (const part of parts) {
        if (!node || typeof node !== 'object') return null;
        node = node[part];
    }
    return node;
};

const getField = (device, paths) => {
    for (const p of paths) {
        const val = getParam(device, p);
        if (val !== null && val !== undefined) return val;
    }
    return null;
};

const findWanIp = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    if (obj._value !== undefined && typeof obj._value === 'string' && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(obj._value) && obj._value !== '0.0.0.0' && !obj._value.startsWith('192.168.')) {
        return obj._value;
    }
    for (const key in obj) {
        const val = findWanIp(obj[key]);
        if (val) return val;
    }
    return null;
};

const formatUptime = (seconds) => {
    if (seconds == null || isNaN(seconds)) return '';
    const s = parseInt(seconds, 10);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

const mapGenieACSDevice = (device) => {
    const rawSerial = getField(device, PATHS.serial);
    let serial = rawSerial;
    if (!serial && device._id) {
        const parts = device._id.split('-');
        serial = parts.length >= 3 ? parts.slice(2).join('-') : device._id;
    }
    const manufacturer = getField(device, PATHS.manufacturer) || (device._id ? device._id.split('-')[0] : 'Unknown');
    const model = getField(device, PATHS.model) || (device._id ? device._id.split('-')[1] : 'Unknown');
    const ssid = getField(device, PATHS.ssid2g) || getField(device, PATHS.ssid5g) || '';
    const wan_ip = findWanIp(device) || '';
    const last_inform = device._lastInform || device._timestamp || null;
    const online = last_inform ? (Date.now() - new Date(last_inform).getTime() < 10 * 60 * 1000) : false;

    let rx_power = getField(device, PATHS.rxPower);
    if (rx_power !== null && rx_power !== undefined) {
        rx_power = parseFloat(rx_power);
        if (rx_power > 0) rx_power = -rx_power;
        if (rx_power < -100) rx_power = rx_power / 100;
        if (rx_power < -100) rx_power = rx_power / 10;
        if (rx_power > 0 || rx_power < -40 || isNaN(rx_power)) rx_power = null;
    } else {
        rx_power = null;
    }

    let temperature = getField(device, PATHS.temp);
    if (temperature !== null && temperature !== undefined) {
        temperature = parseFloat(temperature);
        if (temperature > 200) temperature = temperature / 10;
        if (temperature < 0 || temperature > 120 || isNaN(temperature)) temperature = null;
    } else {
        temperature = null;
    }

    const prefix = device.InternetGatewayDevice ? 'InternetGatewayDevice' : 'Device';
    const hostsNode = getParamNode(device, prefix === 'InternetGatewayDevice' ? 'InternetGatewayDevice.LANDevice.1.Hosts.Host' : 'Device.Hosts.Host');
    let connected_clients = 0;
    if (hostsNode && typeof hostsNode === 'object') {
        for (const key in hostsNode) {
            if (!isNaN(key)) {
                const host = hostsNode[key];
                if (host.Active && (host.Active._value === true || host.Active._value === 'true')) {
                    connected_clients++;
                } else if (host.Active === undefined) {
                    connected_clients++;
                }
            }
        }
    }

    const uptimeSec = getField(device, PATHS.uptime);
    const uptime_formatted = uptimeSec ? formatUptime(uptimeSec) : '';

    return {
        id: device._id,
        serial: serial || '',
        manufacturer,
        model,
        ssid,
        online,
        rx_power,
        connected_clients,
        temperature: temperature || 0,
        uptime_formatted,
        wan_ip,
        last_inform
    };
};

// GET /api/genieacs/devices
app.get('/api/genieacs/devices', authenticateAPI, async (req, res) => {
    const { nbi_url, auth } = getGenieACSConfig(req);
    if (!nbi_url) {
        return res.json({ success: false, error: 'URL GenieACS belum dikonfigurasi.' });
    }
    try {
        const response = await axios.get(`${nbi_url}/devices`, { auth, timeout: 7000 });
        if (!Array.isArray(response.data)) {
            return res.json({ success: false, error: 'Invalid GenieACS NBI response' });
        }

        const [customers] = await db.query('SELECT id, name, customer_id, ont_sn FROM customers WHERE ont_sn IS NOT NULL AND ont_sn <> ""');
        const customerMap = {};
        customers.forEach(c => { customerMap[c.ont_sn.toLowerCase()] = c; });

        let online = 0, offline = 0;
        const mappedDevices = response.data.map(device => {
            const mapped = mapGenieACSDevice(device);
            if (mapped.online) online++; else offline++;

            const cust = customerMap[mapped.serial.toLowerCase()] || customerMap[mapped.id.toLowerCase()];
            if (cust) {
                mapped.customer_name = cust.name;
                mapped.customer_id = cust.customer_id;
            }
            return mapped;
        });

        res.json({
            success: true,
            stats: { total: mappedDevices.length, online, offline },
            data: mappedDevices
        });
    } catch (err) {
        res.json({ success: false, error: 'GenieACS connection failed: ' + err.message });
    }
});

// GET /api/genieacs/devices/:id
app.get('/api/genieacs/devices/:id', authenticateAPI, async (req, res) => {
    const { nbi_url, auth } = getGenieACSConfig(req);
    if (!nbi_url) return res.json({ success: false, error: 'URL GenieACS belum dikonfigurasi.' });

    try {
        const devId = req.params.id;
        const response = await axios.get(`${nbi_url}/devices?query=${encodeURIComponent(JSON.stringify({ _id: devId }))}`, { auth, timeout: 5000 });
        if (!response.data || response.data.length === 0) {
            return res.json({ success: false, error: 'Device not found in GenieACS' });
        }

        const device = response.data[0];
        const mapped = mapGenieACSDevice(device);

        let tx_power = getField(device, PATHS.txPower);
        if (tx_power !== null && tx_power !== undefined) {
            tx_power = parseFloat(tx_power);
            if (tx_power > 0) tx_power = -tx_power;
            if (tx_power < -100) tx_power = tx_power / 100;
            if (tx_power < -100) tx_power = tx_power / 10;
            if (tx_power > 10 || tx_power < -40 || isNaN(tx_power)) tx_power = null;
        } else {
            tx_power = null;
        }

        // Save to signal history in DB
        if (mapped.serial && mapped.rx_power !== null) {
            try {
                await db.query(
                    'INSERT INTO ont_signal_history (serial, rx_power, tx_power) VALUES (?, ?, ?)',
                    [mapped.serial, mapped.rx_power, tx_power]
                );
            } catch (historyErr) {
                console.error('Error saving signal history:', historyErr.message);
            }
        }

        const ssid_2g = getField(device, PATHS.ssid2g) || '';
        const password_2g = getField(device, PATHS.pass2g) || '';
        const ssid_5g = getField(device, PATHS.ssid5g) || '';
        const password_5g = getField(device, PATHS.pass5g) || '';

        res.json({
            success: true,
            data: {
                id: mapped.id,
                manufacturer: mapped.manufacturer,
                model: mapped.model,
                serial_number: mapped.serial,
                software_version: getField(device, PATHS.software) || 'V1.0',
                online: mapped.online,
                last_inform: mapped.last_inform,
                signal: {
                    wan_ip: mapped.wan_ip,
                    wan_status: mapped.online ? 'Connected' : 'Disconnected',
                    uptime_formatted: mapped.uptime_formatted,
                    rx_power: mapped.rx_power,
                    tx_power: tx_power,
                    temperature: mapped.temperature
                },
                wifi: {
                    ssid_2g,
                    password_2g,
                    ssid_5g,
                    password_5g
                }
            }
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// POST /api/genieacs/devices/:id/wifi
app.post('/api/genieacs/devices/:id/wifi', authenticateAPI, async (req, res) => {
    const { nbi_url, auth } = getGenieACSConfig(req);
    if (!nbi_url) return res.json({ success: false, error: 'URL GenieACS belum dikonfigurasi.' });

    const devId = req.params.id;
    const { ssid, password, band, ssid_5g, password_5g } = req.body;

    try {
        const response = await axios.get(`${nbi_url}/devices?query=${encodeURIComponent(JSON.stringify({ _id: devId }))}`, { auth, timeout: 5000 });
        if (!response.data || response.data.length === 0) {
            return res.json({ success: false, error: 'Device not found' });
        }
        const device = response.data[0];
        const prefix = device.InternetGatewayDevice ? 'InternetGatewayDevice' : 'Device';

        const parameterValues = [];
        if (prefix === 'InternetGatewayDevice') {
            if (ssid) parameterValues.push([`${prefix}.LANDevice.1.WLANConfiguration.1.SSID`, ssid, 'xsd:string']);
            if (password) parameterValues.push([`${prefix}.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey`, password, 'xsd:string']);
            if (band === 'both') {
                if (ssid_5g) parameterValues.push([`${prefix}.LANDevice.1.WLANConfiguration.5.SSID`, ssid_5g, 'xsd:string']);
                if (password_5g) parameterValues.push([`${prefix}.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey`, password_5g, 'xsd:string']);
            }
        } else {
            if (ssid) parameterValues.push(['Device.WiFi.SSID.1.SSID', ssid, 'xsd:string']);
            if (password) parameterValues.push(['Device.WiFi.AccessPoint.1.Security.PreSharedKey', password, 'xsd:string']);
            if (band === 'both') {
                if (ssid_5g) parameterValues.push(['Device.WiFi.SSID.2.SSID', ssid_5g, 'xsd:string']);
                if (password_5g) parameterValues.push(['Device.WiFi.AccessPoint.2.Security.PreSharedKey', password_5g, 'xsd:string']);
            }
        }

        if (parameterValues.length === 0) {
            return res.json({ success: false, error: 'No parameters to update' });
        }

        const task = { name: 'setParameterValues', parameterValues };
        await axios.post(`${nbi_url}/devices/${encodeURIComponent(devId)}/tasks?connection_request`, task, { auth, timeout: 10000 });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// POST /api/genieacs/devices/:id/reboot
app.post('/api/genieacs/devices/:id/reboot', authenticateAPI, async (req, res) => {
    const { nbi_url, auth } = getGenieACSConfig(req);
    if (!nbi_url) return res.json({ success: false, error: 'URL GenieACS belum dikonfigurasi.' });
    try {
        await axios.post(`${nbi_url}/devices/${encodeURIComponent(req.params.id)}/tasks?connection_request`, { name: 'reboot' }, { auth, timeout: 10000 });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// POST /api/genieacs/devices/:id/factory-reset
app.post('/api/genieacs/devices/:id/factory-reset', authenticateAPI, async (req, res) => {
    const { nbi_url, auth } = getGenieACSConfig(req);
    if (!nbi_url) return res.json({ success: false, error: 'URL GenieACS belum dikonfigurasi.' });
    try {
        await axios.post(`${nbi_url}/devices/${encodeURIComponent(req.params.id)}/tasks?connection_request`, { name: 'factoryReset' }, { auth, timeout: 10000 });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// POST /api/genieacs/devices/:id/refresh
app.post('/api/genieacs/devices/:id/refresh', authenticateAPI, async (req, res) => {
    const { nbi_url, auth } = getGenieACSConfig(req);
    if (!nbi_url) return res.json({ success: false, error: 'URL GenieACS belum dikonfigurasi.' });
    try {
        const { objectName } = req.body;
        const response = await axios.get(`${nbi_url}/devices?query=${encodeURIComponent(JSON.stringify({ _id: req.params.id }))}`, { auth, timeout: 5000 });
        const prefix = (response.data && response.data[0] && response.data[0].InternetGatewayDevice) ? 'InternetGatewayDevice' : 'Device';
        await axios.post(`${nbi_url}/devices/${encodeURIComponent(req.params.id)}/tasks?connection_request`, { name: 'refreshObject', objectName: objectName || prefix }, { auth, timeout: 10000 });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// GET /api/genieacs/devices/:id/clients
app.get('/api/genieacs/devices/:id/clients', authenticateAPI, async (req, res) => {
    const { nbi_url, auth } = getGenieACSConfig(req);
    if (!nbi_url) return res.json({ success: false, error: 'URL GenieACS belum dikonfigurasi.' });

    try {
        const response = await axios.get(`${nbi_url}/devices?query=${encodeURIComponent(JSON.stringify({ _id: req.params.id }))}`, { auth, timeout: 5000 });
        if (!response.data || response.data.length === 0) {
            return res.json({ success: false, error: 'Device not found' });
        }
        const device = response.data[0];
        const prefix = device.InternetGatewayDevice ? 'InternetGatewayDevice' : 'Device';
        const hostsNode = getParamNode(device, prefix === 'InternetGatewayDevice' ? 'InternetGatewayDevice.LANDevice.1.Hosts.Host' : 'Device.Hosts.Host');

        const clients = [];
        let wifiCount = 0;
        let ethCount = 0;

        if (hostsNode && typeof hostsNode === 'object') {
            for (const key in hostsNode) {
                if (!isNaN(key)) {
                    const host = hostsNode[key];
                    const active = host.Active && (host.Active._value === true || host.Active._value === 'true');
                    if (active || host.Active === undefined) {
                        const typeVal = host.InterfaceType && host.InterfaceType._value ? String(host.InterfaceType._value).toLowerCase() : '';
                        const layer1 = host.Layer1Interface && host.Layer1Interface._value ? String(host.Layer1Interface._value).toLowerCase() : '';
                        const hasSignal = (host.SignalStrength && host.SignalStrength._value !== undefined) || 
                                          (host.RSSI && host.RSSI._value !== undefined) ||
                                          (host.Signal && host.Signal._value !== undefined);

                        let isWifi = false;
                        if (typeVal) {
                            isWifi = typeVal.includes('802.11') || typeVal.includes('wifi') || typeVal.includes('wlan') || typeVal.includes('wireless');
                        } else if (layer1) {
                            isWifi = layer1.includes('wifi') || layer1.includes('wlan') || layer1.includes('ssid') || layer1.includes('wireless');
                        } else {
                            isWifi = hasSignal;
                        }

                        if (isWifi) wifiCount++; else ethCount++;

                        clients.push({
                            type: isWifi ? 'WiFi' : 'Ethernet',
                            hostname: host.HostName && host.HostName._value ? host.HostName._value : 'Unknown Client',
                            ip: host.IPAddress && host.IPAddress._value ? host.IPAddress._value : '',
                            mac: host.MACAddress && host.MACAddress._value ? host.MACAddress._value : '',
                            rssi: host.SignalStrength && host.SignalStrength._value ? parseInt(host.SignalStrength._value, 10) : null
                        });
                    }
                }
            }
        }

        res.json({
            success: true,
            total: clients.length,
            wifi: wifiCount,
            ethernet: ethCount,
            data: clients
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// GET /api/genieacs/devices/:id/rx-history
app.get('/api/genieacs/devices/:id/rx-history', authenticateAPI, async (req, res) => {
    const { nbi_url, auth } = getGenieACSConfig(req);
    if (!nbi_url) return res.json({ success: false, error: 'URL GenieACS belum dikonfigurasi.' });

    try {
        const response = await axios.get(`${nbi_url}/devices?query=${encodeURIComponent(JSON.stringify({ _id: req.params.id }))}`, { auth, timeout: 5000 });
        if (!response.data || response.data.length === 0) {
            return res.json({ success: false, error: 'Device not found' });
        }
        const mapped = mapGenieACSDevice(response.data[0]);
        if (!mapped.serial) {
            return res.json({ success: true, data: [] });
        }

        const hours = parseInt(req.query.hours, 10) || 6;
        const [rows] = await db.query(
            'SELECT rx_power as value, created_at as time FROM ont_signal_history WHERE serial = ? AND created_at >= NOW() - INTERVAL ? HOUR ORDER BY created_at ASC LIMIT 100',
            [mapped.serial, hours]
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// GET /api/genieacs/devices/:id/bandwidth
app.get('/api/genieacs/devices/:id/bandwidth', authenticateAPI, async (req, res) => {
    try {
        const devId = req.params.id;
        const decoded = decodeURIComponent(devId);
        const parts = decoded.split('-');
        const serial = parts.length >= 3 ? parts.slice(2).join('-') : decoded;

        // Find customer
        const [custs] = await db.query('SELECT id, name, customer_id, pppoe_username FROM customers WHERE ont_sn = ? OR customer_id = ? LIMIT 1', [serial, devId]);
        if (custs.length === 0) {
            return res.json({ success: false, error: 'No customer assigned to this ONT serial' });
        }

        const customer = custs[0];
        if (!customer.pppoe_username) {
            return res.json({ success: false, error: 'No PPPoE username configured for customer' });
        }

        const s = req.app.locals.settings || {};
        const host = s.mikrotik_host || process.env.MIKROTIK_HOST;
        if (!host) {
            return res.json({ success: false, error: 'MikroTik Router belum dikonfigurasi.' });
        }

        const { RouterOSAPI } = require('node-routeros');
        const conn = new RouterOSAPI({
            host: host,
            user: s.mikrotik_user || process.env.MIKROTIK_USER || 'admin',
            password: s.mikrotik_password || process.env.MIKROTIK_PASSWORD || '',
            port: parseInt(s.mikrotik_port || process.env.MIKROTIK_PORT || 8728, 10)
        });

        conn.on('error', () => {});
        await conn.connect();
        const queues = await conn.write('/queue/simple/print', [`?name=${customer.pppoe_username}`]);
        conn.close();

        if (queues.length === 0) {
            return res.json({ success: false, error: `Queue simple tidak ditemukan untuk username: ${customer.pppoe_username}` });
        }

        const [txBps, rxBps] = queues[0].rate.split('/').map(Number);
        const dlMbps = (rxBps / 1000000).toFixed(2);
        const ulKbps = (txBps / 1000).toFixed(0);

        res.json({
            success: true,
            customer: { name: customer.name, customer_id: customer.customer_id },
            source: 'queue',
            data: {
                rx_display: { value: parseFloat(dlMbps), unit: 'Mbps' },
                tx_display: { value: parseFloat(ulKbps), unit: 'Kbps' },
                rx_rate: rxBps >= 1000000 ? `${dlMbps} Mbps` : `${(rxBps / 1000).toFixed(0)} Kbps`,
                tx_rate: txBps >= 1000000 ? `${(txBps / 1000000).toFixed(2)} Mbps` : `${ulKbps} Kbps`,
                dl_pct: Math.round((rxBps / (rxBps + txBps || 1)) * 100),
                ul_pct: Math.round((txBps / (rxBps + txBps || 1)) * 100)
            }
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// GET /api/genieacs/devices/:id/customer [NEW]
app.get('/api/genieacs/devices/:id/customer', authenticateAPI, async (req, res) => {
    try {
        const decoded = decodeURIComponent(req.params.id);
        const parts = decoded.split('-');
        const serial = parts.length >= 3 ? parts.slice(2).join('-') : decoded;

        const [rows] = await db.query('SELECT id, name, customer_id, status, phone FROM customers WHERE ont_sn = ? OR customer_id = ? LIMIT 1', [serial, req.params.id]);
        if (rows.length === 0) {
            return res.json({ success: false, message: 'Not assigned' });
        }
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/genieacs/customers/search [NEW]
app.get('/api/genieacs/customers/search', authenticateAPI, async (req, res) => {
    const q = req.query.q || '';
    try {
        const [rows] = await db.query(
            'SELECT id, name, customer_id, status, ont_sn FROM customers WHERE name LIKE ? OR customer_id LIKE ? OR phone LIKE ? LIMIT 10',
            [`%${q}%`, `%${q}%`, `%${q}%`]
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/genieacs/devices/:id/assign [NEW]
app.post('/api/genieacs/devices/:id/assign', authenticateAPI, async (req, res) => {
    const { customer_id, serial } = req.body;
    try {
        if (customer_id) {
            // Unassign from anyone else first
            await db.query('UPDATE customers SET ont_sn = NULL WHERE ont_sn = ?', [serial]);
            await db.query('UPDATE customers SET ont_sn = ? WHERE id = ?', [serial, customer_id]);
        } else {
            await db.query('UPDATE customers SET ont_sn = NULL WHERE ont_sn = ?', [serial]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Ping Monitor APIs
app.get('/api/monitoring/ping/stats', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT status, COUNT(*) as count FROM ping_targets GROUP BY status');
        let up = 0, down = 0;
        rows.forEach(r => { if (r.status === 'up') up = r.count; else if (r.status === 'down') down = r.count; });
        res.json({ success: true, data: { total: up + down, up, down, avg_latency: 0 } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/monitoring/ping/targets', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, name, host as target, status, last_latency as latency, packet_loss as loss FROM ping_targets');
        res.json({ success: true, data: rows });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/monitoring/ping/targets', authenticateAPI, async (req, res) => {
    const { name, target } = req.body;
    try {
        const [result] = await db.query('INSERT INTO ping_targets (name, host) VALUES (?, ?)', [name, target]);
        res.json({ success: true, data: { id: result.insertId } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/monitoring/ping/targets/:id', authenticateAPI, async (req, res) => {
    const { name, target } = req.body;
    try {
        await db.query('UPDATE ping_targets SET name=?, host=? WHERE id=?', [name, target, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/monitoring/ping/targets/:id', authenticateAPI, async (req, res) => {
    try {
        await db.query('DELETE FROM ping_targets WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/monitoring/ping/targets/:id/check', authenticateAPI, (req, res) => {
    res.json({ success: true }); // Real ping logic can be added later
});

// Device Monitor APIs (Mocked fallbacks)
app.get('/api/device-monitor/devices', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM devices ORDER BY id ASC');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/device-monitor/:id/realtime', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM devices WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.json({ success: false, message: 'Device not found' });
        const dev = rows[0];

        if (dev.monitoring_type === 'api' || !dev.monitoring_type) {
            const { RouterOSAPI } = require('node-routeros');
            const conn = new RouterOSAPI({
                host: dev.ip_address,
                port: dev.api_port || 8728,
                user: dev.api_username || 'admin',
                password: dev.api_password || ''
            });
            conn.on('error', () => {});
            try {
                await conn.connect();
                const resources = await conn.write('/system/resource/print');
                const intfs = await conn.write('/interface/print');
                const traffic = await conn.write('/interface/monitor-traffic', ['=interface=all', '=once=']);
                conn.close();

                let cpu = 0;
                let memUsed = 0;
                let memTotal = 0;
                let memPercent = 0;
                let diskFree = 0;
                let diskTotal = 0;
                let diskPercent = 0;
                let uptime = '';
                let firmware = '';
                let model = '';

                if (resources && resources.length > 0) {
                    const r = resources[0];
                    cpu = parseInt(r['cpu-load'] || '0', 10);
                    const totalRam = parseInt(r['total-memory'] || '1', 10);
                    const freeRam = parseInt(r['free-memory'] || '0', 10);
                    memTotal = Math.round(totalRam / 1024 / 1024);
                    memUsed = Math.round((totalRam - freeRam) / 1024 / 1024);
                    memPercent = Math.round((memUsed / memTotal) * 100);

                    const totalHdd = parseInt(r['total-hdd-space'] || '1', 10);
                    const freeHdd = parseInt(r['free-hdd-space'] || '0', 10);
                    diskTotal = Math.round(totalHdd / 1024 / 1024);
                    diskFree = Math.round(freeHdd / 1024 / 1024);
                    diskPercent = Math.round(((diskTotal - diskFree) / diskTotal) * 100);

                    uptime = r['uptime'] || '0s';
                    firmware = r['version'] || 'N/A';
                    model = r['board-name'] || 'Unknown';
                }

                let totalRx = 0, totalTx = 0;
                const interfaces = intfs.map(i => {
                    const t = traffic.find(tf => tf.name === i.name) || {};
                    const rxBps = parseInt(t['rx-bits-per-second'] || '0', 10);
                    const txBps = parseInt(t['tx-bits-per-second'] || '0', 10);
                    totalRx += rxBps;
                    totalTx += txBps;
                    return {
                        name: i.name,
                        type: i.type,
                        running: i.running === 'true' || i.running === true,
                        rxMbps: parseFloat((rxBps / 1000000).toFixed(2)),
                        txMbps: parseFloat((txBps / 1000000).toFixed(2))
                    };
                });

                res.json({
                    success: true,
                    data: {
                        cpu,
                        memPercent,
                        memUsed,
                        memTotal,
                        diskPercent,
                        diskFree,
                        diskTotal,
                        totalRxMbps: parseFloat((totalRx / 1000000).toFixed(2)),
                        totalTxMbps: parseFloat((totalTx / 1000000).toFixed(2)),
                        reachable: true,
                        uptime,
                        firmware,
                        protocol: 'api',
                        interfaces
                    }
                });
            } catch (connErr) {
                res.json({ success: true, data: { reachable: false, error: connErr.message } });
            }
        } else {
            res.json({ success: true, data: { reachable: false, error: 'SNMP realtime not implemented' } });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/device-monitor/:id/summary', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM devices WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Device not found' });
        const dev = rows[0];
        res.json({
            success: true,
            data: {
                id: dev.id,
                name: dev.name,
                ip_address: dev.ip_address,
                firmware: 'N/A',
                brand: 'MikroTik',
                model: 'RouterOS Device',
                monitoring_type: dev.monitoring_type || 'api'
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/device-monitor/:id/history', authenticateAPI, async (req, res) => {
    const hours = parseInt(req.query.hours, 10) || 1;
    try {
        const [rows] = await db.query(
            'SELECT cpu_load as cpu, memory_usage as memory, disk_usage as disk, rx_mbps as rx, tx_mbps as tx, created_at FROM device_metrics_history WHERE device_id = ? AND created_at >= NOW() - INTERVAL ? HOUR ORDER BY created_at ASC LIMIT 500',
            [req.params.id, hours]
        );

        const timestamps = rows.map(r => new Date(r.created_at).getTime());
        const cpu = rows.map(r => r.cpu);
        const memory = rows.map(r => r.memory);
        const disk = rows.map(r => r.disk);
        const rx = rows.map(r => parseFloat(r.rx));
        const tx = rows.map(r => parseFloat(r.tx));

        res.json({
            success: true,
            data: { timestamps, cpu, memory, disk, rx, tx }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/device-monitor/test-connection', authenticateAPI, async (req, res) => {
    const { ip_address, monitoring_type, api_port, api_username, api_password, snmp_community, snmp_version, snmp_port } = req.body;

    if (monitoring_type === 'api' || !monitoring_type) {
        const { RouterOSAPI } = require('node-routeros');
        const conn = new RouterOSAPI({
            host: ip_address,
            port: parseInt(api_port || 8728, 10),
            user: api_username || 'admin',
            password: api_password || ''
        });
        conn.on('error', () => {});
        try {
            await conn.connect();
            conn.close();
            res.json({ success: true, message: 'Koneksi API RouterOS Berhasil!' });
        } catch (err) {
            res.json({ success: false, error: err.message });
        }
    } else if (monitoring_type === 'snmp') {
        const snmp = require('net-snmp');
        try {
            const session = snmp.createSession(ip_address, snmp_community || 'public', {
                port: parseInt(snmp_port || 161, 10),
                timeout: 3000,
                retries: 1
            });
            session.get(['1.3.6.1.2.1.1.1.0'], (error, varbinds) => {
                if (error) {
                    res.json({ success: false, error: error.message });
                } else {
                    res.json({ success: true, message: 'Koneksi SNMP Berhasil!' });
                }
                session.close();
            });
        } catch (err) {
            res.json({ success: false, error: err.message });
        }
    }
});

app.post('/api/device-monitor/devices', authenticateAPI, async (req, res) => {
    const { name, ip_address, monitoring_type, api_port, api_username, api_password, snmp_community, snmp_version, snmp_port } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO devices (name, ip_address, monitoring_type, api_port, api_username, api_password, snmp_community, snmp_version, snmp_port, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, ip_address, monitoring_type || 'api', api_port || 8728, api_username || 'admin', api_password || '', snmp_community || 'public', snmp_version || '2', snmp_port || 161, 'offline']
        );
        res.json({ success: true, data: { id: result.insertId } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.put('/api/device-monitor/devices/:id', authenticateAPI, async (req, res) => {
    const { name, ip_address, monitoring_type, api_port, api_username, api_password, snmp_community, snmp_version, snmp_port } = req.body;
    try {
        await db.query(
            'UPDATE devices SET name=?, ip_address=?, monitoring_type=?, api_port=?, api_username=?, api_password=?, snmp_community=?, snmp_version=?, snmp_port=? WHERE id=?',
            [name, ip_address, monitoring_type || 'api', api_port || 8728, api_username || 'admin', api_password || '', snmp_community || 'public', snmp_version || '2', snmp_port || 161, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.delete('/api/device-monitor/devices/:id', authenticateAPI, async (req, res) => {
    try {
        await db.query('DELETE FROM devices WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// Todos & Users APIs
app.get('/api/users', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, uuid, name, email, role_id, role_name, phone, is_active FROM users ORDER BY name ASC');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.post('/api/todos', authenticateAPI, async (req, res) => {
    const { title, description, status, priority, due_date, assigned_to } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO todos (title, description, status, priority, due_date, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [title, description || '', status || 'todo', priority || 'medium', due_date || null, assigned_to || null, req.user?.id || 1]
        );
        res.json({ success: true, data: { id: result.insertId } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.put('/api/todos/:id', authenticateAPI, async (req, res) => {
    const { title, description, status, priority, due_date, assigned_to } = req.body;
    try {
        await db.query(
            'UPDATE todos SET title=?, description=?, status=?, priority=?, due_date=?, assigned_to=? WHERE id=?',
            [title, description || '', status || 'todo', priority || 'medium', due_date || null, assigned_to || null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.patch('/api/todos/:id/status', authenticateAPI, async (req, res) => {
    try {
        await db.query('UPDATE todos SET status=? WHERE id=?', [req.body.status, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.delete('/api/todos/:id', authenticateAPI, async (req, res) => {
    try {
        await db.query('DELETE FROM todos WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

// Removed mock Message Logs APIs because DB versions exist below

// Infrastructure Map APIs
app.get('/api/infrastructure/map', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, name, type, latitude, longitude, status, description FROM infrastructure_points');
        res.json({ success: true, data: rows });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/infrastructure-links', authenticateAPI, async (req, res) => {
    res.json({ success: true, data: [] }); // Links not implemented in DB yet
});

app.put('/api/infrastructure/:id', authenticateAPI, async (req, res) => {
    const { name, type, latitude, longitude, status, description } = req.body;
    try {
        await db.query('UPDATE infrastructure_points SET name=?, type=?, latitude=?, longitude=?, status=?, description=? WHERE id=?',
            [name, type, latitude, longitude, status, description, req.params.id]);
        res.json({ success: true, message: 'Position updated' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/infrastructure/:id', authenticateAPI, async (req, res) => {
    try {
        await db.query('DELETE FROM infrastructure_points WHERE id=?', [req.params.id]);
        res.json({ success: true, message: 'Point deleted' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/infrastructure', authenticateAPI, async (req, res) => {
    const { name, type, latitude, longitude, status, description } = req.body;
    try {
        const [result] = await db.query('INSERT INTO infrastructure_points (name, type, latitude, longitude, status, description) VALUES (?, ?, ?, ?, ?, ?)',
            [name || 'New Point', type || 'odp', latitude, longitude, status || 'active', description || '']);
        res.json({ success: true, message: 'Point added', data: { id: result.insertId } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/infrastructure-links', authenticateAPI, (req, res) => {
    res.json({ success: true, message: 'Link added' });
});

// Other hardware mocks (Customer traffic, OLT power) left for phase 2

app.delete('/api/infrastructure-links/:id', authenticateAPI, (req, res) => {
    res.json({ success: true, message: 'Link deleted' });
});

app.post('/api/infrastructure/upload-photo', authenticateAPI, (req, res) => {
    res.json({ success: true, data: { url: '/placeholder.jpg' } });
});

// Dashboard APIs
app.get('/api/dashboard/top-customers', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query(`
      SELECT c.name, c.email, SUM(i.amount) as total_spent 
      FROM customers c 
      JOIN invoices i ON c.id = i.customer_id 
      WHERE i.status = 'paid' 
      GROUP BY c.id 
      ORDER BY total_spent DESC 
      LIMIT 10
    `);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/dashboard/network-uptime', authenticateAPI, async (req, res) => {
    try {
        const [devices] = await db.query('SELECT name as device_name, ip_address as device_ip, status as current_status FROM devices');

        let onlineCount = 0;
        let criticalCount = 0;
        const mappedDevices = devices.map(d => {
            const isOnline = d.current_status === 'online';
            if (isOnline) onlineCount++;
            else criticalCount++;

            return {
                device_name: d.device_name,
                device_ip: d.device_ip,
                current_status: d.current_status,
                uptime_percent: isOnline ? 100 : 0,
                downtime_incidents: isOnline ? 0 : 1
            };
        });

        const avgUptime = devices.length > 0 ? ((onlineCount / devices.length) * 100).toFixed(2) : "0.00";

        res.json({
            success: true,
            data: {
                summary: { average_uptime: avgUptime, critical_devices: criticalCount },
                devices: mappedDevices
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/dashboard/ticket-stats', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT status, COUNT(*) as count FROM tickets GROUP BY status');
        let open = 0, resolved = 0;
        rows.forEach(r => {
            if (r.status === 'open' || r.status === 'in_progress') open += r.count;
            if (r.status === 'resolved' || r.status === 'closed') resolved += r.count;
        });

        const [avgRows] = await db.query('SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, resolved_at)) as avg_res FROM tickets WHERE resolved_at IS NOT NULL');
        const avg_res = avgRows[0].avg_res ? parseFloat(avgRows[0].avg_res).toFixed(1) : "0.0";

        res.json({
            success: true,
            data: {
                summary: { open_tickets: open, resolved_tickets: resolved, avg_resolution_hours: avg_res }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/dashboard/bandwidth-trends', authenticateAPI, (req, res) => {
    const period = req.query.period || 'daily';

    // For realtime, return the in-memory polled history (last 60 mins).
    // For daily/weekly, we return the same since we don't have a DB traffic history table yet.
    // Ensure newest items come first if the frontend expects reversed arrays.
    const reversedHistory = [...mikrotikCache.history].reverse();

    // Ensure we have at least 1 point to prevent frontend errors
    if (reversedHistory.length === 0) {
        const now = new Date();
        reversedHistory.push({
            date: now.toISOString().split('T')[0],
            hour: now.getHours(),
            minute: now.getMinutes(),
            avg_download_mbps: (mikrotikCache.rx_bps / 1000000).toFixed(2),
            avg_upload_mbps: (mikrotikCache.tx_bps / 1000000).toFixed(2)
        });
    }

    res.json({ success: true, data: reversedHistory });
});

app.get('/api/dashboard/customer-growth', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count 
            FROM customers 
            GROUP BY month 
            ORDER BY month ASC 
            LIMIT 12
        `);

        let cumulative = 0;
        let growthRate = 0;

        const mapped = rows.map((r, idx) => {
            cumulative += r.count;
            if (idx === rows.length - 1 && rows.length > 1) {
                const prev = rows[idx - 1].count;
                if (prev > 0) {
                    growthRate = ((r.count - prev) / prev) * 100;
                } else if (r.count > 0) {
                    growthRate = 100;
                }
            }
            return {
                month: r.month,
                new_customers: r.count,
                cumulative_total: cumulative
            };
        });

        res.json({
            success: true,
            data: {
                summary: {
                    total_customers: cumulative,
                    growth_rate: growthRate.toFixed(1)
                },
                monthly_data: mapped
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/dashboard/revenue-forecast', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT DATE_FORMAT(paid_date, '%Y-%m') as month, SUM(amount) as revenue 
            FROM invoices 
            WHERE status = 'paid' AND paid_date IS NOT NULL
            GROUP BY month 
            ORDER BY month ASC 
            LIMIT 6
        `);

        const historical = rows.map(r => ({
            month: r.month,
            total_revenue: parseFloat(r.revenue)
        }));

        let currentMonthRevenue = 0;
        let avgRevenue = 0;
        if (historical.length > 0) {
            currentMonthRevenue = historical[historical.length - 1].total_revenue;
            const last3 = historical.slice(-3);
            avgRevenue = last3.reduce((sum, item) => sum + item.total_revenue, 0) / last3.length;
        }

        const forecast = [];
        let d = new Date();
        for (let i = 1; i <= 3; i++) {
            d.setMonth(d.getMonth() + 1);
            let monthStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            // forecast growth by 2% each month
            let forecasted_revenue = avgRevenue * Math.pow(1.02, i);
            forecast.push({ month: monthStr, forecasted_revenue: Math.round(forecasted_revenue) });
        }

        res.json({
            success: true,
            data: {
                summary: { current_month_revenue: currentMonthRevenue },
                historical: historical,
                forecast: forecast
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// External Routes
app.use('/api/olt', require('./routes/olt'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/infrastructure', require('./routes/infrastructure'));
app.use('/api/packages', require('./routes/packages'));
// Endpoint untuk System Resources
app.get('/api/system/resources/data', authenticateAPI, async (req, res) => {
    const os = require('os');

    // Real data for server
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = Math.round((usedMem / totalMem) * 100);

    const getCpuTimes = () => {
        const cpuInfos = os.cpus();
        let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
        for (const cpu of cpuInfos) {
            user += cpu.times.user;
            nice += cpu.times.nice;
            sys += cpu.times.sys;
            idle += cpu.times.idle;
            irq += cpu.times.irq;
        }
        const total = user + nice + sys + idle + irq;
        return { idle, total };
    };

    const startTimes = getCpuTimes();
    await new Promise(resolve => setTimeout(resolve, 100));
    const endTimes = getCpuTimes();
    const idleDiff = endTimes.idle - startTimes.idle;
    const totalDiff = endTimes.total - startTimes.total;
    const cpuLoad = totalDiff > 0 ? Math.max(0, Math.min(100, 100 - Math.round((100 * idleDiff) / totalDiff))) : 0;

    const uptimeHours = Math.floor(os.uptime() / 3600);
    const uptimeMinutes = Math.floor((os.uptime() % 3600) / 60);

    const s = req.app.locals.settings || {};
    const host = s.mikrotik_host || process.env.MIKROTIK_HOST;

    let routerData = {
        board: 'Not Connected',
        version: 'N/A',
        uptime: '0s',
        cpu_load: 0,
        ram_usage: 0,
        ram_detail: '0MB / 0MB',
        disk_usage: 0,
        disk_detail: '0MB / 0MB'
    };

    if (host) {
        try {
            const conn = getMikrotikConn(req);
            await conn.connect();
            const resources = await conn.write('/system/resource/print');
            conn.close();

            if (resources && resources.length > 0) {
                const r = resources[0];
                const totalRam = parseInt(r['total-memory'] || '1', 10);
                const freeRam = parseInt(r['free-memory'] || '0', 10);
                const usedRam = totalRam - freeRam;
                const totalHdd = parseInt(r['total-hdd-space'] || '1', 10);
                const freeHdd = parseInt(r['free-hdd-space'] || '0', 10);
                const usedHdd = totalHdd - freeHdd;

                routerData = {
                    board: r['board-name'] || 'Unknown',
                    version: r['version'] || 'Unknown',
                    uptime: r['uptime'] || '0s',
                    cpu_load: parseInt(r['cpu-load'] || '0', 10),
                    ram_usage: Math.round((usedRam / totalRam) * 100),
                    ram_detail: `${(usedRam / 1024 / 1024).toFixed(1)}MB / ${(totalRam / 1024 / 1024).toFixed(1)}MB`,
                    disk_usage: Math.round((usedHdd / totalHdd) * 100),
                    disk_detail: `${(usedHdd / 1024 / 1024).toFixed(1)}MB / ${(totalHdd / 1024 / 1024).toFixed(1)}MB`
                };
            }
        } catch (err) {
            console.warn("Failed to get router resources:", err.message);
            routerData.board = 'Connection Error';
        }
    }

    res.json({
        success: true,
        data: {
            router: routerData,
            server: {
                platform: os.type() + ' ' + os.release(),
                node_version: process.version,
                uptime: `${uptimeHours}h ${uptimeMinutes}m`,
                cpu_load: cpuLoad,
                ram_usage: memUsage,
                ram_detail: `${Math.round(usedMem / 1024 / 1024)}MB / ${Math.round(totalMem / 1024 / 1024)}MB`
            }
        }
    });
});



// Socket.io integration to broadcast real-time metrics
io.on('connection', (socket) => {
    console.log('Socket client connected:', socket.id);

    const interval = setInterval(() => {
        socket.emit('monitoring:metrics', {
            timestamp: new Date(),
            cpu: mikrotikCache.cpu || 2,
            ram: 42,
            bandwidth_rx: mikrotikCache.rx_bps || 0,
            bandwidth_tx: mikrotikCache.tx_bps || 0
        });
    }, 2000);

    socket.on('disconnect', () => {
        clearInterval(interval);
        console.log('Socket client disconnected:', socket.id);
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`========================================================================`);
    console.log(`   SKMNetwork Dashboard listening on http://localhost:${PORT}`);
    console.log(`========================================================================`);
});

// --- MESSAGE LOGS API ---
app.get('/api/message-logs/stats', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT status, COUNT(*) as count FROM message_logs GROUP BY status');
        let sent = 0, failed = 0, total = 0;
        rows.forEach(r => {
            total += r.count;
            if (r.status === 'sent') sent += r.count;
            else if (r.status === 'failed') failed += r.count;
        });
        res.json({
            success: true,
            data: {
                outgoing: { total, today: total, sent, failed },
                incoming: { total: 0, unread: 0, today: 0 },
                avg_duration_ms: 120
            }
        });
    } catch (err) {
        res.json({ success: true, data: { outgoing: { total: 0, today: 0, sent: 0, failed: 0 }, incoming: { total: 0, unread: 0, today: 0 }, avg_duration_ms: 0 } });
    }
});

app.get('/api/message-logs/chart', authenticateAPI, async (req, res) => {
    res.json({
        success: true,
        data: {
            labels: [new Date().toISOString()],
            data: [{ sent: 0, incoming: 0, failed: 0 }]
        }
    });
});

app.get('/api/message-logs/breakdown', authenticateAPI, async (req, res) => {
    res.json({
        success: true,
        data: [
            { type: 'Notifikasi', value: 10, color: '#1a6ef5' }
        ]
    });
});

app.get('/api/message-logs/outgoing', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM message_logs ORDER BY created_at DESC LIMIT 50');
        res.json({
            success: true,
            data: rows.map(r => ({
                id: r.id,
                recipient_name: 'User ' + r.phone,
                recipient_number: r.phone,
                message: r.message,
                status: r.status,
                sent_at: r.created_at,
                category: r.type,
                duration_ms: 150
            }))
        });
    } catch (err) {
        res.json({ success: true, data: [] });
    }
});

app.get('/api/message-logs/incoming', authenticateAPI, async (req, res) => {
    res.json({ success: true, data: [] });
});



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
            const s = `%${req.query.search}%`;
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

        // Validasi input
        if (!type || !category || !description || amount === undefined || !date) {
            return res.status(400).json({ success: false, message: 'Semua field wajib harus diisi (type, category, description, amount, date).' });
        }

        const validTypes = ['pemasukan', 'pengeluaran', 'hutang', 'piutang', 'modal'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ success: false, message: 'Tipe transaksi tidak valid.' });
        }

        const parsedAmount = Number(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Jumlah transaksi harus berupa angka positif.' });
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({ success: false, message: 'Format tanggal tidak valid. Harus YYYY-MM-DD.' });
        }

        if (due_date && !dateRegex.test(due_date)) {
            return res.status(400).json({ success: false, message: 'Format tanggal jatuh tempo tidak valid. Harus YYYY-MM-DD.' });
        }

        const q = `INSERT INTO finance_transactions 
            (type, category, description, amount, date, reference_no, party_name, due_date, status, source, notes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [type, category, description, parsedAmount, date, reference_no || null, party_name || null, due_date || null, status || 'lunas', source || null, notes || null];
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

        // Validasi input
        if (!type || !category || !description || amount === undefined || !date) {
            return res.status(400).json({ success: false, message: 'Semua field wajib harus diisi (type, category, description, amount, date).' });
        }

        const validTypes = ['pemasukan', 'pengeluaran', 'hutang', 'piutang', 'modal'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ success: false, message: 'Tipe transaksi tidak valid.' });
        }

        const parsedAmount = Number(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Jumlah transaksi harus berupa angka positif.' });
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({ success: false, message: 'Format tanggal tidak valid. Harus YYYY-MM-DD.' });
        }

        if (due_date && !dateRegex.test(due_date)) {
            return res.status(400).json({ success: false, message: 'Format tanggal jatuh tempo tidak valid. Harus YYYY-MM-DD.' });
        }

        const q = `UPDATE finance_transactions SET 
            type=?, category=?, description=?, amount=?, date=?, reference_no=?, party_name=?, due_date=?, status=?, source=?, notes=? 
            WHERE id=?`;
        const params = [type, category, description, parsedAmount, date, reference_no || null, party_name || null, due_date || null, status || 'lunas', source || null, notes || null, id];
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

        const [kpiRows] = await db.query(`
            SELECT type, SUM(amount) as total 
            FROM finance_transactions 
            WHERE MONTH(date) = ? AND YEAR(date) = ?
            GROUP BY type
        `, [month, year]);

        const kpi = {
            pemasukan: 0, pengeluaran: 0, hutang: 0, piutang: 0, modal: 0, net: 0
        };
        kpiRows.forEach(r => {
            if (kpi[r.type] !== undefined) kpi[r.type] = Number(r.total) || 0;
        });
        kpi.net = kpi.pemasukan - kpi.pengeluaran;

        const [catRows] = await db.query(`
            SELECT category, SUM(amount) as total 
            FROM finance_transactions 
            WHERE type = 'pengeluaran' AND MONTH(date) = ? AND YEAR(date) = ?
            GROUP BY category ORDER BY total DESC LIMIT 5
        `, [month, year]);

        const trend = { labels: [], pemasukan: [], pengeluaran: [], net: [] };
        for (let i = 5; i >= 0; i--) {
            let d = new Date(year, month - 1 - i, 1);
            let m = d.getMonth() + 1;
            let y = d.getFullYear();
            trend.labels.push(`${m}/${y}`);

            const [sums] = await db.query(`
                SELECT type, SUM(amount) as total 
                FROM finance_transactions 
                WHERE MONTH(date) = ? AND YEAR(date) = ?
                GROUP BY type
            `, [m, y]);

            let pIn = 0, pOut = 0;
            sums.forEach(r => {
                if (r.type === 'pemasukan') pIn = Number(r.total);
                if (r.type === 'pengeluaran') pOut = Number(r.total);
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

app.get('/api/whatsapp/config', authenticateAPI, (req, res) => {
    res.json({ success: true, data: _waCfg });
});

app.post('/api/whatsapp/config', authenticateAPI, async (req, res) => {
    _waCfg = { ..._waCfg, ...req.body };
    try {
        await db.query(
            'INSERT INTO app_settings (setting_key, setting_value, category, description) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['whatsapp_config', JSON.stringify(_waCfg), 'integration', 'Konfigurasi WhatsApp Gateway', JSON.stringify(_waCfg)]
        );
        if (req.app.locals.settings) {
            req.app.locals.settings.whatsapp_config = JSON.stringify(_waCfg);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error: ' + err.message });
    }
});

app.post('/api/whatsapp/test', authenticateAPI, async (req, res) => {
    const { to } = req.body;
    try {
        const result = await sendWhatsAppMessage(to || '081234567890', 'Test koneksi WhatsApp CRM RTRW Net berhasil!');
        res.json({ success: true, message: `Pesan test berhasil dikirim via ${_waCfg.engine}`, data: result.data });
    } catch (err) {
        res.json({ success: false, message: 'Gagal mengirim WhatsApp: ' + err.message });
    }
});

// ============================================
// PAYMENTS & TRANSACTIONS APIs & ROUTES
// ============================================

// GET /invoice/:paymentId (renders the printable invoice based on payment ID)
app.get('/invoice/:paymentId', authenticatePage, async (req, res) => {
    try {
        const [payments] = await db.query("SELECT * FROM payments WHERE id = ?", [req.params.paymentId]);
        if (payments.length === 0) {
            return res.status(404).send('Pembayaran tidak ditemukan.');
        }
        const payment = payments[0];
        const q = `
            SELECT i.*, 
                   c.name as customer_name, c.customer_id as customer_code, c.phone as customer_phone, c.address as customer_address, c.email as customer_email,
                   p.name as package_name, p.price as package_price, p.speed_down as package_speed_down, p.speed_up as package_speed_up
            FROM invoices i
            JOIN customers c ON i.customer_id = c.id
            LEFT JOIN packages p ON c.package_id = p.id
            WHERE i.id = ?
        `;
        const [rows] = await db.query(q, [payment.invoice_id]);
        if (rows.length === 0) {
            return res.status(404).send('Invoice tidak ditemukan.');
        }
        res.render('invoice', {
            invoice: rows[0],
            payment: payment
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error: ' + err.message);
    }
});

// GET /api/payments/customers (autocomplete search)
app.get('/api/payments/customers', authenticateAPI, async (req, res) => {
    const q = req.query.q || '';
    try {
        const queryStr = `
            SELECT c.id, c.name, c.customer_id, c.phone, c.billing_date,
                   p.name as package_name, p.price as package_price
            FROM customers c
            LEFT JOIN packages p ON c.package_id = p.id
            WHERE c.name LIKE ? OR c.customer_id LIKE ? OR c.phone LIKE ?
            LIMIT 10
        `;
        const s = `%${q}%`;
        const [rows] = await db.query(queryStr, [s, s, s]);

        const formatted = rows.map(r => ({
            id: r.id,
            name: r.name,
            customer_id: r.customer_id,
            phone: r.phone,
            billing_date: r.billing_date,
            package: {
                name: r.package_name,
                price: r.package_price
            }
        }));
        res.json({ success: true, data: formatted });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/payments/check-paid
app.get('/api/payments/check-paid', authenticateAPI, async (req, res) => {
    const { customer_id, month, year } = req.query;
    try {
        const [rows] = await db.query(
            "SELECT id, invoice_number, paid_date FROM invoices WHERE customer_id = ? AND period_month = ? AND period_year = ? AND status = 'paid'",
            [customer_id, month, year]
        );
        if (rows.length > 0) {
            return res.json({
                paid: true,
                invoice_number: rows[0].invoice_number,
                paid_date: rows[0].paid_date ? new Date(rows[0].paid_date).toISOString().slice(0, 10) : null
            });
        }
        res.json({ paid: false });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/payments/stats
app.get('/api/payments/stats', authenticateAPI, async (req, res) => {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    let pm = month - 1;
    let py = year;
    if (pm === 0) { pm = 12; py -= 1; }

    try {
        const [currStats] = await db.query(
            "SELECT SUM(amount) as total_amount, COUNT(*) as total_tx FROM payments WHERE MONTH(payment_date) = ? AND YEAR(payment_date) = ?",
            [month, year]
        );
        const [prevStats] = await db.query(
            "SELECT SUM(amount) as total_amount, COUNT(*) as total_tx FROM payments WHERE MONTH(payment_date) = ? AND YEAR(payment_date) = ?",
            [pm, py]
        );
        const [invStats] = await db.query(
            "SELECT SUM(amount) as total_amount, COUNT(*) as count FROM invoices WHERE period_month = ? AND period_year = ?",
            [month, year]
        );
        const [overdueStats] = await db.query(
            "SELECT SUM(amount) as total_amount, COUNT(*) as count FROM invoices WHERE status != 'paid'"
        );

        const [methodStatsRows] = await db.query(
            "SELECT payment_method as method, SUM(amount) as total FROM payments WHERE MONTH(payment_date) = ? AND YEAR(payment_date) = ? GROUP BY payment_method",
            [month, year]
        );

        const methodLabels = { cash: 'Cash', transfer: 'Transfer', dana: 'DANA', ovo: 'OVO', gopay: 'GoPay', qris: 'QRIS' };
        const methodStats = methodStatsRows.map(r => ({
            method: r.method,
            label: methodLabels[r.method] || r.method,
            total: parseFloat(r.total || 0)
        }));

        const total_tx = currStats[0].total_tx || 0;
        const prev_tx = prevStats[0].total_tx || 0;
        let growth_tx = null;
        if (prev_tx > 0) {
            growth_tx = Math.round((total_tx - prev_tx) / prev_tx * 100);
        } else if (total_tx > 0) {
            growth_tx = 100;
        }

        res.json({
            success: true,
            data: {
                month,
                year,
                total_amount: parseFloat(currStats[0].total_amount || 0),
                total_tx,
                prev_amount: parseFloat(prevStats[0].total_amount || 0),
                prev_tx,
                growth_tx,
                total_invoice_amount: parseFloat(invStats[0].total_amount || 0),
                total_invoices: invStats[0].count || 0,
                overdue_amount: parseFloat(overdueStats[0].total_amount || 0),
                overdue_count: overdueStats[0].count || 0,
                method_stats: methodStats
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/payments/chart
app.get('/api/payments/chart', authenticateAPI, async (req, res) => {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const daysInMonth = new Date(year, month, 0).getDate();
    const data = [];
    for (let d = 1; d <= daysInMonth; d++) {
        data.push({ day: d, total: 0, count: 0 });
    }

    try {
        const [rows] = await db.query(
            "SELECT DAY(payment_date) as day, SUM(amount) as total, COUNT(*) as count FROM payments WHERE MONTH(payment_date) = ? AND YEAR(payment_date) = ? GROUP BY DAY(payment_date)",
            [month, year]
        );
        rows.forEach(r => {
            const idx = r.day - 1;
            if (data[idx]) {
                data[idx].total = parseFloat(r.total || 0);
                data[idx].count = r.count;
            }
        });
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/payments/list
app.get('/api/payments/list', authenticateAPI, async (req, res) => {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    try {
        let q = `
            SELECT p.id, p.amount, p.payment_method, p.payment_date, p.reference_number,
                   i.invoice_number, i.period_month, i.period_year, i.due_date,
                   c.name as cust_name, c.customer_id as cid,
                   pkg.name as pkg_name,
                   p.payment_date as created_at
            FROM payments p
            JOIN invoices i ON p.invoice_id = i.id
            JOIN customers c ON i.customer_id = c.id
            LEFT JOIN packages pkg ON c.package_id = pkg.id
            WHERE MONTH(p.payment_date) = ? AND YEAR(p.payment_date) = ?
        `;
        const params = [month, year];
        if (search) {
            q += " AND (c.name LIKE ? OR c.customer_id LIKE ? OR c.phone LIKE ?)";
            const s = `%${search}%`;
            params.push(s, s, s);
        }
        q += " ORDER BY p.id DESC LIMIT ? OFFSET ?";
        params.push(limit, offset);

        const [rows] = await db.query(q, params);

        let countQ = `
            SELECT COUNT(*) as count
            FROM payments p
            JOIN invoices i ON p.invoice_id = i.id
            JOIN customers c ON i.customer_id = c.id
            WHERE MONTH(p.payment_date) = ? AND YEAR(p.payment_date) = ?
        `;
        const countParams = [month, year];
        if (search) {
            countQ += " AND (c.name LIKE ? OR c.customer_id LIKE ? OR c.phone LIKE ?)";
            const s = `%${search}%`;
            countParams.push(s, s, s);
        }
        const [countResult] = await db.query(countQ, countParams);
        const total = countResult[0].count;

        const formatted = rows.map(r => ({
            ...r,
            payment_date: r.payment_date ? new Date(r.payment_date).toISOString().slice(0, 10) : null,
            due_date: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : null,
            wa_sent_status: 'sent',
            wa_sent_at: r.created_at,
            recorded_by_name: req.user.name || 'Admin'
        }));

        res.json({ success: true, data: formatted, total });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/payments/record
app.post('/api/payments/record', authenticateAPI, async (req, res) => {
    const {
        customer_id, amount, payment_date, method, bank, reference_no,
        due_date_after, send_wa, notes, period_month, period_year
    } = req.body;

    if (!customer_id || !amount || !due_date_after) {
        return res.status(400).json({ success: false, message: 'Data input tidak lengkap.' });
    }

    try {
        // Check if invoice exists
        const [exists] = await db.query(
            "SELECT id, invoice_number FROM invoices WHERE customer_id = ? AND period_month = ? AND period_year = ?",
            [customer_id, period_month, period_year]
        );

        let invoiceId;
        let invoice_number;

        if (exists.length === 0) {
            invoice_number = `INV-${period_year}${String(period_month).padStart(2, '0')}-${String(customer_id).padStart(4, '0')}`;
            const [insertInv] = await db.query(
                "INSERT INTO invoices (invoice_number, customer_id, amount, due_date, status, period_month, period_year) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [invoice_number, customer_id, amount, due_date_after, 'unpaid', period_month, period_year]
            );
            invoiceId = insertInv.insertId;
        } else {
            invoiceId = exists[0].id;
            invoice_number = exists[0].invoice_number;
        }

        // Update invoice to paid
        await db.query(
            "UPDATE invoices SET status = 'paid', paid_date = ? WHERE id = ?",
            [payment_date || new Date(), invoiceId]
        );

        // Process reward points!
        try {
            await rewardsRouter.processPaymentReward(invoiceId);
        } catch (e) {
            console.error('Failed to process payment reward:', e);
        }

        // Insert payment
        const ref = reference_no + (bank ? ` (${bank})` : '');
        await db.query(
            "INSERT INTO payments (invoice_id, amount, payment_method, payment_date, reference_number) VALUES (?, ?, ?, ?, ?)",
            [invoiceId, amount, method, payment_date || new Date(), ref]
        );

        // Update customer due date
        await db.query(
            "UPDATE customers SET due_date = ? WHERE id = ?",
            [due_date_after, customer_id]
        );

        res.json({
            success: true,
            message: 'Pembayaran berhasil dicatat.',
            data: {
                invoice_number,
                due_date_after
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/payments/:id
app.delete('/api/payments/:id', authenticateAPI, async (req, res) => {
    const id = req.params.id;
    try {
        const [payments] = await db.query("SELECT * FROM payments WHERE id = ?", [id]);
        if (payments.length === 0) {
            return res.status(404).json({ success: false, message: 'Pembayaran tidak ditemukan.' });
        }
        const payment = payments[0];

        // Reset invoice to unpaid
        await db.query(
            "UPDATE invoices SET status = 'unpaid', paid_date = NULL WHERE id = ?",
            [payment.invoice_id]
        );

        // Delete payment
        await db.query("DELETE FROM payments WHERE id = ?", [id]);

        res.json({ success: true, message: 'Pembayaran berhasil dihapus.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = app;
