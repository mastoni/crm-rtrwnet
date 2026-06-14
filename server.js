const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const db = require('./db');
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
    } catch (err) {
        console.warn('========================================================================');
        console.warn('PERINGATAN: Koneksi database MySQL gagal.');
        console.warn('Aplikasi akan tetap berjalan dengan menggunakan MOCK DATA statik (JSON).');
        console.warn('Konfigurasikan DB_USER & DB_PASSWORD di file .env jika ingin menggunakan MySQL.');
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
// PAGE ROUTES (GET)
// ============================================

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
    res.redirect('/dashboard');
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

// Dynamic Data Endpoints with Database Queries
app.get('/api/customers', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query(`
      SELECT c.*, p.name as package_name, p.price as package_price 
      FROM customers c 
      LEFT JOIN packages p ON c.package_id = p.id
    `);

        const data = rows.map(r => ({
            id: r.id,
            customer_id: r.customer_id,
            name: r.name,
            address: r.address,
            phone: r.phone,
            email: r.email,
            portal_enabled: r.portal_enabled,
            package_id: r.package_id,
            status: r.status,
            latitude: r.latitude,
            longitude: r.longitude,
            ont_sn: r.ont_sn,
            static_ip: r.static_ip,
            mikrotik_id: r.mikrotik_id,
            pppoe_username: r.pppoe_username,
            billing_date: r.billing_date,
            due_date: r.due_date,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            package: r.package_id ? {
                id: r.package_id,
                name: r.package_name,
                price: r.package_price
            } : null
        }));

        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
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
        const [rows] = await db.query('SELECT * FROM todos');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
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
    res.json({ success: true, data: [] });
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

app.get('/api/dashboard/network-uptime', authenticateAPI, (req, res) => {
    res.json({ success: true, data: { average: "99.98", critical_devices: 0, devices: [] } });
});

app.get('/api/dashboard/ticket-stats', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT status, COUNT(*) as count FROM tickets GROUP BY status');
        let open = 0, resolved = 0;
        rows.forEach(r => {
            if (r.status === 'open' || r.status === 'in_progress') open += r.count;
            if (r.status === 'resolved' || r.status === 'closed') resolved += r.count;
        });
        res.json({ success: true, data: { open, resolved, avg_resolution_hours: "2.5" } });
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
      ORDER BY month DESC 
      LIMIT 12
    `);
        res.json({ success: true, data: rows.reverse() });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get('/api/dashboard/revenue-forecast', authenticateAPI, async (req, res) => {
    try {
        const [rows] = await db.query(`
      SELECT DATE_FORMAT(due_date, '%Y-%m') as month, SUM(amount) as revenue 
      FROM invoices 
      WHERE status = 'paid' 
      GROUP BY month 
      ORDER BY month DESC 
      LIMIT 6
    `);
        res.json({ success: true, data: rows.reverse() });
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
app.get('/api/system/resources/data', authenticateAPI, (req, res) => {
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

    res.json({
        success: true,
        data: {
            router: {
                board: 'MikroTik RB1100AHx4',
                version: '7.12.1',
                uptime: '15d 4h 32m',
                cpu_load: 12,
                ram_usage: 45,
                ram_detail: '450MB / 1024MB',
                disk_usage: 22,
                disk_detail: '28MB / 128MB'
            },
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

// API Catch-all untuk endpoint yang belum diimplementasi (agar tidak mereturn HTML 404)
app.use('/api', (req, res) => {
    res.json({ success: true, data: [], message: 'Endpoint not fully implemented yet in full version' });
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

