// keuangan.js - Keuangan Module

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let currentType = 'semua';
let currentFilter = 'semua';
let currentPage = 1;
let pageSize = 15;
let transactions = [];
let trendChart = null;

function initDateFilters() {
    const d = new Date();
    const filterMonth = document.getElementById('filterMonth');
    const filterYear = document.getElementById('filterYear');
    
    if (filterMonth) filterMonth.value = d.getMonth() + 1;
    
    if (filterYear) {
        let currentY = d.getFullYear();
        let html = '';
        for (let i = currentY - 2; i <= currentY; i++) {
            html += `<option value="${i}">${i}</option>`;
        }
        filterYear.innerHTML = html;
        filterYear.value = currentY;
    }

    document.getElementById('f-date').valueAsDate = new Date();
}

async function loadAll() {
    try {
        const month = document.getElementById('filterMonth').value;
        const year = document.getElementById('filterYear').value;
        const search = document.getElementById('tbl-search').value;
        
        // Load Stats
        const statRes = await App.api(`/keuangan/stats?month=${month}&year=${year}`);
        if (statRes && statRes.success) {
            renderStats(statRes.data.kpi);
            renderCat(statRes.data.categories);
            renderTrendChart(statRes.data.trend);
        }

        // Load Transactions
        const txRes = await App.api(`/keuangan/transactions?month=${month}&year=${year}&type=${currentFilter}&search=${encodeURIComponent(search)}`);
        if (txRes && txRes.success) {
            transactions = txRes.data;
            currentPage = 1;
            renderTable();
        }
    } catch (err) {
        console.error('Error loading keuangan data:', err);
    }
}

function renderStats(kpi) {
    document.getElementById('kpi-masuk').textContent = 'Rp ' + (kpi.pemasukan || 0).toLocaleString('id-ID');
    document.getElementById('kpi-keluar').textContent = 'Rp ' + (kpi.pengeluaran || 0).toLocaleString('id-ID');
    document.getElementById('kpi-cashflow').textContent = 'Rp ' + (kpi.net || 0).toLocaleString('id-ID');
    document.getElementById('kpi-hutang').textContent = 'Rp ' + (kpi.hutang || 0).toLocaleString('id-ID');
    document.getElementById('kpi-piutang').textContent = 'Rp ' + (kpi.piutang || 0).toLocaleString('id-ID');
    
    document.getElementById('cp-masuk').textContent = kpi.pemasukan > 0 ? '+Naik' : '-';
    document.getElementById('cp-keluar').textContent = kpi.pengeluaran > 0 ? 'Aktif' : '-';
    document.getElementById('cp-cashflow').textContent = kpi.net >= 0 ? 'Surplus' : 'Defisit';
}

function renderCat(categories) {
    const catList = document.getElementById('cat-list');
    if (!categories || categories.length === 0) {
        catList.innerHTML = '<div style="text-align:center;padding:24px;color:var(--d-muted);font-size:12.5px">Tidak ada data pengeluaran bulan ini</div>';
        return;
    }

    let max = Math.max(...categories.map(c => Number(c.total)));
    let html = '';
    categories.forEach(c => {
        let pct = (Number(c.total) / max) * 100;
        html += `
            <div class="cat-item">
                <div style="flex:1;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span style="font-size:11.5px; font-weight:600; color:var(--d-text)">${escapeHTML(c.category)}</span>
                        <span style="font-size:11px; font-weight:700; color:var(--d-muted)">Rp ${Number(c.total).toLocaleString('id-ID')}</span>
                    </div>
                    <div class="cat-bar-bg">
                        <div class="cat-bar-fill" style="width:${pct}%"></div>
                    </div>
                </div>
            </div>
        `;
    });
    catList.innerHTML = html;
}

function renderTrendChart(trend) {
    const chartEl = document.getElementById('trendChart');
    if (!chartEl) return;
    if (!window.ApexCharts) {
        setTimeout(() => renderTrendChart(trend), 500);
        return;
    }

    if (trendChart) {
        trendChart.destroy();
    }

    trendChart = new ApexCharts(chartEl, {
        chart: { type: 'area', height: 260, toolbar: { show: false }, fontFamily: 'DM Sans, sans-serif' },
        series: [
            { name: 'Pemasukan', data: trend.pemasukan },
            { name: 'Pengeluaran', data: trend.pengeluaran },
            { name: 'Net', data: trend.net }
        ],
        colors: ['#16a34a', '#ef4444', '#2563eb'],
        dataLabels: { enabled: false },
        stroke: { curve: 'smooth', width: 2 },
        xaxis: { categories: trend.labels },
        yaxis: {
            labels: {
                formatter: v => 'Rp ' + (v / 1000000).toFixed(1) + 'M',
                style: { fontSize: '10px' }
            }
        },
        legend: { show: false },
        tooltip: {
            y: { formatter: v => 'Rp ' + v.toLocaleString('id-ID') }
        }
    });

    trendChart.render();
}

function renderTable() {
    const tbody = document.getElementById('keu-tbody');
    const totalEl = document.getElementById('tbl-count');
    
    if (transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--d-muted)">Tidak ada transaksi ditemukan</td></tr>';
        totalEl.textContent = '0 Data';
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    totalEl.textContent = transactions.length + ' Data';

    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const paginated = transactions.slice(start, end);

    let html = '';
    paginated.forEach(t => {
        let typeBadge = '';
        if (t.type === 'pemasukan') typeBadge = '<span class="type-badge tb-pemasukan">Pemasukan</span>';
        if (t.type === 'pengeluaran') typeBadge = '<span class="type-badge tb-pengeluaran">Pengeluaran</span>';
        if (t.type === 'hutang') typeBadge = '<span class="type-badge tb-hutang">Hutang</span>';
        if (t.type === 'piutang') typeBadge = '<span class="type-badge tb-piutang">Piutang</span>';
        if (t.type === 'modal') typeBadge = '<span class="type-badge tb-modal">Modal</span>';

        let dateStr = new Date(t.date).toLocaleDateString('id-ID', {day:'2-digit', month:'short', year:'numeric'});
        
        let statusBadge = '';
        if (['hutang', 'piutang'].includes(t.type)) {
            let cls = t.status === 'lunas' ? 'sb-lunas' : (t.status === 'cicilan' ? 'sb-cicilan' : 'sb-belum_lunas');
            let lbl = t.status.replace('_', ' ').toUpperCase();
            statusBadge = `<span class="status-badge ${cls}">${lbl}</span>`;
        } else {
            statusBadge = `<span style="color:var(--d-muted);font-size:11px">-</span>`;
        }

        let refParty = '';
        if (t.party_name) refParty += `<div style="font-weight:600;font-size:11.5px">${escapeHTML(t.party_name)}</div>`;
        if (t.reference_no) refParty += `<div style="font-size:10.5px;color:var(--d-muted)">${escapeHTML(t.reference_no)}</div>`;

        html += `
            <tr>
                <td style="font-weight:600">${dateStr}</td>
                <td>${typeBadge}</td>
                <td>
                    <div style="font-weight:600;font-size:12px">${escapeHTML(t.category)}</div>
                    <div style="font-size:11px;color:var(--d-muted)">${escapeHTML(t.description)}</div>
                </td>
                <td class="col-hide">${refParty || '-'}</td>
                <td>${statusBadge}</td>
                <td style="text-align:right;font-weight:700;color:${t.type==='pengeluaran' ? 'var(--d-red)' : 'var(--d-text)'}">
                    Rp ${Number(t.amount).toLocaleString('id-ID')}
                </td>
                <td style="text-align:center">
                    <button class="btn-icon btn-edit" onclick="editRow(${t.id})">
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                    </button>
                    <button class="btn-icon btn-del" onclick="deleteRow(${t.id})">
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    renderPagination();
}

function renderPagination() {
    const totalPages = Math.ceil(transactions.length / pageSize);
    const pag = document.getElementById('pagination');
    if (totalPages <= 1) {
        pag.innerHTML = '';
        return;
    }

    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }
    pag.innerHTML = html;
}

function goToPage(p) {
    currentPage = p;
    renderTable();
}

async function syncPayments() {
    const btn = document.getElementById('sync-btn');
    btn.disabled = true;
    btn.innerHTML = 'Syncing...';
    try {
        const res = await App.api('/keuangan/sync', { method: 'POST' });
        if (res.success) {
            App.showToast('Sync berhasil', 'success');
            loadAll();
        } else {
            App.showToast('Gagal: ' + res.message, 'error');
        }
    } catch(err) {
        App.showToast('Terjadi kesalahan sinkronisasi', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Sync Bulan Ini';
}

function keuCardClick(el) {
    document.querySelectorAll('.fin-card').forEach(c => c.classList.remove('fc-active'));
    el.classList.add('fc-active');
}

function setType(type) {
    const formType = document.getElementById('form-type');
    if (formType) formType.value = type;
    
    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    const tab = document.querySelector(`.type-tab[data-type="${type}"]`);
    if(tab) tab.classList.add('active');

    // Show/hide fields
    const condParty = document.getElementById('cond-party');
    const condModal = document.getElementById('cond-modal');
    if (condParty) condParty.classList.toggle('show', type === 'hutang' || type === 'piutang');
    if (condModal) condModal.classList.toggle('show', type === 'modal');
}

function formatAmountInput(el) {
    let val = el.value.replace(/[^0-9]/g, '');
    if (val) {
        el.value = Number(val).toLocaleString('id-ID');
    } else {
        el.value = '';
    }
}

async function submitForm() {
    const id = document.getElementById('form-edit-id').value;
    const type = document.getElementById('form-type').value;
    const category = document.getElementById('f-category').value;
    const desc = document.getElementById('f-description').value;
    const amountStr = document.getElementById('f-amount').value;
    const amount = Number(amountStr.replace(/[^0-9]/g, ''));
    const date = document.getElementById('f-date').value;
    
    if (!category || !desc || !amount || !date) {
        App.showToast('Harap isi Kategori, Deskripsi, Jumlah, dan Tanggal', 'error');
        return;
    }

    const payload = {
        type, category, description: desc, amount, date,
        reference_no: document.getElementById('f-ref').value,
        notes: document.getElementById('f-notes').value
    };

    if (type === 'hutang' || type === 'piutang') {
        payload.party_name = document.getElementById('f-party').value;
        payload.due_date = document.getElementById('f-due').value;
        payload.status = document.getElementById('f-status').value;
        if (!payload.party_name) {
            App.showToast('Harap isi Nama Pihak', 'error');
            return;
        }
    } else if (type === 'modal') {
        payload.source = document.getElementById('f-source').value;
    }

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    
    try {
        let res;
        if (id) {
            res = await App.api(`/keuangan/transactions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
            res = await App.api('/keuangan/transactions', { method: 'POST', body: JSON.stringify(payload) });
        }

        if (res.success) {
            App.showToast(res.message, 'success');
            cancelEdit();
            loadAll();
        } else {
            App.showToast(res.message, 'error');
        }
    } catch(err) {
        App.showToast('Terjadi kesalahan jaringan', 'error');
    }
    btn.disabled = false;
}

function editRow(id) {
    const t = transactions.find(x => x.id === id);
    if (!t) return;

    document.getElementById('form-edit-id').value = t.id;
    setType(t.type);
    
    document.getElementById('f-category').value = t.category;
    document.getElementById('f-description').value = t.description;
    
    let dt = t.date.split('T')[0];
    document.getElementById('f-date').value = dt;
    
    const amtEl = document.getElementById('f-amount');
    amtEl.value = t.amount;
    formatAmountInput(amtEl);

    document.getElementById('f-ref').value = t.reference_no || '';
    document.getElementById('f-notes').value = t.notes || '';

    if (t.type === 'hutang' || t.type === 'piutang') {
        document.getElementById('f-party').value = t.party_name || '';
        document.getElementById('f-due').value = t.due_date ? t.due_date.split('T')[0] : '';
        document.getElementById('f-status').value = t.status || 'belum_lunas';
    } else if (t.type === 'modal') {
        document.getElementById('f-source').value = t.source || '';
    }

    document.getElementById('submit-label').textContent = 'Update Transaksi';
    document.getElementById('cancel-edit-btn').style.display = 'block';
    
    // Scroll to top mobile
    if(window.innerWidth < 900) {
        window.scrollTo({top: 0, behavior: 'smooth'});
    }
}

function cancelEdit() {
    document.getElementById('form-edit-id').value = '';
    document.getElementById('f-category').value = '';
    document.getElementById('f-description').value = '';
    document.getElementById('f-amount').value = '';
    document.getElementById('f-ref').value = '';
    document.getElementById('f-notes').value = '';
    document.getElementById('f-party').value = '';
    document.getElementById('f-due').value = '';
    document.getElementById('f-status').value = 'belum_lunas';
    document.getElementById('f-source').value = '';
    document.getElementById('f-date').valueAsDate = new Date();

    document.getElementById('submit-label').textContent = 'Simpan Transaksi';
    document.getElementById('cancel-edit-btn').style.display = 'none';
}

async function deleteRow(id) {
    if (!confirm('Apakah Anda yakin ingin menghapus transaksi ini?')) return;
    try {
        const res = await App.api(`/keuangan/transactions/${id}`, { method: 'DELETE' });
        if (res.success) {
            App.showToast(res.message, 'success');
            loadAll();
        } else {
            App.showToast(res.message, 'error');
        }
    } catch(err) {
        App.showToast('Gagal menghapus', 'error');
    }
}

let searchTimer;
function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        loadAll();
    }, 400);
}

function setFilter(filter, el) {
    currentFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    if(el) el.classList.add('active');
    loadAll();
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof App !== 'undefined') App.init();
    initDateFilters();
    
    // Inject ApexCharts if missing
    if (typeof ApexCharts === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/apexcharts';
        script.onload = loadAll;
        document.head.appendChild(script);
    } else {
        loadAll();
    }
});
