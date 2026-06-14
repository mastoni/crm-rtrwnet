/**
 * monitoring_pppoe.js
 * Frontend logic for PPPoE Monitoring Page
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize anything needed on load
    console.log('PPPoE Monitoring Initialized');
});

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
            // Ideally populate form here with existing data
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

function saveUser() {
    // Add actual save logic via API here later
    alert('Data berhasil disimpan (Mock)');
    closeUserModal();
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
    console.log('Filtering by:', filter);
    // Implement actual table filtering here if needed
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

// Filter Secrets
function filterSecrets(val) {
    console.log('Searching secrets for:', val);
    // Add table filter logic
}
