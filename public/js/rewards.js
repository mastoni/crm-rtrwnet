document.addEventListener('DOMContentLoaded', () => {
    loadItems();
});

async function loadItems() {
    const res = await App.api('/rewards/items');
    if(res && res.success) {
        const grid = document.getElementById('rewardItemsGrid');
        if(res.data.length === 0) {
            grid.innerHTML = '<p class="loading-state">Belum ada item reward.</p>';
            return;
        }
        grid.innerHTML = res.data.map(item => `
            <div style="border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 16px; text-align: center; background: white; transition: all 0.2s;">
                ${item.image_url ? `<img src="${item.image_url}" alt="Item" style="width: 100px; height: 100px; object-fit: cover; margin-bottom: 12px; border-radius: 8px;">` : '<div style="height:100px; background:#f1f5f9; margin-bottom:12px; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#94a3b8;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>'}
                <h4 style="margin: 0 0 8px 0; font-size: 15px; font-weight: 600;">${item.name}</h4>
                <p style="font-size:12px; color:var(--text-secondary); margin-bottom: 12px;">${item.description || '-'}</p>
                <div style="margin: 12px 0;">
                    <span class="badge badge-warning">${item.points_required} Poin</span>
                </div>
                <div style="font-size:12px; color:var(--text-muted);">Stok: <strong style="color:var(--text);">${item.stock}</strong></div>
            </div>
        `).join('');
    }
}

async function loadHistory() {
    const customerId = document.getElementById('historyCustomerId').value;
    if(!customerId) return;
    
    const res = await App.api(`/rewards/history/${customerId}`);
    const tbody = document.getElementById('historyTableBody');
    
    if(res && res.success) {
        if(res.data.history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">Belum ada histori poin untuk pelanggan ini.</td></tr>';
        } else {
            tbody.innerHTML = res.data.history.map(h => {
                const dateStr = new Date(h.created_at).toLocaleString('id-ID');
                let color = h.points > 0 ? '#16a34a' : '#dc2626';
                let sign = h.points > 0 ? '+' : '';
                return `
                <tr>
                    <td>${dateStr}</td>
                    <td><strong>${h.type}</strong></td>
                    <td>${h.description}</td>
                    <td style="color:${color}; font-weight:bold;">${sign}${h.points}</td>
                    <td>${h.status}</td>
                </tr>
                `;
            }).join('');
        }
    } else {
        tbody.innerHTML = '<tr><td colspan="5" style="color:red;">Gagal memuat histori. (Mungkin ID tidak valid)</td></tr>';
    }
}

function openAddItemModal() {
    document.getElementById('addItemModal').classList.add('active');
}

function openAdjustPointsModal() {
    document.getElementById('adjustPointsModal').classList.add('active');
}

function closeModals() {
    document.getElementById('addItemModal').classList.remove('active');
    document.getElementById('adjustPointsModal').classList.remove('active');
}

async function submitItem() {
    const data = {
        name: document.getElementById('itemName').value,
        description: document.getElementById('itemDesc').value,
        points_required: document.getElementById('itemPoints').value,
        stock: document.getElementById('itemStock').value,
        image_url: document.getElementById('itemImage').value
    };
    
    const res = await App.api('/rewards/items', { method: 'POST', body: JSON.stringify(data) });
    if(res && res.success) {
        closeModals();
        loadItems();
        App.showToast ? App.showToast('Item berhasil ditambahkan', 'success') : alert('Berhasil');
    } else {
        App.showToast ? App.showToast('Gagal menambahkan item', 'error') : alert('Gagal');
    }
}

async function submitAdjust() {
    const data = {
        customer_id: document.getElementById('adjCustomerId').value,
        points: document.getElementById('adjPoints').value,
        description: document.getElementById('adjDesc').value
    };
    
    const res = await App.api('/rewards/adjust', { method: 'POST', body: JSON.stringify(data) });
    if(res && res.success) {
        closeModals();
        document.getElementById('historyCustomerId').value = data.customer_id;
        loadHistory();
        App.showToast ? App.showToast('Poin berhasil disesuaikan', 'success') : alert('Berhasil');
    } else {
        App.showToast ? App.showToast('Gagal menyesuaikan poin', 'error') : alert('Gagal');
    }
}
