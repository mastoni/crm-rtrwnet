// billing.js — Billing & Invoice Management

let _billPage = 1;
const MONTHS = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (typeof App !== 'undefined') App.init();
    // Auto-mark overdue setiap kali halaman dibuka
    App.api('/billing/mark-overdue', { method: 'POST' }).catch(function () { });
    loadBillStats();
    loadInvoices();

    const s = document.getElementById('searchInvoice');
    const f = document.getElementById('invoiceStatus');
    if (s) s.addEventListener('input', _debounce(() => { _billPage = 1; loadInvoices(); }, 350));
    if (f) f.addEventListener('change', () => { _billPage = 1; loadInvoices(); });
});

// ── STATS ─────────────────────────────────────────────────────
async function loadBillStats() {
    const d = await App.api('/billing/stats');
    if (!d?.success) return;
    const s = d.data;

    const paid = s.paidThisMonth || 0;
    const unpaid = s.unpaid || 0;
    const overdue = s.overdue || 0;
    const revenue = s.revenueThisMonth || 0;
    const total = paid + unpaid + overdue || 1;

    _setText('fcPaid', paid);
    _setText('fcUnpaid', unpaid);
    _setText('fcOverdue', overdue);
    _setText('fcRevenueVal', revenue >= 1000000
        ? 'Rp ' + (revenue / 1000000).toFixed(1).replace('.0', '') + 'jt'
        : 'Rp ' + Math.round(revenue / 1000) + 'rb');
    _setText('fcRevenueSub', paid + ' invoice lunas');
    _setText('fcRevenueAmt', 'Rp ' + Number(revenue).toLocaleString('id-ID'));

    _setBar('fcPaidBar', paid / total);
    _setBar('fcUnpaidBar', unpaid / total);
    _setBar('fcOverdueBar', overdue / total);

    const now = new Date();
    _setText('billHeaderSub',
        `${paid + unpaid + overdue} invoice total · ${overdue} overdue · ${MONTHS[now.getMonth() + 1]} ${now.getFullYear()}`
    );
}

// ── INVOICES ──────────────────────────────────────────────────
async function loadInvoices() {
    const status = document.getElementById('invoiceStatus')?.value || '';
    const search = document.getElementById('searchInvoice')?.value || '';
    const data = await App.api(
        `/billing/invoices?page=${_billPage}&limit=20&status=${status}&search=${encodeURIComponent(search)}`
    );
    const tbody = document.getElementById('invoiceTable');
    const countEl = document.getElementById('billCount');
    const subEl = document.getElementById('billSub');

    if (!data?.success) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="7"><div class="tbl-empty"><p style="color:#dc2626;">Gagal memuat data</p></div></td></tr>';
        return;
    }

    const total = data.pagination?.total || 0;
    if (countEl) countEl.textContent = total + ' invoice';
    if (subEl) subEl.textContent = total + ' invoice ditemukan';

    if (!data.data?.length) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="7"><div class="tbl-empty"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><p>Tidak ada invoice ditemukan</p></div></td></tr>';
        _renderPagination(0);
        return;
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);

    tbody.innerHTML = data.data.map(i => {
        const isPaid = i.status === 'paid';
        const today2 = new Date(); today2.setHours(0, 0, 0, 0);
        const dueObj = i.due_date ? new Date(i.due_date + 'T00:00:00') : null;
        // Overdue = unpaid/overdue di DB ATAU unpaid dengan due_date sudah lewat
        const isOverdue = i.status === 'overdue' || (i.status === 'unpaid' && dueObj && dueObj < today2);
        const isUnpaid = i.status === 'unpaid' && (!dueObj || dueObj >= today2);

        // Status badge
        const stBadge = isPaid
            ? '<span class="st-paid"><span style="width:5px;height:5px;border-radius:50%;background:#16a34a;"></span>Lunas</span>'
            : isOverdue
                ? '<span class="st-overdue"><span style="width:5px;height:5px;border-radius:50%;background:#dc2626;"></span>Overdue</span>'
                : isUnpaid
                    ? '<span class="st-unpaid"><span style="width:5px;height:5px;border-radius:50%;background:#d97706;"></span>Unpaid</span>'
                    : '<span class="st-cancelled">Cancelled</span>';

        // Due date color
        let dueTxt = _fmtDate(i.due_date);
        if (!isPaid && i.due_date) {
            const due = new Date(i.due_date + 'T00:00:00');
            const diff = Math.round((due - today) / 86400000);
            if (diff < 0) dueTxt = '<span style="color:#dc2626;font-weight:700;">' + _fmtDate(i.due_date) + '</span><div style="font-size:10px;color:#dc2626;">' + Math.abs(diff) + ' hari lalu</div>';
            else if (diff <= 3) dueTxt = '<span style="color:#d97706;font-weight:600;">' + _fmtDate(i.due_date) + '</span><div style="font-size:10px;color:#d97706;">' + diff + ' hari lagi</div>';
        }

        // Amount
        const fmtAmt = 'Rp ' + Number(i.total).toLocaleString('id-ID');

        // Action buttons — Invoice (cetak) + Kirim WA reminder (jika overdue/unpaid) + Pay (jika belum bayar)
        const invBtn = `<button class="act-btn act-inv" onclick="openInvoiceByInvId(${i.id})">
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>Invoice
    </button>`;

        const waBtn = (isOverdue || isUnpaid) ? `<button class="act-btn act-wa" onclick="sendReminder(${i.id},'${_esc(i.customer?.name || '')}')">
      <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>Kirim
    </button>` : '';

        // Data pembayaran terakhir
        var lastPay = (i.payments && i.payments.length) ? i.payments[0] : null;
        var payDate = lastPay ? _fmtDate(lastPay.payment_date) : null;
        var payMethod = lastPay ? lastPay.payment_method : null;

        // Status + tanggal bayar (di bawah badge)
        var stCell = stBadge;
        if (isPaid && payDate) {
            stCell += '<div style="font-size:11px;color:#16a34a;margin-top:3px;">✓ ' + payDate + '</div>';
        } else if (isOverdue) {
            stCell += '<div style="font-size:10px;color:#dc2626;margin-top:2px;">Segera bayar</div>';
        }

        return '<tr>' +
            '<td><span style="font-family:monospace;font-size:12px;font-weight:700;color:#0d1b3e;">' + _esc(i.invoice_number) + '</span></td>' +
            '<td>' +
            '<div style="font-weight:600;color:#0d1b3e;">' + _esc(i.customer?.name || '–') + '</div>' +
            '<div style="font-size:11px;color:#94a3b8;font-family:monospace;">' + _esc(i.customer?.customer_id || '') + '</div>' +
            '</td>' +
            '<td style="font-weight:700;color:#1a6ef5;font-size:14px;font-family:monospace;">' + fmtAmt + '</td>' +
            '<td><div style="line-height:1.4;">' + dueTxt + '</div></td>' +
            '<td class="col-hide-sm" style="font-size:12px;color:#6b7fa8;">' + (i.period_month || '–') + '/' + (i.period_year || '–') + '</td>' +
            '<td>' + stCell + '</td>' +
            '<td class="col-hide-sm">' + _pmBadge(payMethod) + '</td>' +
            '<td><div style="display:flex;gap:5px;flex-wrap:wrap;">' + invBtn + waBtn + '</div></td>' +
            '</tr>';
    }).join('');

    _renderPagination(total);
}

// ── INVOICE CETAK — buka langsung dari invoice id (unpaid/paid) ─
window.openInvoiceByInvId = function (invoiceId) {
    // Langsung buka halaman invoice by invoice ID — tidak perlu cek payment dulu
    window.open('/invoice/inv/' + invoiceId, '_blank');
};

// ── SEND REMINDER ─────────────────────────────────────────────
window.sendReminder = async function (invoiceId, custName) {
    showBillConfirm(
        'Kirim Reminder',
        'Kirim reminder tagihan ke <strong>' + custName + '</strong> via WhatsApp?',
        '#16a34a',
        async function () {
            const d = await App.api('/billing/invoices/' + invoiceId + '/reminder', { method: 'POST', body: '{}' });
            if (d && d.success) App.showToast(d.message, 'success');
            else App.showToast((d && d.message) || 'Gagal kirim reminder', 'error');
        }
    );
};

// ── GENERATE ──────────────────────────────────────────────────
window.openGenerate = function () {
    const now = new Date();
    document.getElementById('genMonth').value = now.getMonth() + 1;
    document.getElementById('genYear').value = now.getFullYear();
    document.getElementById('generateModal').classList.add('active');
};

window.closeGenerateModal = function () {
    document.getElementById('generateModal').classList.remove('active');
};

window.confirmGenerate = async function () {
    const btn = document.getElementById('confirmGenerateBtn');
    btn.disabled = true; btn.textContent = 'Generating...';
    const month = parseInt(document.getElementById('genMonth').value);
    const year = parseInt(document.getElementById('genYear').value);
    const d = await App.api('/billing/generate', { method: 'POST', body: JSON.stringify({ month, year }) });
    if (d?.success) {
        closeGenerateModal();
        loadInvoices();
        loadBillStats();
        App.showToast(d.message || 'Invoice berhasil digenerate', 'success');
    } else {
        App.showToast(d?.message || 'Gagal generate invoice', 'error');
    }
    btn.disabled = false; btn.textContent = 'Generate';
};

// ── MARK OVERDUE ──────────────────────────────────────────────
window.markOverdue = async function () {
    showBillConfirm(
        'Tandai Overdue',
        'Tandai semua invoice yang melewati jatuh tempo sebagai <strong>Overdue</strong>?',
        '#dc2626',
        async function () {
            const d = await App.api('/billing/mark-overdue', { method: 'POST' });
            if (d && d.success) {
                loadInvoices(); loadBillStats();
                App.showToast(d.message || 'Invoice overdue ditandai', 'success');
            } else App.showToast((d && d.message) || 'Gagal', 'error');
        }
    );
};

// ── PAGINATION ────────────────────────────────────────────────
function _renderPagination(total) {
    const totalPages = Math.ceil(total / 20);
    const el = document.getElementById('billPagination');
    if (!el || totalPages <= 1) { if (el) el.innerHTML = ''; return; }
    let html = '';
    if (_billPage > 1) html += '<button class="pg-btn" onclick="_goPage(' + (_billPage - 1) + ')">← Prev</button>';
    for (let i = Math.max(1, _billPage - 2); i <= Math.min(totalPages, _billPage + 2); i++)
        html += '<button class="pg-btn ' + (i === _billPage ? 'active' : '') + '" onclick="_goPage(' + i + ')">' + i + '</button>';
    if (_billPage < totalPages) html += '<button class="pg-btn" onclick="_goPage(' + (_billPage + 1) + ')">Next →</button>';
    el.innerHTML = html;
}
window._goPage = p => { _billPage = p; loadInvoices(); };

// ── CONFIRM MODAL ────────────────────────────────────────────
function showBillConfirm(title, body, accentColor, onConfirm) {
    var existing = document.getElementById('_billConfirm');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.id = '_billConfirm';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,27,62,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';
    el.innerHTML = '<div style="background:#fff;border-radius:18px;width:100%;max-width:400px;overflow:hidden;box-shadow:0 24px 80px rgba(13,27,62,.25);">'
        + '<div style="background:' + (accentColor || '#1a6ef5') + ';padding:16px 20px;display:flex;align-items:center;gap:10px;">'
        + '<div style="font-size:14px;font-weight:800;color:#fff">' + title + '</div>'
        + '</div>'
        + '<div style="padding:18px 20px;font-size:13.5px;color:#374151;line-height:1.6;">' + body + '</div>'
        + '<div style="display:flex;gap:10px;padding:0 20px 18px;justify-content:flex-end;">'
        + '<button id="_billCancel" style="padding:8px 18px;border:1.5px solid #e2e8f0;border-radius:9px;background:#fff;color:#64748b;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;">Batal</button>'
        + '<button id="_billOk" style="padding:8px 18px;border:none;border-radius:9px;background:' + (accentColor || '#1a6ef5') + ';color:#fff;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;">Ya, Lanjutkan</button>'
        + '</div>'
        + '</div>';

    document.body.appendChild(el);
    document.getElementById('_billCancel').onclick = function () { el.remove(); };
    document.getElementById('_billOk').onclick = function () { el.remove(); onConfirm(); };
    el.addEventListener('click', function (e) { if (e.target === el) el.remove(); });
}


// Payment method badge helper
function _pmBadge(method) {
    if (!method) return '<span style="color:#94a3b8;font-size:12px">–</span>';
    var labels = {
        cash: 'Cash', transfer: 'Transfer', dana: 'Dana', ovo: 'OVO',
        gopay: 'GoPay', qris: 'QRIS', ewallet: 'E-Wallet', gateway: 'Gateway', other: 'Lainnya'
    };
    var cls = ['qris', 'gateway'].includes(method) ? 'pm-' + method
        : ['dana', 'ovo', 'gopay', 'ewallet'].includes(method) ? 'pm-ewallet'
            : method === 'transfer' ? 'pm-transfer'
                : method === 'cash' ? 'pm-cash' : 'pm-other';
    return '<span class="' + cls + '">' + (labels[method] || method) + '</span>';
}
// ── HELPERS ───────────────────────────────────────────────────
function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function _setBar(id, ratio) { const el = document.getElementById(id); if (el) el.style.width = Math.min(Math.max((ratio || 0) * 100, 2), 100) + '%'; }
function _fmtDate(s) { return s ? new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '–'; }
function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }