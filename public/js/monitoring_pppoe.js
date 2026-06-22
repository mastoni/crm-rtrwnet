/**
 * monitoring_pppoe.js
 * Frontend logic for PPPoE Monitoring Page
 */

let activeSessions = [];
let pppSecrets = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
    if (typeof App !== 'undefined') App.init();
    console.log('PPPoE Monitoring Initialized');
    
    document.getElementById('btnRefresh').addEventListener('click', () => {
        fetchActiveSessions();
        fetchSecrets();
    });
    
    document.getElementById('searchInput').addEventListener('input', (e) => filterSessions(e.target.value));
    document.getElementById('filterService').addEventListener('change', (e) => {
        currentFilter = e.target.value || 'all';
        renderSessions();
    });

    fetchActiveSessions();
    fetchSecrets();
    
    setInterval(() => {
        fetchActiveSessions();
    }, 10000);
});

async function fetchActiveSessions() {
    try {
        const res = await App.api('/mikrotik/ppp/active');
        if (res?.success) {
            activeSessions = res.data || [];
            renderSessions();
            updateStats();
        } else {
            document.getElementById('pppoeTbody').innerHTML = `<tr><td colspan="7"><div class="tbl-empty"><p>Error: ${res.message}</p></div></td></tr>`;
        }
    } catch (err) {
        console.error(err);
    }
}

async function fetchSecrets() {
    try {
        const res = await App.api('/mikrotik/ppp/secret');
        if (res?.success) {
            pppSecrets = res.data || [];
            renderSecrets();
            document.getElementById('tb-secrets').textContent = pppSecrets.length;
            document.getElementById('secretsCount').textContent = `${pppSecrets.length} user`;
        }
    } catch (err) {
        console.error(err);
    }
}

function updateStats() {
    let pppoe = 0, l2tp = 0, other = 0;
    activeSessions.forEach(s => {
        if (s.service === 'pppoe') pppoe++;
        else if (s.service === 'l2tp') l2tp++;
        else other++;
    });
    
    document.getElementById('statTotal').textContent = activeSessions.length;
    document.getElementById('pp-pill-total').textContent = `${activeSessions.length} sesi`;
    document.getElementById('tb-sessions').textContent = activeSessions.length;
    
    document.getElementById('statPppoe').textContent = pppoe;
    document.getElementById('pp-pill-pppoe').textContent = `${pppoe} sesi`;
    
    document.getElementById('statL2tp').textContent = l2tp;
    document.getElementById('pp-pill-l2tp').textContent = `${l2tp} sesi`;
    
    document.getElementById('statOther').textContent = other;
    document.getElementById('pp-pill-other').textContent = `${other} sesi`;
}

function renderSessions() {
    const tbody = document.getElementById('pppoeTbody');
    const search = document.getElementById('searchInput').value.toLowerCase();
    
    let filtered = activeSessions.filter(s => {
        if (currentFilter !== 'all' && s.service !== currentFilter) return false;
        
        if (search) {
            const name = (s.name || '').toLowerCase();
            const ip = (s.address || '').toLowerCase();
            const caller = (s['caller-id'] || '').toLowerCase();
            if (!name.includes(search) && !ip.includes(search) && !caller.includes(search)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="tbl-empty"><p>Tidak ada sesi aktif</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((s, i) => `
        <tr>
            <td class="num-cell">${i + 1}</td>
            <td class="username-cell">${s.name || '-'}</td>
            <td><span class="svc-badge svc-${s.service || 'other'}">${s.service || 'unknown'}</span></td>
            <td><span class="ip-badge">${s.address || '-'}</span></td>
            <td class="mac-cell">${s['caller-id'] || '-'}</td>
            <td><span class="uptime-badge">${s.uptime || '0s'}</span></td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="disconnectSession('${s['.id']}')">Disconnect</button>
            </td>
        </tr>
    `).join('');
}

function renderSecrets() {
    const tbody = document.getElementById('secretsTbody');
    const search = document.getElementById('secretsSearch').value.toLowerCase();
    const svcFilter = document.getElementById('secretsFilterService').value;
    
    let filtered = pppSecrets.filter(s => {
        if (svcFilter && s.service !== svcFilter && s.service !== 'any' && svcFilter !== 'any') return false;
        if (search && !(s.name || '').toLowerCase().includes(search)) return false;
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="tbl-empty"><p>Tidak ada PPP Secret</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((s, i) => `
        <tr style="${s.disabled === 'true' ? 'opacity:0.6;' : ''}">
            <td class="num-cell">${i + 1}</td>
            <td class="username-cell">${s.name || '-'}</td>
            <td><span class="svc-badge svc-${s.service === 'any' ? 'other' : s.service}">${s.service || 'any'}</span></td>
            <td>${s.profile || 'default'}</td>
            <td class="mac-cell">${s['local-address'] || '-'}</td>
            <td class="mac-cell">${s['remote-address'] || '-'}</td>
            <td>
                <span style="color:${s.disabled === 'true' ? 'var(--pp-red)' : 'var(--pp-green)'};font-weight:600;font-size:12px;">
                    ${s.disabled === 'true' ? 'Disabled' : 'Active'}
                </span>
            </td>
            <td style="font-size:12px;color:var(--muted);">${s.comment || '-'}</td>
            <td>
                <div style="display:flex;gap:5px;">
                    <button class="btn btn-outline btn-sm" onclick="openUserModal('${s['.id']}')">Edit</button>
                    <button class="btn btn-outline btn-sm" style="color:var(--pp-red);border-color:#fee2e2;" onclick="deleteSecret('${s['.id']}')">Del</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function filterSessions() {
    renderSessions();
}

function filterSecrets() {
    renderSecrets();
}

// Modal Logic
function openUserModal(id) {
    const modal = document.getElementById('userModal');
    if (modal) {
        modal.classList.add('show');
        if (!id) {
            document.getElementById('modalTitle').textContent = 'Tambah User PPPoE';
            document.getElementById('editSecretId').value = '';
            clearForm();
        } else {
            document.getElementById('modalTitle').textContent = 'Edit User PPPoE';
            document.getElementById('editSecretId').value = id;
            const secret = pppSecrets.find(s => s['.id'] === id);
            if (secret) {
                document.getElementById('f-name').value = secret.name || '';
                document.getElementById('f-password').value = secret.password || '';
                document.getElementById('f-service').value = secret.service || 'any';
                
                const profileSelect = document.getElementById('f-profile');
                let found = false;
                for (let i = 0; i < profileSelect.options.length; i++) {
                    if (profileSelect.options[i].value === secret.profile) found = true;
                }
                if (!found && secret.profile) {
                    profileSelect.add(new Option(secret.profile, secret.profile));
                }
                profileSelect.value = secret.profile || 'default';
                
                document.getElementById('f-local-address').value = secret['local-address'] || '';
                document.getElementById('f-remote-address').value = secret['remote-address'] || '';
                document.getElementById('f-caller-id').value = secret['caller-id'] || '';
                document.getElementById('f-comment').value = secret.comment || '';
                document.getElementById('f-disabled').value = secret.disabled || 'false';
            }
        }
    }
}

function closeUserModal() {
    const modal = document.getElementById('userModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function clearForm() {
    const fields = ['f-name', 'f-password', 'f-local-address', 'f-remote-address', 'f-caller-id', 'f-comment'];
    fields.forEach(f => {
        const el = document.getElementById(f);
        if (el) el.value = '';
    });
    const selects = ['f-service', 'f-profile', 'f-disabled'];
    selects.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.selectedIndex = 0;
    });
}

async function saveUser() {
    const id = document.getElementById('editSecretId').value;
    const payload = {
        id,
        name: document.getElementById('f-name').value,
        password: document.getElementById('f-password').value,
        service: document.getElementById('f-service').value,
        profile: document.getElementById('f-profile').value,
        'local-address': document.getElementById('f-local-address').value,
        'remote-address': document.getElementById('f-remote-address').value,
        'caller-id': document.getElementById('f-caller-id').value,
        comment: document.getElementById('f-comment').value,
        disabled: document.getElementById('f-disabled').value === 'true' ? 'yes' : 'no'
    };
    
    if (!payload.name) return alert('Username wajib diisi');

    const btn = document.getElementById('btnSaveUser');
    btn.disabled = true;
    btn.innerHTML = 'Menyimpan...';

    try {
        const res = await App.api('/mikrotik/ppp/secret', 'POST', payload);
        if (res?.success) {
            closeUserModal();
            fetchSecrets();
        } else {
            alert('Gagal menyimpan: ' + res.message);
        }
    } catch (err) {
        alert('Koneksi terputus');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Simpan';
    }
}

async function deleteSecret(id) {
    if (!confirm('Hapus PPP secret ini?')) return;
    try {
        const res = await App.api('/mikrotik/ppp/secret/delete', 'POST', { id });
        if (res?.success) fetchSecrets();
        else alert('Gagal menghapus: ' + res.message);
    } catch (err) {
        console.error(err);
    }
}

// Password toggle logic
function togglePwd(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🔒';
    } else {
        input.type = 'password';
        btn.textContent = '👁';
    }
}

// Stat Card Filtering Click
function pcClick(el) {
    document.querySelectorAll('.pp-card').forEach(c => c.classList.remove('pc-active'));
    el.classList.add('pc-active');

    const filter = el.getAttribute('data-filter');
    currentFilter = filter;
    document.getElementById('filterService').value = filter === 'all' ? '' : filter;
    renderSessions();
}

// Tabs Switch Logic
function switchTab(tab) {
    document.querySelectorAll('.pp-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.getElementById('tab-' + tab);
    if (activeTab) activeTab.classList.add('active');

    const sessionsPanel = document.getElementById('sessions-panel');
    const secretsPanel = document.getElementById('secrets-panel');

    if (tab === 'sessions') {
        if (sessionsPanel) sessionsPanel.style.display = 'block';
        if (secretsPanel) secretsPanel.style.display = 'none';
    } else {
        if (sessionsPanel) sessionsPanel.style.display = 'none';
        if (secretsPanel) secretsPanel.style.display = 'block';
    }
}

async function disconnectSession(id) {
    if (!confirm('Putuskan sesi ini?')) return;
    alert('Fitur disconnect langsung dari web belum diimplementasi');
}
