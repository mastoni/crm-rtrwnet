// message-logs.js

function _setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
function _setBar(id, r) { const e = document.getElementById(id); if (e) e.style.width = Math.min(Math.max((r || 0) * 100, 2), 100) + '%'; }
function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function _fmtDt(d) { return d ? new Date(d).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–'; }

let _tab = 'outgoing';
let _page = 1;
let _limit = 50;
let _total = 0;
let _chart = null;
let _chartDays = 7;

const TYPE_LABEL = { text: 'Teks', image: 'Gambar', document: 'Dokumen', audio: 'Audio', template: 'Template' };
const TYPE_CLASS = { text: 'tc-manual', image: 'tc-reminder', document: 'tc-broadcast', audio: 'tc-otp', template: 'tc-broadcast' };
const STATUS_LABEL = { sent: 'Terkirim', delivered: 'Terkirim', read: 'Dibaca', failed: 'Gagal', pending: 'Pending' };
const STATUS_CLASS = { sent: 'st-sent', delivered: 'st-sent', read: 'st-sent', failed: 'st-failed', pending: 'st-pending' };

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (typeof App !== 'undefined') App.init();
    loadStats();
    loadChart(_chartDays);
    loadTypeBreakdown();
    renderTableHead();
    loadLogs();
    // set default date filter to today
    const today = new Date().toISOString().split('T')[0];
    // don't preset dates, let user filter
});

// ── Stats ─────────────────────────────────────────────────────
async function loadStats() {
    const d = await App.api('/message-logs/stats');
    if (!d?.success) return;
    const out = d.data?.outgoing || { total: 0, today: 0, sent: 0, failed: 0 };
    const inc = d.data?.incoming || { total: 0, unread: 0, today: 0 };
    const avg_duration_ms = d.data?.avg_duration_ms || 0;
    _setText('fcOutTotal', Number(out.total || 0).toLocaleString('id-ID'));
    _setText('fcOutSub', out.today + ' hari ini · ' + Math.round(avg_duration_ms) + 'ms avg');
    _setText('fcSent', Number(out.sent).toLocaleString('id-ID'));
    _setText('fcSentSub', out.total > 0 ? Math.round(out.sent / out.total * 100) + '% success rate' : '–');
    _setText('fcFailed', Number(out.failed).toLocaleString('id-ID'));
    _setText('fcFailedSub', out.total > 0 ? Math.round(out.failed / out.total * 100) + '% fail rate' : '–');
    _setText('fcIncoming', Number(inc.total).toLocaleString('id-ID'));
    _setText('fcIncomingSub', inc.unread + ' belum dibaca · ' + inc.today + ' hari ini');
    _setBar('fcSentBar', out.sent / Math.max(out.total, 1));
    _setBar('fcSentBar2', out.sent / Math.max(out.total, 1));
    _setBar('fcFailedBar', out.failed / Math.max(out.total, 1));
    // Update tab counts
    _setText('tabOutCount', Number(out.total).toLocaleString('id-ID'));
    _setText('tabInCount', Number(inc.total).toLocaleString('id-ID'));
}

// ── Chart ──────────────────────────────────────────────────────
async function loadChart(days) {
    const d = await App.api('/message-logs/chart?days=' + days);
    if (!d?.success) return;
    const labels = d.data.map(r => {
        const dt = new Date(r.date);
        return (dt.getDate()) + '/' + (dt.getMonth() + 1);
    });
    const ctx = document.getElementById('activityChart');
    if (!ctx) return;
    if (_chart) _chart.destroy();
    _chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Keluar', data: d.data.map(r => r.sent), backgroundColor: 'rgba(26,110,245,.7)', borderRadius: 4, borderSkipped: false },
                { label: 'Masuk', data: d.data.map(r => r.incoming), backgroundColor: 'rgba(0,212,164,.6)', borderRadius: 4, borderSkipped: false },
                { label: 'Gagal', data: d.data.map(r => r.failed), backgroundColor: 'rgba(245,54,92,.55)', borderRadius: 4, borderSkipped: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: true,
            plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 10 } }, tooltip: { mode: 'index' } },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
                y: { stacked: true, beginAtZero: true, ticks: { font: { size: 11 }, stepSize: 1 }, grid: { color: '#f0f4ff' } }
            }
        }
    });
}

window.setChartDays = function (days, btn) {
    _chartDays = days;
    document.querySelectorAll('#days7,#days14,#days30').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _setText('chartSubtitle', days + ' hari terakhir');
    loadChart(days);
};

// ── Type breakdown pills ───────────────────────────────────────
async function loadTypeBreakdown() {
    const d = await App.api('/message-logs/breakdown');
    if (!d?.success) return;
    const el = document.getElementById('breakdownPills');
    if (!el) return;
    const STATUS_COLORS = { sent: '#dcfce7;color:#16a34a', delivered: '#dcfce7;color:#16a34a', read: '#dbeafe;color:#2563eb', failed: '#fee2e2;color:#dc2626', pending: '#fef3c7;color:#d97706' };
    el.innerHTML = d.data.map(r =>
        '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10.5px;font-weight:700;background:' + (STATUS_COLORS[r.status] || '#f1f5f9;color:#64748b') + ';margin:2px;">' +
        (STATUS_LABEL[r.status] || r.status) + ': ' + Number(r.total).toLocaleString('id-ID') +
        '</span>'
    ).join('');
}

window.filterByType = function (type) {
    document.getElementById('filterType').value = type;
    _page = 1;
    loadLogs();
};

// ── Tab switch ────────────────────────────────────────────────
window.switchTab = function (tab, btn) {
    _tab = tab;
    _page = 1;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Show/hide type filter (only for outgoing)
    const typeSel = document.getElementById('filterType');
    const statusSel = document.getElementById('filterStatus');
    if (typeSel) typeSel.style.display = tab === 'outgoing' ? '' : 'none';
    if (statusSel) statusSel.style.display = tab === 'outgoing' ? '' : 'none';
    _setText('tableTitle', tab === 'outgoing' ? 'Pesan Keluar' : 'Pesan Masuk');
    renderTableHead();
    loadLogs();
};

// ── Render table header ────────────────────────────────────────
function renderTableHead() {
    const thead = document.getElementById('logTableHead');
    if (!thead) return;
    if (_tab === 'outgoing') {
        thead.innerHTML = '<tr><th>#</th><th>Nomor Tujuan</th><th>Pesan</th><th>Tipe</th><th>Status</th><th>Session</th><th>Waktu</th></tr>';
    } else {
        thead.innerHTML = '<tr><th>#</th><th>Dari</th><th>Nama</th><th>Pesan</th><th>Status</th><th>Waktu</th></tr>';
    }
}

// ── Load logs ─────────────────────────────────────────────────
async function loadLogs() {
    const search = document.getElementById('filterSearch')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';
    const type = document.getElementById('filterType')?.value || '';
    const dfrom = document.getElementById('filterDateFrom')?.value || '';
    const dto = document.getElementById('filterDateTo')?.value || '';

    const endpoint = _tab === 'outgoing' ? '/message-logs/outgoing' : '/message-logs/incoming';
    const params = new URLSearchParams({ page: _page, limit: _limit, search });
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (dfrom) params.set('date_from', dfrom);
    if (dto) params.set('date_to', dto);

    const tbody = document.getElementById('logTableBody');
    if (!tbody) return;

    const d = await App.api(endpoint + '?' + params);
    if (!d?.success) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="tbl-empty"><p style="color:#dc2626;">Gagal memuat data</p></div></td></tr>';
        return;
    }

    _total = Number(d.total || (d.pagination && d.pagination.total) || (Array.isArray(d.data) ? d.data.length : 0) || 0);
    _setText('tableSubtitle', _total.toLocaleString('id-ID') + ' log ditemukan');

    if (!d.data?.length) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="tbl-empty"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg><p>Tidak ada log ditemukan</p></div></td></tr>';
        renderPagination();
        return;
    }

    if (_tab === 'outgoing') {
        tbody.innerHTML = d.data.map((r, i) => {
            const idx = (_page - 1) * _limit + i + 1;
            const msg = (r.message || '').replace(/\n/g, ' ').substring(0, 80) + ((r.message || '').length > 80 ? '…' : '');
            const stCls = STATUS_CLASS[r.status] || 'st-sent';
            const stLbl = STATUS_LABEL[r.status] || r.status;
            const custInfo = r.customer_name ? '<div style="font-size:10px;color:#94a3b8;">' + _esc(r.customer_name) + (r.cid ? ' · ' + r.cid : '') + '</div>' : '';
            return '<tr onclick="openDetail(' + r.id + ')" style="cursor:pointer;">' +
                '<td style="color:#94a3b8;font-size:11px;">' + idx + '</td>' +
                '<td><span class="phone-tag">' + _esc(r.phone || '') + '</span>' + custInfo + '</td>' +
                '<td><div class="msg-preview">' + _esc(msg) + '</div></td>' +
                '<td><span class="tc ' + (TYPE_CLASS[r.type] || 'tc-manual') + '">' + (TYPE_LABEL[r.type] || r.type || 'text') + '</span></td>' +
                '<td><span class="st ' + stCls + '">' + stLbl + '</span></td>' +
                '<td style="font-size:11px;color:#94a3b8;font-family:monospace;">' + _esc(r.session_id || '–') + '</td>' +
                '<td style="font-size:11.5px;color:#6b7fa8;white-space:nowrap;">' + _fmtDt(r.sent_at) + '</td>' +
                '</tr>';
        }).join('');
    } else {
        tbody.innerHTML = d.data.map((r, i) => {
            const idx = (_page - 1) * _limit + i + 1;
            const msg = (r.message || '').replace(/\n/g, ' ').substring(0, 80) + ((r.message || '').length > 80 ? '…' : '');
            const phone = r.display_phone || r.from_number || '';
            const name = r.display_name || '–';
            const isLid = (r.from_number || '').length > 13 && phone !== r.from_number;
            return '<tr onclick="openIncomingDetail(' + JSON.stringify(r.message || '') + ',\'' + _esc(phone) + '\',\'' + _esc(name) + '\',\'' + _esc(r.received_at || '') + '\')" style="cursor:pointer;">' +
                '<td style="color:#94a3b8;font-size:11px;">' + idx + '</td>' +
                '<td>' +
                '<span class="phone-tag">' + _esc(phone) + '</span>' +
                (isLid ? '<div style="font-size:10px;color:#f59e0b;margin-top:1px;">ID: ' + _esc(r.from_number || '') + '</div>' : '') +
                '</td>' +
                '<td>' +
                '<span style="font-size:12px;color:#374151;font-weight:' + (name !== '–' ? '600' : '400') + ';">' + _esc(name) + '</span>' +
                (r.cid ? '<div style="font-size:10px;color:#94a3b8;">' + _esc(r.cid) + '</div>' : '') +
                '</td>' +
                '<td><div class="msg-preview">' + _esc(msg) + '</div></td>' +
                '<td><span class="st st-in">Masuk</span></td>' +
                '<td style="font-size:11.5px;color:#6b7fa8;white-space:nowrap;">' + _fmtDt(r.received_at) + '</td>' +
                '</tr>';
        }).join('');
    }
    renderPagination();
}

// ── Pagination ────────────────────────────────────────────────
function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(_total / _limit));
    const pgInfo = document.getElementById('pgInfo');
    const pgBtns = document.getElementById('pgBtns');
    if (pgInfo) pgInfo.textContent = 'Halaman ' + _page + ' dari ' + totalPages + ' (' + _total.toLocaleString('id-ID') + ' total)';
    if (!pgBtns) return;
    let btns = '<button class="pg-btn" onclick="goPage(' + (_page - 1) + ')" ' + (_page <= 1 ? 'disabled' : '') + '>‹ Prev</button>';
    // Show window of pages
    const start = Math.max(1, _page - 2);
    const end = Math.min(totalPages, _page + 2);
    for (let p = start; p <= end; p++) {
        btns += '<button class="pg-btn ' + (p === _page ? 'active' : '') + '" onclick="goPage(' + p + ')">' + p + '</button>';
    }
    btns += '<button class="pg-btn" onclick="goPage(' + (_page + 1) + ')" ' + (_page >= totalPages ? 'disabled' : '') + '>Next ›</button>';
    pgBtns.innerHTML = btns;
}

window.goPage = function (p) {
    const totalPages = Math.ceil(_total / _limit);
    if (p < 1 || p > totalPages) return;
    _page = p;
    loadLogs();
    document.querySelector('.lg-card')?.scrollIntoView({ behavior: 'smooth' });
};

// ── Filters ───────────────────────────────────────────────────
const onFilterChange = _debounce(() => { _page = 1; loadLogs(); }, 400);
window.onFilterChange = onFilterChange;

window.resetFilters = function () {
    document.getElementById('filterSearch').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterType').value = '';
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';
    _page = 1;
    loadLogs();
};

// ── Detail modal ──────────────────────────────────────────────
window.openDetail = async function (id) {
    const d = await App.api('/message-logs/outgoing/' + id);
    if (!d?.success) return;
    const r = d.data;
    _setText('modalMeta', r.phone + ' · ' + (TYPE_LABEL[r.type] || r.type) + ' · ' + _fmtDt(r.sent_at));
    document.getElementById('modalMsg').textContent = r.message || '–';
    const apiEl = document.getElementById('modalApi');
    const apiWrap = document.getElementById('modalApiResp');
    if (r.api_response) {
        try { apiEl.textContent = JSON.stringify(JSON.parse(r.api_response), null, 2); }
        catch (e) { apiEl.textContent = r.api_response; }
        apiWrap.style.display = 'block';
    } else {
        apiWrap.style.display = 'none';
    }
    document.getElementById('msgModal').classList.add('show');
};

window.openIncomingDetail = function (msg, phone, name, dt) {
    _setText('modalMeta', phone + ' (' + name + ') · ' + _fmtDt(dt));
    document.getElementById('modalMsg').textContent = msg || '–';
    document.getElementById('modalApiResp').style.display = 'none';
    document.getElementById('msgModal').classList.add('show');
};

window.closeModal = function () {
    document.getElementById('msgModal').classList.remove('show');
};

// Close modal on Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Export CSV ────────────────────────────────────────────────
window.exportLogs = async function () {
    const search = document.getElementById('filterSearch')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';
    const type = document.getElementById('filterType')?.value || '';
    const dfrom = document.getElementById('filterDateFrom')?.value || '';
    const dto = document.getElementById('filterDateTo')?.value || '';
    const endpoint = _tab === 'outgoing' ? '/message-logs/outgoing' : '/message-logs/incoming';
    const params = new URLSearchParams({ page: 1, limit: 5000, search });
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (dfrom) params.set('date_from', dfrom);
    if (dto) params.set('date_to', dto);
    const d = await App.api(endpoint + '?' + params);
    if (!d?.success || !d.data?.length) { App.showToast('Tidak ada data untuk di-export', 'error'); return; }

    const rows = d.data;
    let csv = _tab === 'outgoing'
        ? 'ID,Phone,Tipe,Status,Durasi(ms),Waktu\n'
        : 'ID,Dari,Nama,Status,Waktu\n';
    rows.forEach(r => {
        const msg = (r.message || '').replace(/"/g, '""').replace(/\n/g, ' ');
        if (_tab === 'outgoing') {
            csv += [r.id, r.phone, r.type, r.status, r.duration_ms || '', r.sent_at].join(',') + '\n';
        } else {
            csv += [r.id, r.from_phone, r.from_name || '', r.is_read ? 'Dibaca' : 'Baru', r.received_at].join(',') + '\n';
        }
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'message_logs_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click(); URL.revokeObjectURL(url);
    App.showToast(rows.length + ' log berhasil di-export', 'success');
};

window.mlCardClick = function (el) {
    document.querySelectorAll('.ml-card').forEach(c => c.classList.remove('xc-active'));
    el.classList.add('xc-active');
    
    const filter = el.getAttribute('data-filter');
    const statusSel = document.getElementById('filterStatus');
    if (statusSel) {
        if (filter === 'total') statusSel.value = '';
        else if (filter === 'sent') statusSel.value = 'sent';
        else if (filter === 'failed') statusSel.value = 'failed';
        else if (filter === 'queue') statusSel.value = 'pending';
    }
    
    const tabOutBtn = document.getElementById('tabOut');
    if (_tab !== 'outgoing' && tabOutBtn) {
        window.switchTab('outgoing', tabOutBtn);
    } else {
        window.onFilterChange();
    }
};