// wa-templates.js — Template Manager

let _editId = null;
const CATS = {
    reminder_before: { label: 'Reminder Sebelum JT', color: '#f59e0b', bg: '#fffbeb' },
    reminder_due: { label: 'Reminder Tepat JT', color: '#6366f1', bg: '#eef2ff' },
    reminder_overdue: { label: 'Reminder Overdue', color: '#ef4444', bg: '#fef2f2' },
    broadcast: { label: 'Broadcast', color: '#25D366', bg: '#f0fdf4' },
    payment_confirm: { label: 'Konfirmasi Pembayaran', color: '#059669', bg: '#ecfdf5' },
    custom: { label: 'Custom', color: '#94a3b8', bg: '#f8fafc' }
};
const VAR_REMINDER = ['{nama}', '{cid}', '{paket}', '{harga}', '{duedate}', '{phone}'];
const VAR_PAYMENT = ['{nama}', '{cid}', '{paket}', '{jumlah}', '{tgl_bayar}', '{metode}', '{ref_no}', '{due_date_baru}', '{phone}'];

document.addEventListener('DOMContentLoaded', () => {
    if (typeof App !== 'undefined') App.init();
    loadTemplates();
});

let _tplCache = {};
let _currentFilter = 'total';

window.wtCardClick = function (el) {
    document.querySelectorAll('.fin-card').forEach(c => c.classList.remove('fc-active'));
    el.classList.add('fc-active');
    _currentFilter = el.getAttribute('data-filter');
    
    const list = Object.values(_tplCache);
    let filtered = list;
    
    if (_currentFilter === 'reminder') {
        filtered = list.filter(t => ['reminder_before', 'reminder_due', 'reminder_overdue'].includes(t.category));
    } else if (_currentFilter === 'broadcast') {
        filtered = list.filter(t => t.category === 'broadcast');
    } else if (_currentFilter === 'custom') {
        filtered = list.filter(t => ['payment_confirm', 'custom'].includes(t.category));
    }
    
    renderList(filtered);
};

async function loadTemplates() {
    const d = await App.api('/wa/templates');
    if (!d?.success) return;
    const list = d.data || [];
    // Cache templates by ID for safe access
    _tplCache = {};
    list.forEach(t => { _tplCache[t.id] = t; });
    renderStats(list);
    renderList(list);
}

function renderStats(list) {
    const total = list.length;
    const active = list.filter(t => t.is_active).length;
    const reminder = list.filter(t => ['reminder_before', 'reminder_due', 'reminder_overdue'].includes(t.category)).length;
    const broadcast = list.filter(t => t.category === 'broadcast').length;
    const payment = list.filter(t => ['payment_confirm', 'custom'].includes(t.category)).length;

    _setText('fcTotal', total);
    _setText('fcTotalSub', active + ' aktif · ' + (total - active) + ' nonaktif');
    _setText('fcReminder', reminder);
    _setText('fcBroadcast', broadcast);
    _setText('fcPayment', payment);
    _setBar('fcTotalBar', active / Math.max(total, 1));
    _setBar('fcReminderBar', reminder / Math.max(total, 1));
    _setBar('fcBroadcastBar', broadcast / Math.max(total, 1));
    _setBar('fcPaymentBar', payment / Math.max(total, 1));
    _setText('tplHeaderSub', total + ' template tersimpan · ' + active + ' aktif');
}

function renderList(list) {
    const el = document.getElementById('tplList');
    if (!list.length) {
        el.innerHTML = '<div class="empty-state"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><p>Belum ada template. Buat template pertama!</p></div>';
        return;
    }

    // Group by category
    const grouped = {};
    list.forEach(t => { (grouped[t.category] = grouped[t.category] || []).push(t); });

    let html = '';
    Object.keys(CATS).forEach(cat => {
        const items = grouped[cat] || [];
        if (!items.length) return;
        const meta = CATS[cat];
        html += '<div style="margin-bottom:22px;">';
        html += '<div class="cat-header">';
        html += '<div style="width:28px;height:28px;border-radius:7px;background:' + meta.bg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1.5px solid ' + meta.color + '30;">';
        html += '<svg width="13" height="13" fill="none" stroke="' + meta.color + '" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg></div>';
        html += '<span style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:' + meta.color + '">' + meta.label + '</span>';
        html += '<span style="margin-left:auto;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:' + meta.bg + ';color:' + meta.color + '">' + items.length + '</span>';
        html += '</div>';
        items.forEach(t => { html += renderTplCard(t); });
        html += '</div>';
    });
    el.innerHTML = html;
}

function renderTplCard(t) {
    const vars = Array.isArray(t.variables) ? t.variables : (t.variables ? JSON.parse(t.variables) : []);
    const content = t.content || t.message || '';
    const varChips = vars.map(v =>
        '<span style="font-size:10.5px;padding:2px 6px;border-radius:5px;background:#eef3ff;color:#1a6ef5;font-family:\'DM Mono\',monospace;border:1px solid #c7d8ff;">{' + _esc(v) + '}</span>'
    ).join(' ');
    const previewHtml = content.replace(/\{(\w+)\}/g, '<span style="color:#1a6ef5;font-weight:700;background:#eef3ff;padding:1px 3px;border-radius:3px;">{$1}</span>');

    return '<div class="tpl-card ' + (t.is_active ? '' : 'inactive') + '">' +
        '<div style="display:flex;align-items:center;gap:10px;padding:13px 15px 10px;">' +
        '<div style="flex:1;min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<span style="font-size:13px;font-weight:700;color:#0d1b3e;">' + _esc(t.name) + '</span>' +
        (!t.is_active ? '<span style="font-size:10.5px;font-weight:700;background:#fee2e2;color:#dc2626;padding:2px 7px;border-radius:5px;">Nonaktif</span>' : '') +
        '</div>' +
        (vars.length ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;">' + varChips + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:5px;flex-shrink:0;">' +
        '<button class="act-btn act-edit" onclick="editTemplateById(' + t.id + ')">Edit</button>' +
        '<button class="act-btn act-tog" onclick="toggleTemplate(' + t.id + ')">' + (t.is_active ? 'Disable' : 'Enable') + '</button>' +
        '<button class="act-btn act-del" onclick="deleteTemplate(' + t.id + ',\'' + _esc(t.name) + '\')">Hapus</button>' +
        '</div>' +
        '</div>' +
        '<div class="tpl-preview" onclick="togglePreview(this)">' +
        '<div class="tpl-preview-text">' + previewHtml.replace(/\n/g, '<br>') + '</div>' +
        '</div>' +
        '</div>';
}

// ── Actions ───────────────────────────────────────────────────
window.editTemplateById = function (id) {
    const t = _tplCache && _tplCache[id];
    if (!t) { console.error('Template not found:', id); return; }
    editTemplateObj(t);
};

window.editTemplate = function (tplJson) {
    try {
        const t = JSON.parse(tplJson);
        editTemplateObj(t);
    } catch (e) {
        console.error('editTemplate parse error:', e);
    }
};

function editTemplateObj(t) {
    _editId = t.id;
    document.getElementById('fName').value = t.name || '';
    document.getElementById('fCat').value = t.category || 'custom';
    document.getElementById('fContent').value = t.content || t.message || '';
    document.getElementById('formTitle').textContent = 'Edit Template';
    document.getElementById('saveBtnLabel').textContent = 'Update Template';
    onCatChange(t.category);
    updatePreview();
    document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth' });
}

window.toggleTemplate = async function (id) {
    const d = await App.api('/wa/templates/' + id + '/toggle', { method: 'PATCH', body: '{}' });
    if (d?.success) { loadTemplates(); App.showToast(d.message, 'success'); }
    else App.showToast(d?.message || 'Gagal', 'error');
};

window.deleteTemplate = async function (id, name) {
    if (!confirm('Hapus template "' + name + '"?')) return;
    const d = await App.api('/wa/templates/' + id, { method: 'DELETE' });
    if (d?.success) { loadTemplates(); App.showToast('Template dihapus', 'success'); }
    else App.showToast(d?.message || 'Gagal', 'error');
};

window.saveTemplate = async function () {
    const name = document.getElementById('fName')?.value?.trim();
    const cat = document.getElementById('fCat')?.value;
    const content = document.getElementById('fContent')?.value?.trim();
    if (!name || !content) { App.showToast('Nama dan isi pesan wajib diisi', 'error'); return; }
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    const url = _editId ? '/wa/templates/' + _editId : '/wa/templates';
    const method = _editId ? 'PUT' : 'POST';
    const d = await App.api(url, { method, body: JSON.stringify({ name, category: cat, content }) });
    if (d?.success) {
        resetForm();
        loadTemplates();
        App.showToast(_editId ? 'Template diupdate' : 'Template berhasil dibuat', 'success');
        _editId = null;
    } else App.showToast(d?.message || 'Gagal', 'error');
    btn.disabled = false;
};

window.resetForm = function () {
    _editId = null;
    document.getElementById('fName').value = '';
    document.getElementById('fContent').value = '';
    document.getElementById('fCat').selectedIndex = 0;
    document.getElementById('formTitle').textContent = 'Buat Template';
    document.getElementById('saveBtnLabel').textContent = 'Simpan Template';
    document.getElementById('previewBox').style.display = 'none';
    onCatChange('reminder_before');
};

window.onCatChange = function (cat) {
    const vars = cat === 'payment_confirm' ? VAR_PAYMENT : VAR_REMINDER;
    const el = document.getElementById('varChips');
    if (el) el.innerHTML = vars.map(v =>
        '<span class="var-chip" onclick="insertVar(\'' + v + '\')">' + v + '</span>'
    ).join('');
};

window.insertVar = function (v) {
    const ta = document.getElementById('fContent');
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.substring(0, s) + v + ta.value.substring(e);
    ta.selectionStart = ta.selectionEnd = s + v.length;
    ta.focus();
    updatePreview();
};

window.updatePreview = async function () {
    const content = document.getElementById('fContent')?.value;
    if (!content?.trim()) { document.getElementById('previewBox').style.display = 'none'; return; }
    const d = await App.api('/wa/templates/preview', { method: 'POST', body: JSON.stringify({ content }) });
    if (d?.success) {
        document.getElementById('previewBox').style.display = 'block';
        document.getElementById('previewText').textContent = d.preview;
    }
};

window.togglePreview = function (el) {
    const txt = el.querySelector('.tpl-preview-text');
    if (txt) txt.classList.toggle('expanded');
};

function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function _setBar(id, ratio) { const el = document.getElementById(id); if (el) el.style.width = Math.min(Math.max((ratio || 0) * 100, 2), 100) + '%'; }
function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
