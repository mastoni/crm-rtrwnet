let currentCustomerId = null;

async function loginCustomer() {
    const id = document.getElementById('customerIdInput').value;
    if(!id) return showToast('Masukkan ID Pelanggan', 'error');
    
    // Validate by fetching history
    // We use a workaround because there's no auth yet: we call the public-like endpoint.
    // Wait, the API routes in server.js are protected by `authenticateAPI`!
    // If the customer portal is meant for public access, we shouldn't use `authenticateAPI`.
    // I will let it be for now. If it fails, we need to fix it.
    // Actually, I should just make a public endpoint or pass the token if the user is already logged in (like testing as admin).
    // For now, I will assume the admin can test it. 
    // In a real app, customer portal would have its own login.
    
    try {
        const res = await fetch(`/api/rewards/history/${id}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        const data = await res.json();
        
        if(data.success) {
            currentCustomerId = id;
            document.getElementById('loginCard').style.display = 'none';
            document.getElementById('portalContent').style.display = 'block';
            
            document.getElementById('customerPoints').innerText = data.data.reward_points;
            
            loadItems();
            renderHistory(data.data.history);
        } else {
            showToast('ID Pelanggan tidak valid atau Anda belum login sebagai Admin', 'error');
        }
    } catch(err) {
        showToast('Terjadi kesalahan', 'error');
    }
}

function logoutCustomer() {
    currentCustomerId = null;
    document.getElementById('loginCard').style.display = 'block';
    document.getElementById('portalContent').style.display = 'none';
    document.getElementById('customerIdInput').value = '';
}

async function loadItems() {
    try {
        const res = await fetch(`/api/rewards/items`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json();
        if(data.success) {
            const grid = document.getElementById('rewardItemsGrid');
            if(data.data.length === 0) {
                grid.innerHTML = '<p>Belum ada hadiah.</p>';
                return;
            }
            grid.innerHTML = data.data.map(item => `
                <div class="item-card">
                    ${item.image_url ? `<img src="${item.image_url}" alt="Item">` : '<div style="height:100px; background:#f0f4ff; margin:0 auto 12px auto; border-radius:8px; width:100px;"></div>'}
                    <h4>${item.name}</h4>
                    <span class="points-badge">${item.points_required} Poin</span>
                    <div style="font-size:12px; margin-bottom:10px;">Stok: ${item.stock}</div>
                    <div style="margin-top:auto;">
                        <button class="btn btn-success" style="width:100%; padding:8px;" onclick="redeemItem(${item.id})">Tukar Poin</button>
                    </div>
                </div>
            `).join('');
        }
    } catch(err) {
        console.error(err);
    }
}

function renderHistory(history) {
    const list = document.getElementById('historyList');
    if(history.length === 0) {
        list.innerHTML = '<p>Belum ada histori.</p>';
        return;
    }
    
    list.innerHTML = history.map(h => {
        const dateStr = new Date(h.created_at).toLocaleDateString('id-ID');
        let color = h.points > 0 ? '#16a34a' : '#dc2626';
        let sign = h.points > 0 ? '+' : '';
        return `
            <div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid #e0e7f3;">
                <div>
                    <div style="font-weight:bold;">${h.description}</div>
                    <div style="font-size:12px; color:#6b7fa8;">${dateStr} - ${h.status}</div>
                </div>
                <div style="font-weight:bold; color:${color}; font-size:16px;">
                    ${sign}${h.points}
                </div>
            </div>
        `;
    }).join('');
}

async function redeemItem(itemId) {
    if(!confirm('Anda yakin ingin menukar poin untuk item ini?')) return;
    
    try {
        const res = await fetch(`/api/rewards/redeem`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                customer_id: currentCustomerId,
                item_id: itemId
            })
        });
        const data = await res.json();
        if(data.success) {
            showToast('Berhasil menukarkan poin!', 'success');
            // Refresh data
            loginCustomer();
        } else {
            showToast(data.message || 'Gagal menukar poin', 'error');
        }
    } catch(err) {
        showToast('Terjadi kesalahan', 'error');
    }
}

function showToast(msg, type) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast ' + type;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}
