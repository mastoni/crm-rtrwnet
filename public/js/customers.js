// customers.js — Customer Management (redesign)

let _custPage = 1;
let _custEditId = null;
let _nextAutoId = '';
const AVATAR_BG = ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#0284c7', '#16a34a', '#ea580c', '#0369a1', '#0d9488'];

// ── EXPOSE ────────────────────────────────────────────────────
window.openAddCustomer = async function () {
    _custEditId = null;
    _setText('customerModalTitle', 'Tambah Customer');
    _clearForm();
    // Set default aktivasi = hari ini
    const today = new Date().toISOString().slice(0, 10);
    _setVal('custInstallDate', today);
    _setVal('custStatus', 'active');
    document.getElementById('customerModal').classList.add('active');
    await loadPackages();
    const idField = document.getElementById('custId');
    if (idField) { idField.readOnly = false; idField.placeholder = 'Kosongkan untuk otomatis...'; }
    const d = await App.api('/customers/next-id');
    if (d?.success) {
        _nextAutoId = d.customer_id;
        const el = document.getElementById('custId');
        if (el) el.placeholder = 'Kosongkan → otomatis: ' + d.customer_id;
        setIdStatus('hint', d.customer_id);
    }
};

window.closeModal = function () {
    document.getElementById('customerModal').classList.remove('active');
};

window.editCustomer = async function (id) {
    const data = await App.api('/customers/' + id);
    if (!data?.success) { App.showToast('Gagal memuat data', 'error'); return; }
    const c = data.data;
    _custEditId = c.id;
    _setText('customerModalTitle', 'Edit Customer');
    _setVal('custName', c.name || '');
    _setVal('custPhone', c.phone || '');
    _setVal('custEmail', c.email || '');
    _setVal('custAddress', c.address || '');
    _setVal('custPackage', c.package_id || '');
    _setVal('custDueDate', c.due_date || '');
    _setVal('custInstallDate', c.installation_date || '');
    _setVal('custPPPoE', c.pppoe_username || '');
    _setVal('custOntSn', c.ont_sn || '');
    _setVal('custStaticIP', c.static_ip || '');
    // Set mikrotik dropdown
    const mkSel = document.getElementById('custMikrotikId');
    if (mkSel) mkSel.value = c.mikrotik_id || '';
    _setVal('custStatus', c.status || 'active');
    _setVal('custId', c.customer_id || '');
    setIdStatus('existing', c.customer_id);
    const idField = document.getElementById('custId');
    if (idField) idField.readOnly = true;
    await loadPackages();
    _setVal('custPackage', c.package_id || '');
    document.getElementById('customerModal').classList.add('active');
};

window.toggleIsolate = async function (id, action) {
    const label = action === 'isolate' ? 'Isolir' : 'Aktifkan';
    if (!confirm(label + ' customer ini?')) return;
    const data = await App.api('/customers/' + id, { method: 'PUT', body: JSON.stringify({ status: action === 'isolate' ? 'isolated' : 'active' }) });
    if (data?.success) { loadCustomers(); loadCustomerStats(); App.showToast('Customer ' + label.toLowerCase() + 'd', 'success'); }
    else App.showToast(data?.message || 'Gagal', 'error');
};

window.deleteCustomer = async function (id, name) {
    showConfirmModal(
        'Hapus Customer',
        'Hapus customer <strong>' + _esc(name) + '</strong>?<br><small style="color:#ef4444">Tindakan ini tidak dapat dibatalkan.</small>',
        'trash',
        '#ef4444',
        async function () {
            const data = await App.api('/customers/' + id, { method: 'DELETE' });
            if (data && data.success) { loadCustomers(); loadCustomerStats(); App.showToast('Customer dihapus', 'success'); }
            else App.showToast((data && data.message) || 'Gagal menghapus', 'error');
        }
    );
};

window.syncDueDates = async function () {
    // Konfirmasi generate invoice bulan ini
    const now = new Date();
    const bulan = now.toLocaleString('id-ID', { month: 'long' });
    const tahun = now.getFullYear();

    showConfirmModal(
        'Generate Invoice Bulanan',
        'Generate invoice untuk semua pelanggan aktif periode <strong>' + bulan + ' ' + tahun + '</strong>?<br><small style="color:#64748b">Invoice yang sudah ada akan dilewati (skip).</small>',
        'calendar',
        '#1a6ef5',
        async function () {
            const btn = document.getElementById('btnSyncDue');
            if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="animation:spin .7s linear infinite"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Memproses...'; }
            const res = await App.api('/billing/generate', { method: 'POST', body: JSON.stringify({ month: now.getMonth() + 1, year: tahun }) });
            // Sinkronisasi due_date invoice dari customer.due_date
            await App.api('/billing/sync-due-dates', { method: 'POST' }).catch(function () { });
            if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg><span>Auto Due Date</span>'; }
            if (res && res.success) {
                var d = res.data || {};
                App.showToast('✓ Invoice dibuat: ' + (d.created || 0) + ', dilewati: ' + (d.skipped || 0) + ' · Due date tersinkron', 'success');
                loadCustomers(); loadCustomerStats();
            } else {
                App.showToast('Gagal: ' + ((res && res.message) || 'Error'), 'error');
            }
        }
    );
};

/* ── Confirm Modal ──────────────────────────────────────────── */
function showConfirmModal(title, body, iconType, accentColor, onConfirm) {
    // Remove existing
    var existing = document.getElementById('_confirmModal');
    if (existing) existing.remove();

    var iconSvg = iconType === 'trash'
        ? '<svg width="22" height="22" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/><path d="M9,6V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1v2"/></svg>'
        : '<svg width="22" height="22" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

    var btnLabel = iconType === 'trash' ? 'Hapus' : 'Generate';
    var btnColor = accentColor || '#ef4444';

    var el = document.createElement('div');
    el.id = '_confirmModal';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,27,62,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn .15s ease';

    el.innerHTML = '<div style="background:#fff;border-radius:20px;width:100%;max-width:420px;overflow:hidden;box-shadow:0 24px 80px rgba(13,27,62,.25);animation:slideUp .2s ease">'
        + '<div style="background:' + btnColor + ';padding:20px 22px 16px;display:flex;align-items:center;gap:12px;">'
        + '<div style="width:42px;height:42px;background:rgba(255,255,255,.2);border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + iconSvg + '</div>'
        + '<div style="font-size:15px;font-weight:800;color:#fff">' + title + '</div>'
        + '</div>'
        + '<div style="padding:20px 22px;font-size:13.5px;color:#374151;line-height:1.6">' + body + '</div>'
        + '<div style="display:flex;gap:10px;padding:0 22px 20px;justify-content:flex-end">'
        + '<button id="_confirmCancel" style="padding:9px 20px;border:1.5px solid #e2e8f0;border-radius:10px;background:#fff;color:#64748b;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit">Batal</button>'
        + '<button id="_confirmOk" style="padding:9px 20px;border:none;border-radius:10px;background:' + btnColor + ';color:#fff;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;box-shadow:0 3px 10px ' + btnColor + '44">' + btnLabel + '</button>'
        + '</div>'
        + '</div>';

    // CSS animations
    if (!document.getElementById('_confirmStyles')) {
        var s = document.createElement('style');
        s.id = '_confirmStyles';
        s.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(s);
    }

    document.body.appendChild(el);

    document.getElementById('_confirmCancel').onclick = function () { el.remove(); };
    document.getElementById('_confirmOk').onclick = function () {
        el.remove();
        onConfirm();
    };
    el.addEventListener('click', function (e) { if (e.target === el) el.remove(); });
}

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadMikrotikDevices();
    if (typeof App !== 'undefined') App.init();
    loadCustomerStats();
    loadCustomers();
    setupSearch();
});

window.applyFilter = function (status) {
    const sel = document.getElementById('filterStatus');
    if (sel) sel.value = status;
    _custPage = 1;
    loadCustomers();
};

function setupSearch() {
    const s = document.getElementById('searchCustomer');
    const f = document.getElementById('filterStatus');
    const fd = document.getElementById('filterDue');
    if (s) s.addEventListener('input', _debounce(() => { _custPage = 1; loadCustomers(); }, 350));
    if (f) f.addEventListener('change', () => { _custPage = 1; loadCustomers(); });
    if (fd) fd.addEventListener('change', () => { _custPage = 1; loadCustomers(); });
}

// ── STATS ─────────────────────────────────────────────────────
async function loadCustomerStats() {
    const d = await App.api('/customers/stats');
    if (!d?.success) return;
    const s = d.data;
    const total = s.total || 0;
    const active = s.active || 0;
    const overdue = s.overdue || 0;
    const dueSoon = s.due_soon || 0;
    const inactive = (s.inactive || 0) + (s.suspended || 0);
    const isolated = s.isolated || 0;

    _setText('scTotal', total);
    _setText('scTotalSub', active + ' aktif · ' + inactive + ' nonaktif');
    _setBar('scTotalBar', total > 0 ? 0.99 : 0);
    _setText('scTotalPct', active + ' aktif · ' + isolated + ' isolir');

    _setText('scOverdue', overdue);
    _setBar('scOverdueBar', overdue / Math.max(total, 1));
    _setText('scOverduePct', overdue > 0
        ? Math.round(overdue / Math.max(active, 1) * 100) + '% dari pelanggan aktif'
        : 'Tidak ada overdue');

    _setText('scDueSoon', dueSoon);
    _setBar('scDueSoonBar', dueSoon / Math.max(active, 1));
    _setText('scDueSoonPct', dueSoon > 0
        ? dueSoon + ' akan jatuh tempo dalam 3 hari'
        : 'Tidak ada mendekati jatuh tempo');

    // Card 4: Revenue
    const rev = s.monthly_revenue || 0;
    let revFmt = 'Rp 0';
    if (rev >= 1000000) revFmt = 'Rp ' + (rev / 1000000).toFixed(1).replace('.0', '') + 'jt';
    else if (rev >= 1000) revFmt = 'Rp ' + Math.round(rev / 1000) + 'rb';
    else if (rev > 0) revFmt = 'Rp ' + Math.round(rev).toLocaleString('id-ID');
    _setText('scRevenue', revFmt);
    _setBar('scRevenueBar', active > 0 ? Math.min((rev / (active * 200000)), 1) : 0);
    _setText('scRevenuePct', rev > 0 ? 'Total penerimaan ' + new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric' }) : 'Belum ada pembayaran bulan ini');

    // Hidden stubs
    _setText('scActive', active);
    _setText('scInactive', inactive);
    _setText('scNoDue', Math.max(0, total - active));
    _setText('scIsolated', isolated + inactive);
    _setText('scActiveSub', Math.round(active / Math.max(total, 1) * 100) + '% dari total ' + total);
    _setText('scTotal2', total);

    const subtitle = document.getElementById('headerSubtitle');
    if (subtitle) subtitle.textContent = 'Manajemen pelanggan, terdapat ' + total + ' customer terdaftar';
}

function _setBar(id, ratio) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.min(Math.max(ratio * 100, 2), 100) + '%';
}

function _setPct(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ── LIST ──────────────────────────────────────────────────────
async function loadCustomers() {
    const search = document.getElementById('searchCustomer')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';
    const data = await App.api('/customers?page=' + _custPage + '&limit=20&search=' + encodeURIComponent(search) + '&status=' + status);
    const tbody = document.getElementById('customerTable');
    const countEl = document.getElementById('customerCount');

    if (!data?.success) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><p style="color:var(--danger);">Gagal memuat data</p></td></tr>';
        return;
    }

    const total = data.pagination?.total || 0;
    if (countEl) countEl.textContent = total + ' pelanggan';

    if (!data.data?.length) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/></svg><p>Tidak ada data customer</p></div></td></tr>';
        _renderPagination(0, 20);
        return;
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);

    tbody.innerHTML = data.data.map(function (c) {
        var hash = 0;
        for (var i = 0; i < (c.name || '').length; i++) hash = ((hash << 5) - hash) + c.name.charCodeAt(i);
        var color = AVATAR_BG[Math.abs(hash) % AVATAR_BG.length];
        var initial = (c.name || '?')[0].toUpperCase();

        // due_date langsung dari kolom customers.due_date
        // Tidak perlu kalkulasi — sudah di-set via form atau migration
        if (!c.latest_due_date && c.due_date) {
            c.latest_due_date = c.due_date;
        }

        var dueDateHtml = '<span style="color:#94a3b8">–</span>';
        if (c.latest_due_date) {
            var due = new Date(c.latest_due_date + 'T00:00:00');
            var diffDays = Math.round((due - today) / 86400000);
            var fmtDue = due.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
            if (c.latest_invoice_status === 'paid') {
                dueDateHtml = fmtDue + ' <span style="font-size:10px;background:#f0fdf4;color:#16a34a;padding:1px 6px;border-radius:4px;font-weight:700">Lunas</span>';
            } else if (diffDays < 0) {
                dueDateHtml = '<span style="color:#dc2626;font-weight:600">' + fmtDue + '</span><br><span style="font-size:10px;color:#dc2626">' + Math.abs(diffDays) + ' hari lalu</span>';
            } else if (diffDays === 0) {
                dueDateHtml = '<span style="color:#ea580c;font-weight:600">' + fmtDue + '</span><br><span style="font-size:10px;color:#ea580c">Hari ini!</span>';
            } else if (diffDays <= 3) {
                dueDateHtml = '<span style="color:#d97706;font-weight:600">' + fmtDue + '</span><br><span style="font-size:10px;color:#d97706">' + diffDays + ' hari lagi</span>';
            } else {
                dueDateHtml = fmtDue;
            }
        }

        // Status badge
        var dueCk = c.latest_due_date ? new Date(c.latest_due_date + 'T00:00:00') : null;
        var diffCk = dueCk ? Math.round((dueCk - today) / 86400000) : null;
        // Status sinkron dengan invoice: overdue = ada invoice unpaid & due sudah lewat
        var isOv = (c.latest_invoice_status === 'overdue') && c.status === 'active';
        var isDs = (c.latest_invoice_status === 'unpaid') && c.status === 'active' && diffCk !== null && diffCk >= 0 && diffCk <= 3;

        var stCls = 'sb-inactive', stDot = '#94a3b8', stLabel = c.status || '–';
        if (isOv) { stCls = 'sb-overdue'; stDot = '#dc2626'; stLabel = 'Overdue'; }
        else if (isDs) { stCls = 'sb-due-soon'; stDot = '#ea580c'; stLabel = 'Due Soon'; }
        else if (c.status === 'active') { stCls = 'sb-active'; stDot = '#16a34a'; stLabel = 'Aktif'; }
        else if (c.status === 'isolated') { stCls = 'sb-suspended'; stDot = '#dc2626'; stLabel = 'Isolir'; }
        else if (c.status === 'suspended') { stCls = 'sb-suspended'; stDot = '#dc2626'; stLabel = 'Suspended'; }

        var price = (c.package && c.package.price)
            ? 'Rp ' + Number(c.package.price).toLocaleString('id-ID')
            : (c.monthly_fee ? 'Rp ' + Number(c.monthly_fee).toLocaleString('id-ID') : '–');

        var isoBtn = '';
        if (c.status === 'active') isoBtn = '<button class="rb rb-iso" onclick="toggleIsolate(' + c.id + ',\'isolate\')">Isolir</button>';
        if (c.status === 'isolated') isoBtn = '<button class="rb rb-act" onclick="toggleIsolate(' + c.id + ',\'activate\')">Aktifkan</button>';

        var addrShort = c.address ? _esc(c.address.substring(0, 30)) + (c.address.length > 30 ? '...' : '') : '';
        var pkgName = (c.package && c.package.name) ? _esc(c.package.name) : (c.package_name ? _esc(c.package_name) : '–');
        var actDate = c.installation_date ? new Date(c.installation_date).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';

        return '<tr data-id="' + c.id + '">'
            + '<td><span class="cid-badge">' + _esc(c.customer_id) + '</span></td>'
            + '<td>'
            + '<div style="display:flex;align-items:center;gap:11px">'
            + '<div class="av-circle" style="background:' + color + '">' + initial + '</div>'
            + '<div>'
            + '<a href="/customers/profile/' + c.id + '" class="cust-name-link">' + _esc(c.name) + '</a>'
            + (addrShort ? '<div style="font-size:11px;color:#6b7fa8;margin-top:1px;max-width:160px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + addrShort + '</div>' : '')
            + '</div>'
            + '</div>'
            + '</td>'
            + '<td style="color:#6b7fa8">' + _esc(c.phone || '–') + '</td>'
            + '<td>'
            + '<div style="font-weight:600;font-size:13px;color:#0d1b3e">' + pkgName + '</div>'
            + (c.pppoe_username ? '<div style="font-size:10px;color:#94a3b8;font-family:monospace">' + _esc(c.pppoe_username) + '</div>' : '')
            + (c.static_ip ? '<div style="font-size:10px;color:#2563eb;font-family:monospace">IP: ' + _esc(c.static_ip) + '</div>' : '')
            + '</td>'
            + '<td style="font-weight:700;color:#1a6ef5;font-size:13px">' + price + '</td>'
            + '<td style="color:#6b7fa8">' + actDate + '</td>'
            + '<td><div style="line-height:1.5">' + dueDateHtml + '</div></td>'
            + '<td><span class="sb ' + stCls + '"><span class="sb-dot" style="background:' + stDot + '"></span>' + stLabel + '</span></td>'
            + '<td style="text-align:right;padding-right:18px">'
            + '<div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">'
            + '<button class="rb rb-wa" onclick="sendWA(\'' + _esc(c.phone || '') + '\')" >WA</button>'
            + '<button class="rb rb-edit" onclick="editCustomer(' + c.id + ')">Edit</button>'
            + isoBtn
            + '<button class="rb rb-del" onclick="deleteCustomer(' + c.id + ',\'' + _esc(c.name) + '\')" title="Hapus">'
            + '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">'
            + '<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>'
            + '</svg></button>'
            + '</div>'
            + '</td>'
            + '</tr>';
    }).join('');

    _renderPagination(total, 20);
}

function sendWA(phone) {
    if (!phone) { App.showToast('Nomor HP tidak tersedia', 'error'); return; }
    let n = phone.replace(/[^0-9]/g, '');
    if (n.startsWith('0')) n = '62' + n.slice(1);
    window.open('https://wa.me/' + n, '_blank');
}
window.sendWA = sendWA;

// ── PACKAGES ─────────────────────────────────────────────────
async function loadPackages() {
    const data = await App.api('/packages');
    const sel = document.getElementById('custPackage');
    if (!sel || !data?.success) return;
    sel.innerHTML = '<option value="">Pilih paket</option>' +
        data.data.map(p => '<option value="' + p.id + '">' + _esc(p.name) + ' — Rp ' + Number(p.price).toLocaleString('id-ID') + '/bln</option>').join('');
}

// ── SAVE ─────────────────────────────────────────────────────
async function saveCustomer() {
    const btn = document.getElementById('saveCustomerBtn');
    const name = document.getElementById('custName')?.value?.trim();
    if (!name) { App.showToast('Nama customer wajib diisi', 'error'); return; }

    const custId = document.getElementById('custId')?.value?.trim().toUpperCase() || '';
    if (!_custEditId && custId) {
        const checkD = await App.api('/customers/check-id?customer_id=' + encodeURIComponent(custId));
        if (!checkD?.available) {
            App.showToast('ID ' + custId + ' sudah digunakan, pilih ID lain', 'error');
            return;
        }
    }

    btn.disabled = true; btn.textContent = 'Menyimpan...';

    const body = {
        name,
        customer_id: custId || undefined,
        phone: document.getElementById('custPhone')?.value || '',
        email: document.getElementById('custEmail')?.value || '',
        address: document.getElementById('custAddress')?.value || '',
        package_id: document.getElementById('custPackage')?.value || null,
        due_date: document.getElementById('custDueDate')?.value || null,
        installation_date: document.getElementById('custInstallDate')?.value || null,
        pppoe_username: document.getElementById('custPPPoE')?.value || '',
        ont_sn: document.getElementById('custOntSn')?.value || '',
        static_ip: document.getElementById('custStaticIP')?.value || null,
        mikrotik_id: document.getElementById('custMikrotikId')?.value || null,
        status: document.getElementById('custStatus')?.value || 'active',
    };

    const url = _custEditId ? '/customers/' + _custEditId : '/customers';
    const method = _custEditId ? 'PUT' : 'POST';
    const data = await App.api(url, { method, body: JSON.stringify(body) });

    if (data?.success) {
        window.closeModal();
        loadCustomers();
        loadCustomerStats();
        App.showToast(_custEditId ? 'Customer diperbarui' : 'Customer ditambahkan', 'success');
    } else {
        App.showToast(data?.message || 'Gagal menyimpan', 'error');
    }
    btn.disabled = false; btn.textContent = 'Simpan Customer';
}

// ── PAGINATION ────────────────────────────────────────────────
function _renderPagination(total, limit) {
    var totalPages = Math.ceil(total / limit);
    var el = document.getElementById('customerPagination');
    if (!el) return;
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    var offset = (_custPage - 1) * limit;
    var info = '<div style="font-size:12.5px;color:var(--d-muted)">Menampilkan <strong style=\"color:var(--d-text)\">' + (offset + 1) + '–' + Math.min(offset + limit, total) + '</strong> dari <strong style=\"color:var(--d-text)\">' + total + '</strong> customer</div>';
    var btns = '<div style="display:flex;gap:4px">';
    if (_custPage > 1) btns += '<a href="#" class="pg-btn" onclick="_goPage(' + (_custPage - 1) + ');return false">←</a>';
    for (var i = Math.max(1, _custPage - 2); i <= Math.min(totalPages, _custPage + 2); i++) {
        btns += '<a href="#" class="pg-btn ' + (i === _custPage ? 'active' : '') + '" onclick="_goPage(' + i + ');return false">' + i + '</a>';
    }
    if (_custPage < totalPages) btns += '<a href="#" class="pg-btn" onclick="_goPage(' + (_custPage + 1) + ');return false">→</a>';
    btns += '</div>';
    el.innerHTML = info + btns;
}
window._goPage = function (p) { _custPage = p; loadCustomers(); };

// ── CUSTOMER ID helpers ───────────────────────────────────────
function setIdStatus(type, id) {
    const el = document.getElementById('custIdStatus');
    if (!el) return;
    const map = {
        hint: '<span style="color:#adb5bd;font-size:11px;">Berikutnya: <b>' + _esc(id) + '</b></span>',
        auto: '<span style="color:#25d366;font-size:11px;font-weight:600;">✓ Otomatis: ' + _esc(id) + '</span>',
        available: '<span style="color:#25d366;font-size:11px;font-weight:600;">✓ ID tersedia</span>',
        taken: '<span style="color:#dc2626;font-size:11px;font-weight:600;">✗ ID sudah digunakan</span>',
        existing: '<span style="color:#667781;font-size:11px;">ID tidak bisa diubah</span>',
        checking: '<span style="color:#f59e0b;font-size:11px;">⏳ Mengecek...</span>',
    };
    el.innerHTML = map[type] || '';
}

const _checkIdDebounced = _debounce(async (val) => {
    if (!val || val.length < 2) { setIdStatus(''); return; }
    setIdStatus('checking');
    const d = await App.api('/customers/check-id?customer_id=' + encodeURIComponent(val));
    setIdStatus(d?.available ? 'available' : 'taken');
}, 500);

window.onCustIdInput = function (val) {
    const upper = val.toUpperCase();
    const el = document.getElementById('custId');
    if (el) el.value = upper;
    if (!upper.trim()) setIdStatus(_nextAutoId ? 'auto' : '', _nextAutoId);
    else _checkIdDebounced(upper.trim());
};

window.refreshNextId = async function () {
    const d = await App.api('/customers/next-id');
    if (d?.success) { _nextAutoId = d.customer_id; _setVal('custId', ''); setIdStatus('hint', d.customer_id); const el = document.getElementById('custId'); if (el) el.placeholder = 'Kosongkan → otomatis: ' + d.customer_id; }
};

// ── HELPERS ───────────────────────────────────────────────────
function _clearForm() {
    ['custName', 'custPhone', 'custEmail', 'custAddress', 'custPPPoE', 'custOntSn', 'custId', 'custInstallDate', 'custStaticIP'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    _setVal('custPackage', ''); _setVal('custDueDate', ''); _setVal('custStatus', 'active');
    const mkSel2 = document.getElementById('custMikrotikId');
    if (mkSel2) mkSel2.value = '';
    // Set default tanggal aktivasi = hari ini, billing_date = tgl sama bulan depan
    const todayStr = new Date().toISOString().split('T')[0];
    _setVal('custInstallDate', todayStr);
    if (typeof onActivationDateChange === 'function') onActivationDateChange();
    const idStatus = document.getElementById('custIdStatus'); if (idStatus) idStatus.innerHTML = '';
}
function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function _setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

document.getElementById('saveCustomerBtn')?.addEventListener('click', saveCustomer);

// ── Auto billing_date dari activation_date ───────────────────
window.onActivationDateChange = function () {
    const activEl = document.getElementById('custInstallDate');
    const dueEl = document.getElementById('custDueDate');
    if (!activEl || !dueEl) return;

    // Hanya auto-set due_date jika mode TAMBAH BARU dan due_date belum diisi
    if (!window._custEditId && activEl.value && !dueEl.value) {
        const actDate = new Date(activEl.value);
        if (!isNaN(actDate)) {
            // Due date = tanggal sama, bulan depan (ikuti logika PHP)
            const nextMonth = new Date(actDate.getFullYear(), actDate.getMonth() + 1, actDate.getDate());
            dueEl.value = nextMonth.toISOString().split('T')[0];
        }
    }
};



// ── Load MikroTik devices for dropdown ───────────────────────
async function loadMikrotikDevices() {
    const d = await App.api('/isolir/devices').catch(() => null);
    const sel = document.getElementById('custMikrotikId');
    if (!sel || !d?.data) return;
    sel.innerHTML = '<option value="">— Pilih router —</option>' +
        d.data.map(dev =>
            `<option value="${dev.id}">${dev.name} (${dev.host})</option>`
        ).join('');
}