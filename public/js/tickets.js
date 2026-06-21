let allTickets = [];
let activeStatusFilter = '';

async function loadTickets() {
    try {
        const res = await fetch('/api/tickets');
        const json = await res.json();
        if (json.success) {
            allTickets = json.data || [];
            updateStats();
            renderTickets();
        }
    } catch (err) {
        console.error('[Tickets] Error loading tickets:', err);
    }
}

function updateStats() {
    const stats = { total: 0, open: 0, in_progress: 0, closed: 0 };
    allTickets.forEach(t => {
        stats.total++;
        const st = (t.status || '').toLowerCase();
        if (st === 'open' || st === 'new') stats.open++;
        else if (st === 'in_progress' || st === 'progress') stats.in_progress++;
        else if (st === 'closed' || st === 'resolved') stats.closed++;
    });

    if (document.getElementById('stat-total')) document.getElementById('stat-total').textContent = stats.total;
    if (document.getElementById('stat-open')) document.getElementById('stat-open').textContent = stats.open;
    if (document.getElementById('stat-in_progress')) document.getElementById('stat-in_progress').textContent = stats.in_progress;
    if (document.getElementById('stat-closed')) document.getElementById('stat-closed').textContent = stats.closed;
}

function tcCardClick(el, status) {
    document.querySelectorAll('.fin-card').forEach(c => c.classList.remove('tc-active'));
    el.classList.add('tc-active');
    activeStatusFilter = status;
    renderTickets();
}

function renderTickets() {
    const tbody = document.getElementById('ticketTableBody');
    if (!tbody) return;

    const typeFilter = document.getElementById('filterType')?.value || '';
    const prioFilter = document.getElementById('filterPriority')?.value || '';
    const statFilter = document.getElementById('filterStatus')?.value || '';
    const search = (document.getElementById('filterSearch')?.value || '').toLowerCase();

    let filtered = allTickets;

    if (activeStatusFilter) {
        if (activeStatusFilter === 'closed') {
            filtered = filtered.filter(t => t.status === 'closed' || t.status === 'resolved');
        } else {
            filtered = filtered.filter(t => (t.status || '').toLowerCase() === activeStatusFilter);
        }
    }

    if (typeFilter) filtered = filtered.filter(t => t.type === typeFilter || t.category === typeFilter);
    if (prioFilter) filtered = filtered.filter(t => t.priority === prioFilter);
    if (statFilter) filtered = filtered.filter(t => t.status === statFilter);

    if (search) {
        filtered = filtered.filter(t =>
            (t.title || '').toLowerCase().includes(search) ||
            (t.customer_name || '').toLowerCase().includes(search) ||
            (t.id || '').toString().includes(search)
        );
    }

    const countEl = document.getElementById('ticket-count');
    if (countEl) countEl.textContent = filtered.length;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8;">Tidak ada ticket ditemukan</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map((t, idx) => {
        const st = (t.status || 'unknown').toLowerCase();
        let stColor = '#64748b';
        if (st === 'open' || st === 'new') stColor = '#0891b2';
        else if (st === 'in_progress' || st === 'progress') stColor = '#16a34a';
        else if (st === 'closed' || st === 'resolved') stColor = '#ea580c';

        return `
      <tr>
        <td style="color:#94a3b8; font-size:12px; text-align:center;">${idx + 1}</td>
        <td style="font-weight:700; font-family:monospace; color:#3b82f6;">#${t.id}</td>
        <td style="font-size:13px;">${t.created_at ? new Date(t.created_at).toLocaleDateString('id-ID') : '-'}</td>
        <td>
          <div style="font-weight:700; color:var(--text, #0f172a); font-size:13px;">${escapeHtml(t.customer_name || 'Tanpa Nama')}</div>
          <div style="font-size:11px; color:#94a3b8;">${escapeHtml(t.customer_phone || '-')}</div>
        </td>
        <td style="font-size:13px; color:#475569;">${escapeHtml(t.category || t.type || '-')}</td>
        <td style="font-size:13px; font-weight:600; color:#1e293b;">${escapeHtml(t.title || '-')}</td>
        <td style="text-align:center;">
          <span style="display:inline-block; padding:4px 10px; border-radius:20px; font-size:10.5px; font-weight:700; color:${stColor}; background:${stColor}1a; text-transform:uppercase; letter-spacing:0.05em; border:1px solid ${stColor}40;">
            ${st}
          </span>
        </td>
        <td style="text-align:right;">
          <button class="btn btn-outline btn-sm" style="padding:4px 10px; font-size:11px;" onclick="showTicketDetail('${t.id}')">Detail</button>
        </td>
      </tr>
    `;
    }).join('');
}

function escapeHtml(unsafe) {
    return String(unsafe || '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof App !== 'undefined') App.init();
    loadTickets();
    setupCreateModal();
});

function showCreateModal() {
    document.getElementById('createModal').classList.add('show');
}

function closeCreateModal() {
    document.getElementById('createModal').classList.remove('show');
    document.getElementById('createTicketForm').reset();
    clearCustomer();
    
    document.querySelectorAll('.type-card').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.priority-card').forEach(c => c.classList.remove('active'));
}

function clearCustomer() {
    document.getElementById('customerId').value = '';
    document.getElementById('searchCustomer').value = '';
    document.getElementById('searchCustomerWrapper').style.display = 'block';
    document.getElementById('customerInfo').style.display = 'none';
    document.getElementById('customerDropdown').style.display = 'none';
}

function selectCustomer(id, name, details) {
    document.getElementById('customerId').value = id;
    document.getElementById('ciName').textContent = name;
    document.getElementById('ciDetails').textContent = details;
    
    document.getElementById('searchCustomerWrapper').style.display = 'none';
    document.getElementById('customerDropdown').style.display = 'none';
    document.getElementById('customerInfo').style.display = 'block';
}

function setupCreateModal() {
    // Type cards interaction
    document.querySelectorAll('.type-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.type-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            const radio = card.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });

    // Priority cards interaction
    document.querySelectorAll('.priority-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.priority-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            const radio = card.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });

    // Customer search dropdown
    const searchInput = document.getElementById('searchCustomer');
    const dropdown = document.getElementById('customerDropdown');
    let searchTimeout;
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const val = e.target.value.trim();
            if (val.length < 2) {
                dropdown.style.display = 'none';
                return;
            }
            searchTimeout = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/customers?search=${encodeURIComponent(val)}`);
                    if (!res.ok) return;
                    const json = await res.json();
                    if (json.success && json.data && json.data.length > 0) {
                        dropdown.innerHTML = json.data.map(c => `
                            <div class="cust-item" onclick="selectCustomer('${c.id}', '${escapeHtml(c.name)}', '${escapeHtml(c.phone || c.email || '-')}')">
                                <div class="ci-name">${escapeHtml(c.name)}</div>
                                <div class="ci-sub">${escapeHtml(c.phone || '')} - ${escapeHtml(c.address || '')}</div>
                            </div>
                        `).join('');
                        dropdown.style.display = 'block';
                    } else {
                        dropdown.innerHTML = '<div class="cust-item"><div class="ci-sub">Tidak ditemukan</div></div>';
                        dropdown.style.display = 'block';
                    }
                } catch (err) {
                    console.error('Search error', err);
                }
            }, 300);
        });

        // Hide dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    // Handle form submit
    const createForm = document.getElementById('createTicketForm');
    if (createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const customer_id = document.getElementById('customerId').value;
            if (!customer_id) {
                alert('Silakan pilih pelanggan terlebih dahulu!');
                return;
            }
            
            const typeRadio = document.querySelector('input[name="ticketType"]:checked');
            const prioRadio = document.querySelector('input[name="ticketPriority"]:checked');
            
            if (!typeRadio) return alert('Pilih Kategori Ticket');
            if (!prioRadio) return alert('Pilih Prioritas Ticket');

            const formData = {
                customer_id,
                type: typeRadio.value,
                priority: prioRadio.value,
                title: document.getElementById('ticketTitle').value,
                description: document.getElementById('ticketDescription').value
            };
            
            try {
                const res = await fetch('/api/tickets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                const json = await res.json();
                if (json.success) {
                    closeCreateModal();
                    loadTickets();
                } else {
                    alert(json.message || 'Gagal membuat ticket');
                }
            } catch (err) {
                console.error('Error creating ticket:', err);
                alert('Terjadi kesalahan jaringan');
            }
        });
    }
}

let currentDetailTicketId = null;

function showTicketDetail(id) {
    const t = allTickets.find(x => String(x.id) === String(id));
    if (!t) return;
    
    currentDetailTicketId = id;
    
    document.getElementById('dtl-id').textContent = '#' + t.id;
    document.getElementById('dtl-title').textContent = t.title || '-';
    document.getElementById('dtl-date').textContent = t.created_at ? new Date(t.created_at).toLocaleString('id-ID') : '-';
    
    const st = (t.status || 'unknown').toLowerCase();
    let stColor = '#64748b';
    if (st === 'open' || st === 'new') stColor = '#0891b2';
    else if (st === 'in_progress' || st === 'progress') stColor = '#16a34a';
    else if (st === 'closed' || st === 'resolved') stColor = '#ea580c';
    
    const statusEl = document.getElementById('dtl-status');
    statusEl.textContent = st;
    statusEl.style.color = stColor;
    statusEl.style.backgroundColor = stColor + '1a';
    statusEl.style.border = `1px solid ${stColor}40`;
    
    document.getElementById('dtl-cust-name').textContent = t.customer_name || 'Tanpa Nama';
    document.getElementById('dtl-cust-phone').textContent = t.customer_phone || '-';
    document.getElementById('dtl-cust-address').textContent = t.customer_address || '-';
    
    document.getElementById('dtl-type').textContent = t.type || t.category || '-';
    document.getElementById('dtl-priority').textContent = t.priority || '-';
    document.getElementById('dtl-desc').textContent = t.description || 'Tidak ada deskripsi.';
    
    const updateSelect = document.getElementById('dtl-update-status');
    if (updateSelect) {
        // Map raw status to standard options if needed
        let selectVal = st;
        if (st === 'new') selectVal = 'open';
        else if (st === 'progress') selectVal = 'in_progress';
        
        // Ensure option exists before setting
        const options = Array.from(updateSelect.options).map(o => o.value);
        if (options.includes(selectVal)) {
            updateSelect.value = selectVal;
        } else {
            updateSelect.value = ''; // fallback
        }
    }
    
    document.getElementById('detailModal').classList.add('show');
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.remove('show');
    currentDetailTicketId = null;
}

async function updateTicketStatus() {
    if (!currentDetailTicketId) return;
    
    const newStatus = document.getElementById('dtl-update-status').value;
    if (!newStatus) return;
    
    try {
        const res = await fetch(`/api/tickets/${currentDetailTicketId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const json = await res.json();
        
        if (json.success) {
            closeDetailModal();
            loadTickets();
        } else {
            alert(json.message || 'Gagal update status ticket');
        }
    } catch (err) {
        console.error('Error updating status:', err);
        alert('Terjadi kesalahan jaringan');
    }
}
