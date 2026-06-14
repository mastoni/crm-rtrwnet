// keuangan.js - Keuangan Module (Stubbed for UI stability)

let currentType = 'pemasukan';
let currentFilter = 'semua';

function loadAll() {
    console.log('loadAll triggered');
}

function syncPayments() {
    console.log('syncPayments triggered');
    App.showToast('Fitur sinkronisasi belum tersedia', 'error');
}

function keuCardClick(el) {
    document.querySelectorAll('.fin-card').forEach(c => c.classList.remove('fc-active'));
    el.classList.add('fc-active');
}

function setType(type) {
    currentType = type;
    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.type-tab[data-type="${type}"]`).classList.add('active');
    document.getElementById('form-type').value = type;

    // Show/hide fields
    document.getElementById('cond-party').classList.toggle('show', type === 'hutang' || type === 'piutang');
    document.getElementById('cond-modal').classList.toggle('show', type === 'modal');
}

function formatAmountInput(el) {
    let val = el.value.replace(/[^0-9]/g, '');
    if (val) {
        el.value = Number(val).toLocaleString('id-ID');
    } else {
        el.value = '';
    }
}

function submitForm() {
    console.log('submitForm triggered');
    App.showToast('Fitur simpan transaksi belum sepenuhnya tersedia', 'warning');
}

function cancelEdit() {
    console.log('cancelEdit triggered');
}

let searchTimer;
function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        console.log('search triggered');
    }, 300);
}

function setFilter(filter, el) {
    currentFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    console.log('filter set to', filter);
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof App !== 'undefined') App.init();
    loadAll();
});
