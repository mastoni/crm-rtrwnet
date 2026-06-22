const PingPage = {
    targets: [],
    activeFilter: 'all',
    refreshInterval: null,

    init() {
        this.bindEvents();
        this.loadStats();
        this.loadTargets();
        // Auto refresh every 15 seconds
        this.refreshInterval = setInterval(() => {
            this.loadStats();
            this.loadTargets();
        }, 15000);
    },

    bindEvents() {
        document.getElementById('btnRefresh')?.addEventListener('click', () => {
            this.loadStats();
            this.loadTargets();
        });

        document.getElementById('searchPing')?.addEventListener('input', () => {
            this.renderTable();
        });

        document.getElementById('btnAddPing')?.addEventListener('click', () => {
            this.openAddModal();
        });
    },

    async loadStats() {
        try {
            const res = await fetch('/api/monitoring/ping/stats');
            const data = await res.json();
            if (data.success) {
                const stats = data.data;
                document.getElementById('pmTotal').textContent = stats.total;
                document.getElementById('pmUp').textContent = stats.up;
                document.getElementById('pmDown').textContent = stats.down;
                document.getElementById('pmAvg').textContent = stats.avg_latency + 'ms';
            }
        } catch (err) {
            console.error('Error loading ping stats:', err);
        }
    },

    async loadTargets() {
        try {
            const res = await fetch('/api/monitoring/ping/targets');
            const data = await res.json();
            if (data.success) {
                this.targets = data.data;
                this.renderTable();
            }
        } catch (err) {
            console.error('Error loading ping targets:', err);
        }
    },

    renderTable() {
        const tbody = document.getElementById('pingTbody');
        const search = (document.getElementById('searchPing')?.value || '').toLowerCase();

        let filtered = this.targets;

        if (this.activeFilter === 'up') filtered = filtered.filter(t => t.status === 'up');
        if (this.activeFilter === 'down') filtered = filtered.filter(t => t.status === 'down');

        if (search) {
            filtered = filtered.filter(t =>
                t.name.toLowerCase().includes(search) ||
                t.target.toLowerCase().includes(search)
            );
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8; font-size:13px;">No targets found</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map((t, idx) => {
            const isUp = t.status === 'up';
            const isChecking = t.status === 'checking';
            
            let pillClass = 'pill-unknown';
            let pillText = 'UNKNOWN';
            
            if (isUp) {
                pillClass = 'pill-up';
                pillText = 'UP';
            } else if (t.status === 'down') {
                pillClass = 'pill-down';
                pillText = 'DOWN';
            } else if (isChecking) {
                pillClass = 'pill-checking';
                pillText = 'CHECKING';
            }

            let latClass = 'lat-good';
            if (!isUp) latClass = 'lat-na';
            else if (t.latency > 100) latClass = 'lat-bad';
            else if (t.latency > 50) latClass = 'lat-ok';

            return `
        <tr>
          <td style="text-align:center; color:#94a3b8; font-size:12px;">${idx + 1}</td>
          <td>
            <div class="cust-name">${esc(t.name)}</div>
          </td>
          <td>
            <span class="ip-badge">${esc(t.target)}</span>
          </td>
          <td style="text-align:center;">
            <div class="pill ${pillClass}">
              <div class="sdot"></div> ${pillText}
            </div>
          </td>
          <td style="text-align:center;">
            ${isUp ? `<span class="lat ${latClass}">${t.latency}ms</span>` : `<span class="lat lat-na">-</span>`}
          </td>
          <td style="text-align:center;">
            <span style="font-weight:600; color:${t.loss > 50 ? '#b91c1c' : (t.loss > 0 ? '#d97706' : '#15803d')};">${t.loss}%</span>
          </td>
          <td style="text-align:right;">
             <div style="display:inline-flex; gap:6px;">
                 <button class="btn btn-outline btn-sm" onclick="PingPage.openEditModal(${t.id}, '${esc(t.name)}', '${esc(t.target)}')">Edit</button>
                 <button class="btn btn-outline btn-sm" style="border-color:#fca5a5; color:#ef4444;" onclick="PingPage.deleteTarget(${t.id})">Delete</button>
                 <button class="btn btn-outline btn-sm" onclick="PingPage.checkTarget(${t.id}, this)">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px; vertical-align:middle; display:inline-block;">
                        <path d="M21 2v6h-6" />
                        <path d="M3 12a9 9 0 102.63-6.37L2 8" />
                    </svg> Check
                 </button>
             </div>
          </td>
        </tr>
      `;
        }).join('');
    },

    openAddModal() {
        document.getElementById('addName').value = '';
        document.getElementById('addTarget').value = '';
        document.getElementById('addTargetModal').classList.add('active');
    },

    openEditModal(id, name, target) {
        document.getElementById('editId').value = id;
        document.getElementById('editName').value = name;
        document.getElementById('editTarget').value = target;
        document.getElementById('editTargetModal').classList.add('active');
    },

    closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    },

    async submitAddTarget() {
        const name = document.getElementById('addName').value.trim();
        const target = document.getElementById('addTarget').value.trim();

        if (!name || !target) {
            alert('Please fill out all fields');
            return;
        }

        try {
            const res = await fetch('/api/monitoring/ping/targets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, target })
            });
            const data = await res.json();
            if (data.success) {
                this.closeModals();
                this.loadStats();
                this.loadTargets();
            } else {
                alert(data.message || 'Error adding target');
            }
        } catch (err) {
            console.error('Error submitting add target:', err);
        }
    },

    async submitEditTarget() {
        const id = document.getElementById('editId').value;
        const name = document.getElementById('editName').value.trim();
        const target = document.getElementById('editTarget').value.trim();

        if (!name || !target) {
            alert('Please fill out all fields');
            return;
        }

        try {
            const res = await fetch(`/api/monitoring/ping/targets/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, target })
            });
            const data = await res.json();
            if (data.success) {
                this.closeModals();
                this.loadStats();
                this.loadTargets();
            } else {
                alert(data.message || 'Error updating target');
            }
        } catch (err) {
            console.error('Error submitting edit target:', err);
        }
    },

    async deleteTarget(id) {
        if (!confirm('Are you sure you want to delete this target?')) return;

        try {
            const res = await fetch(`/api/monitoring/ping/targets/${id}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                this.loadStats();
                this.loadTargets();
            } else {
                alert(data.message || 'Error deleting target');
            }
        } catch (err) {
            console.error('Error deleting target:', err);
        }
    },

    async checkTarget(id, btn) {
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = 'Checking...';

        try {
            const res = await fetch(`/api/monitoring/ping/targets/${id}/check`, {
                method: 'POST'
            });
            const data = await res.json();
            if (data.success) {
                this.loadStats();
                this.loadTargets();
            } else {
                alert(data.message || 'Error checking target');
            }
        } catch (err) {
            console.error('Error manual target check:', err);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }

function pmClick(el) {
    document.querySelectorAll('.pm-card').forEach(c => c.classList.remove('pmc-active'));
    if (el) {
        el.classList.add('pmc-active');
        PingPage.activeFilter = el.dataset.filter || 'all';
        PingPage.renderTable();
    }
}

// Global modal close helpers
function closePingModals() {
    PingPage.closeModals();
}

function submitAddTarget() {
    PingPage.submitAddTarget();
}

function submitEditTarget() {
    PingPage.submitEditTarget();
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof App !== 'undefined') App.init();
    PingPage.init();
});
