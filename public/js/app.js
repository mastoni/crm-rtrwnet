// ============================================
// ISP NetOps - Main Application JS (continued)
// ============================================

const App = {
    token: localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    socket: null,

    init() {
        this.setDate();
        this.initSidebar();
        this.initNotifications();
        this.initLogout();
        this.initSocket();
        this.initSearch();
    },

    async api(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        };
        // Hanya tambah Authorization header jika token valid (bukan null/undefined)
        if (this.token && this.token !== 'null') {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        if (options.headers) Object.assign(headers, options.headers);
        const config = { ...options, headers, credentials: 'include' };
        try {
            const res = await fetch(`/api${url}`, config);
            if (res.status === 401) {
                const refreshed = await this.refreshToken();
                if (!refreshed) { window.location.href = '/login'; return null; }
                config.headers.Authorization = `Bearer ${this.token}`;
                return (await fetch(`/api${url}`, config)).json();
            }
            return res.json();
        } catch (err) { console.error('API Error:', err); return { success: false, message: 'Network error' }; }
    },

    async refreshToken() {
        try {
            const rt = localStorage.getItem('refreshToken');
            if (!rt) return false;
            const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
            const data = await res.json();
            if (data.success) { this.token = data.data.token; localStorage.setItem('token', data.data.token); return true; }
            return false;
        } catch { return false; }
    },

    setDate() {
        const el = document.getElementById('currentDate');
        if (el) {
            const now = new Date();
            const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            el.textContent = '\u203A ' + dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
        }
    },

    initSidebar() {
        const toggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');
        if (!toggle || !sidebar) return;

        // Buat backdrop element sekali
        let backdrop = document.getElementById('sidebarBackdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'sidebarBackdrop';
            backdrop.className = 'sidebar-backdrop';
            document.body.appendChild(backdrop);
        }

        const openSidebar = () => {
            sidebar.classList.add('open');
            backdrop.classList.add('show');
        };
        const closeSidebar = () => {
            sidebar.classList.remove('open');
            backdrop.classList.remove('show');
        };

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
        });

        // Klik backdrop → tutup
        backdrop.addEventListener('click', closeSidebar);

        // Klik link nav di mobile → tutup sidebar otomatis
        sidebar.querySelectorAll('.nav-item').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth < 768) closeSidebar();
            });
        });
    },

    initNotifications() {
        const btn = document.getElementById('notificationBtn');
        const dropdown = document.getElementById('notifDropdown');
        const markAll = document.getElementById('markAllRead');
        if (btn && dropdown) {
            btn.addEventListener('click', (e) => { e.stopPropagation(); const shown = dropdown.style.display !== 'none' && dropdown.style.display !== ''; dropdown.style.display = shown ? 'none' : 'block'; if (!shown) this.loadNotifications(); });
            document.addEventListener('click', () => { dropdown.style.display = 'none'; });
            dropdown.addEventListener('click', (e) => e.stopPropagation());
        }
        if (markAll) { markAll.addEventListener('click', async () => { await this.api('/notifications/read-all', { method: 'PUT' }); this.updateNotifBadge(); this.loadNotifications(); }); }
        this.updateNotifBadge();
    },

    async updateNotifBadge() {
        const data = await this.api('/notifications/unread-count');
        const dot = document.getElementById('notifDot');
        if (dot && data && data.success) {
            dot.style.display = data.data.count > 0 ? 'block' : 'none';
        }
    },

    async loadNotifications() {
        const list = document.getElementById('notifList');
        if (!list) return;
        const data = await this.api('/notifications?limit=10');
        if (!data || !data.success || !data.data.length) {
            list.innerHTML = '<p class="notif-empty">No notifications</p>';
            return;
        }
        list.innerHTML = data.data.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" style="padding:12px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;${n.is_read ? '' : 'background:#f8fafc;'}">
        <div style="display:flex;gap:8px;align-items:start;">
          <div style="width:8px;height:8px;border-radius:50%;margin-top:6px;flex-shrink:0;background:${n.severity === 'critical' ? '#ef4444' : n.severity === 'warning' ? '#f59e0b' : '#3b82f6'};"></div>
          <div>
            <div style="font-size:13px;font-weight:${n.is_read ? '400' : '600'};color:#1e293b;">${n.title}</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px;">${n.message}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${this.timeAgo(n.created_at)}</div>
          </div>
        </div>
      </div>
    `).join('');

        list.querySelectorAll('.notif-item').forEach(item => {
            item.addEventListener('click', async () => {
                await this.api(`/notifications/${item.dataset.id}/read`, { method: 'PUT' });
                item.style.background = '';
                this.updateNotifBadge();
            });
        });
    },

    timeAgo(dateStr) {
        const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
        if (diff < 60) return 'Just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    },

    initLogout() {
        const btn = document.getElementById('logoutBtn');
        if (btn) {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                await this.api('/auth/logout', { method: 'POST' });
                localStorage.removeItem('token');
                localStorage.removeItem('refreshToken');
                localStorage.removeItem('user');
                window.location.href = '/login';
            });
        }
    },

    initSocket() {
        if (typeof io === 'undefined') return;
        try {
            this.socket = io({ auth: { token: this.token } });
            this.socket.on('connect', () => console.log('Socket connected'));
            this.socket.on('notification:new', (data) => {
                this.updateNotifBadge();
                this.showToast(data.title, data.severity || 'info');
            });
            this.socket.on('disconnect', () => console.log('Socket disconnected'));
        } catch (e) { console.warn('Socket init failed:', e); }
    },

    initSearch() {
        const input = document.getElementById('globalSearch');
        if (!input) return;
        let timeout;
        input.addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                const q = input.value.trim();
                if (q.length >= 2) console.log('Search:', q);
            }, 400);
        });
    },

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        const colors = { info: '#3b82f6', warning: '#f59e0b', error: '#ef4444', critical: '#ef4444', success: '#22c55e' };
        toast.style.cssText = `position:fixed;top:80px;right:24px;background:white;border-left:4px solid ${colors[type] || colors.info};padding:14px 20px;border-radius:8px;box-shadow:0 8px 25px rgba(0,0,0,0.12);z-index:9999;font-size:13px;font-family:inherit;max-width:360px;animation:slideIn 0.3s ease;`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 4000);
    },

    formatBps(bps) {
        if (!bps || bps === 0) return '0 bps';
        const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
        const i = Math.floor(Math.log(Math.abs(bps)) / Math.log(1000));
        return (bps / Math.pow(1000, Math.max(0, i))).toFixed(1) + ' ' + (units[i] || 'bps');
    },

    formatCurrency(amount) {
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount || 0);
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());

// Add slideIn animation
const style = document.createElement('style');
style.textContent = '@keyframes slideIn{from{transform:translateX(100px);opacity:0}to{transform:translateX(0);opacity:1}}';
document.head.appendChild(style);