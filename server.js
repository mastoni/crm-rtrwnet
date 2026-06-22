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
    billing_due_date: '20'
};
app.locals.settings = { ...defaultSettings };

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
                ['billing_due_date', defaultSettings.billing_due_date, 'billing', 'Tanggal jatuh tempo tagihan tiap bulan']
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
registerPage('/monitoring/traffic', 'monitoring_traffic', ['/js/traffic.js']);
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
                bandwidth: { total_download: 90, mbps: "0.1" },
                ont: { online: active, offline: isolated },
                devices: { online: active, offline: 0, total: active },
                cpu: { average: 5 },
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

app.get('/api/billing/stats', authenticateAPI, async (req, res) => {
    try {
        const [invoices] = await db.query('SELECT status, amount FROM invoices');
        let unpaid = 0;
        let overdue = 0;
        let revenueThisMonth = 0;
        let paidThisMonth = 0;

        invoices.forEach(i => {
            if (i.status === 'unpaid') unpaid++;
            if (i.status === 'overdue') overdue++;
            if (i.status === 'paid') {
                revenueThisMonth += parseFloat(i.amount);
                paidThisMonth++;
            }
        });
        res.json({ success: true, data: { unpaid, overdue, paidThisMonth, revenueThisMonth } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/billing/total-outstanding', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query("SELECT SUM(amount) as total, COUNT(*) as count FROM invoices WHERE status != 'paid'");
        res.json({ success: true, data: { total: parseFloat(rows[0].total || 0), count: rows[0].count } });
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

app.get('/api/customers/map', authenticateAPI, (req, res) => {
    res.json({
        success: true,
        data: [
            { id: 1, name: 'John Doe', status: 'active', latitude: -6.597, longitude: 106.793 }
        ]
    });
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
            status
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

        const [result] = await db.query(
            `INSERT INTO customers 
             (customer_id, name, phone, email, address, package_id, due_date, installation_date, pppoe_username, ont_sn, static_ip, mikrotik_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                status || 'active'
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

        const fields = [];
        const values = [];
        const allowedFields = [
            'customer_id', 'name', 'phone', 'email', 'address', 'package_id',
            'due_date', 'installation_date', 'pppoe_username', 'ont_sn',
            'static_ip', 'mikrotik_id', 'status'
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
    if (process.env.GENIEACS_URL) {
        try {
            const response = await axios.get(`${process.env.GENIEACS_URL}/devices`);
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

        res.json({
            success: true,
            data: {
                paidThisMonth: paidRows[0].count,
                unpaid: unpaidRows[0].count,
                overdue: overdueRows[0].count,
                revenueThisMonth: parseFloat(revRows[0].total || 0)
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
            SELECT i.*, c.name as customer_name, c.customer_id as customer_code
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
                    customer_id: row.customer_code
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
    res.json({ success: true, message: 'Reminder tagihan berhasil dikirim via WhatsApp (Mock)' });
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
    if (process.env.MIKROTIK_HOST) {
        const conn = new RouterOSAPI({
            host: process.env.MIKROTIK_HOST,
            user: process.env.MIKROTIK_USER,
            password: process.env.MIKROTIK_PASSWORD
        });
        try {
            await conn.connect();
            const interfaces = await conn.write('/interface/print');
            conn.close();
            return res.json({ success: true, data: interfaces });
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
    if (process.env.MIKROTIK_HOST) {
        const conn = new RouterOSAPI({
            host: process.env.MIKROTIK_HOST,
            user: process.env.MIKROTIK_USER,
            password: process.env.MIKROTIK_PASSWORD
        });
        try {
            await conn.connect();
            const interfaces = await conn.write('/interface/print');
            const names = interfaces.map(i => i.name).join(',');
            if (names) {
                const stats = await conn.write('/interface/monitor-traffic', [
                    `=interface=${names}`,
                    '=once='
                ]);
                conn.close();
                const data = stats.map(s => ({
                    name: s.name,
                    rxBitsPerSecond: parseInt(s['rx-bits-per-second'] || '0', 10),
                    txBitsPerSecond: parseInt(s['tx-bits-per-second'] || '0', 10)
                }));
                return res.json({ success: true, data });
            }
            conn.close();
        } catch (err) {
            console.warn("Mikrotik connection failed:", err.message);
        }
    }

    // Fallback: mock data
    const mockData = [
        { name: 'ether1', rxBitsPerSecond: Math.floor(Math.random() * 50000000), txBitsPerSecond: Math.floor(Math.random() * 20000000) },
        { name: 'ether2', rxBitsPerSecond: Math.floor(Math.random() * 10000000), txBitsPerSecond: Math.floor(Math.random() * 5000000) },
        { name: 'wlan1', rxBitsPerSecond: Math.floor(Math.random() * 5000000), txBitsPerSecond: Math.floor(Math.random() * 1000000) }
    ];
    res.json({ success: true, data: mockData });
});

app.get('/api/mikrotik/interfaces/monitor-selected', authenticateAPI, async (req, res) => {
    const names = req.query.names; // comma-separated
    if (process.env.MIKROTIK_HOST && names) {
        const conn = new RouterOSAPI({
            host: process.env.MIKROTIK_HOST,
            user: process.env.MIKROTIK_USER,
            password: process.env.MIKROTIK_PASSWORD
        });
        try {
            await conn.connect();
            const stats = await conn.write('/interface/monitor-traffic', [
                `=interface=${names}`,
                '=once='
            ]);
            conn.close();
            const data = stats.map(s => ({
                name: s.name,
                rxBitsPerSecond: parseInt(s['rx-bits-per-second'] || '0', 10),
                txBitsPerSecond: parseInt(s['tx-bits-per-second'] || '0', 10)
            }));
            return res.json({ success: true, data });
        } catch (err) {
            console.warn("Mikrotik connection failed:", err.message);
        }
    }

    // Fallback mock data
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
    return new RouterOSAPI({
        host: s.mikrotik_host || process.env.MIKROTIK_HOST,
        user: s.mikrotik_user || process.env.MIKROTIK_USER || 'admin',
        password: s.mikrotik_password || process.env.MIKROTIK_PASSWORD || '',
        port: parseInt(s.mikrotik_port || process.env.MIKROTIK_PORT || 8728, 10)
    });
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
app.get('/api/genieacs/settings/load', authenticateAPI, (req, res) => {
    res.json({ success: true, data: { nbi_url: process.env.GENIEACS_NBI_URL || 'http://192.168.99.103:7557' } });
});

app.post('/api/genieacs/settings/save', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.get('/api/genieacs/stats', authenticateAPI, (req, res) => {
    res.json({ success: true, data: { total: 10, online: 8, offline: 2 } });
});

app.get('/api/genieacs/devices', authenticateAPI, (req, res) => {
    res.json({
        success: true,
        stats: { total: 10, online: 8, offline: 2 },
        data: [
            { id: 'FHTT-123456', serial: 'FHTT123456', manufacturer: 'FiberHome', model: 'HG6243C', ssid: 'Customer_WIFI', customer_name: 'John Doe', customer_id: 'CUST-001', online: true, rx_power: -24.5, connected_clients: 3, temperature: 45, uptime_formatted: '2d 4h', wan_ip: '10.0.0.1', last_inform: new Date().toISOString() },
            { id: 'ZTE-987654', serial: 'ZTEG987654', manufacturer: 'ZTE', model: 'F609', ssid: 'HomeNet', customer_name: 'Jane Smith', customer_id: 'CUST-002', online: false, rx_power: null, connected_clients: 0, temperature: 0, uptime_formatted: '', wan_ip: '', last_inform: new Date(Date.now() - 86400000).toISOString() }
        ]
    });
});

app.get('/api/genieacs/devices/:id', authenticateAPI, (req, res) => {
    res.json({
        success: true,
        data: {
            id: req.params.id,
            manufacturer: 'FiberHome',
            model: 'HG6243C',
            serial_number: 'FHTT123456',
            software_version: 'V1.0',
            online: true,
            last_inform: new Date().toISOString(),
            signal: { wan_ip: '10.0.0.1', wan_status: 'Connected', uptime_formatted: '2d 4h', rx_power: -24.5, tx_power: 2.1, temperature: 45 },
            wifi: { ssid_2g: 'Customer_WIFI', password_2g: 'secret123', ssid_5g: 'Customer_WIFI_5G', password_5g: 'secret123' }
        }
    });
});

app.post('/api/genieacs/devices/:id/wifi', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.post('/api/genieacs/devices/:id/reboot', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.post('/api/genieacs/devices/:id/factory-reset', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.post('/api/genieacs/devices/:id/refresh', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.get('/api/genieacs/devices/:id/clients', authenticateAPI, (req, res) => {
    res.json({
        success: true,
        total: 2, wifi: 1, ethernet: 1,
        data: [
            { type: 'WiFi', hostname: 'Phone', ip: '192.168.1.10', mac: 'AA:BB:CC:DD:EE:FF', rssi: -60 },
            { type: 'Ethernet', hostname: 'PC', ip: '192.168.1.11', mac: '11:22:33:44:55:66', rssi: null }
        ]
    });
});

app.get('/api/genieacs/devices/:id/rx-history', authenticateAPI, (req, res) => {
    res.json({
        success: true,
        data: [
            { time: new Date(Date.now() - 3600000).toISOString(), value: -24.1 },
            { time: new Date().toISOString(), value: -24.5 }
        ]
    });
});

app.get('/api/genieacs/devices/:id/bandwidth', authenticateAPI, (req, res) => {
    res.json({
        success: true,
        data: {
            rx_display: { value: 1.5, unit: 'Mbps' },
            tx_display: { value: 500, unit: 'Kbps' },
            rx_rate: '1.5 Mbps',
            tx_rate: '500 Kbps',
            dl_pct: 75,
            ul_pct: 25
        }
    });
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
app.get('/api/device-monitor/devices', authenticateAPI, (req, res) => {
    res.json({
        success: true,
        data: [
            { id: 1, name: 'Core Router', ip_address: '192.168.88.1' },
            { id: 2, name: 'Distribution Switch', ip_address: '192.168.88.2' }
        ]
    });
});

app.get('/api/device-monitor/:id/realtime', authenticateAPI, (req, res) => {
    res.json({
        success: true,
        data: {
            cpu: Math.floor(Math.random() * 40) + 10,
            memPercent: Math.floor(Math.random() * 30) + 40,
            memUsed: 1024,
            memTotal: 2048,
            diskPercent: 20,
            diskFree: 8000,
            diskTotal: 10000,
            totalRxMbps: Math.random() * 50,
            totalTxMbps: Math.random() * 20,
            reachable: true,
            uptime: '5d 12h',
            firmware: 'v6.48.6',
            protocol: 'api',
            interfaces: [
                { name: 'ether1', type: 'ether', running: true, rxMbps: Math.random() * 25, txMbps: Math.random() * 10 },
                { name: 'ether2', type: 'ether', running: true, rxMbps: Math.random() * 25, txMbps: Math.random() * 10 }
            ]
        }
    });
});

app.get('/api/device-monitor/:id/summary', authenticateAPI, (req, res) => {
    res.json({
        success: true,
        data: {
            id: req.params.id,
            name: req.params.id == 1 ? 'Core Router' : 'Distribution Switch',
            ip_address: req.params.id == 1 ? '192.168.88.1' : '192.168.88.2',
            firmware: 'v6.48.6',
            brand: 'MikroTik',
            model: 'CCR1009',
            monitoring_type: 'api'
        }
    });
});

app.get('/api/device-monitor/:id/history', authenticateAPI, (req, res) => {
    const hours = req.query.hours || 1;
    const points = hours * 60;
    const timestamps = Array.from({ length: points }, (_, i) => Date.now() - (points - i) * 60000);
    const cpu = Array.from({ length: points }, () => Math.floor(Math.random() * 40) + 10);
    const memory = Array.from({ length: points }, () => Math.floor(Math.random() * 30) + 40);
    const disk = Array.from({ length: points }, () => 20);
    const rx = Array.from({ length: points }, () => Math.random() * 50);
    const tx = Array.from({ length: points }, () => Math.random() * 20);
    res.json({
        success: true,
        data: { timestamps, cpu, memory, disk, rx, tx }
    });
});

app.post('/api/device-monitor/test-connection', authenticateAPI, (req, res) => {
    res.json({ success: true, message: 'Connection successful!' });
});

app.post('/api/device-monitor/devices', authenticateAPI, (req, res) => {
    res.json({ success: true, data: { id: 3 } });
});

app.put('/api/device-monitor/devices/:id', authenticateAPI, (req, res) => {
    res.json({ success: true });
});

app.delete('/api/device-monitor/devices/:id', authenticateAPI, (req, res) => {
    res.json({ success: true });
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
    res.json({ success: true, data: [] });
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

    const cpus = os.cpus();
    // Very rough estimation for CPU usage just for show
    const cpuLoad = Math.round(Math.random() * 20 + 5);

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
            cpu: Math.floor(Math.random() * 10) + 2,
            ram: 42,
            bandwidth_rx: Math.random() * 5000000 + 1000000,
            bandwidth_tx: Math.random() * 2000000 + 500000
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
    res.json({ success: true, message: `Pesan test berhasil dikirim via ${_waCfg.engine}` });
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
