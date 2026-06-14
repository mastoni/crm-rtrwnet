const PingPage = {
    targets: [],
    activeFilter: 'all',

    init() {
        this.bindEvents();
        this.loadStats();
        this.loadTargets();
    },

    bindEvents() {
        document.getElementById('btnRefresh')?.addEventListener('click', () => {
            this.loadStats();
            this.loadTargets();
        });

        document.getElementById('searchPing')?.addEventListener('input', () => {
            this.renderTable();
        });
    },

    async loadStats() {
        // MOCK DATA for now until backend is implemented
        const stats = {
            total: 12,
            up: 10,
            down: 2,
            avg_latency: 14
        };

        document.getElementById('pmTotal').textContent = stats.total;
        document.getElementById('pmUp').textContent = stats.up;
        document.getElementById('pmDown').textContent = stats.down;
        document.getElementById('pmAvg').textContent = stats.avg_latency + 'ms';
    },

    async loadTargets() {
        // MOCK DATA for now until backend is implemented
        this.targets = [
            { id: 1, name: 'Core Router', target: '192.168.1.1', status: 'up', latency: 2, loss: 0 },
            { id: 2, name: 'Distribution OLT', target: '192.168.10.2', status: 'up', latency: 5, loss: 0 },
            { id: 3, name: 'Switch BTS Bukit', target: '10.10.10.5', status: 'down', latency: 0, loss: 100 },
            { id: 4, name: 'Client A', target: '10.20.30.40', status: 'up', latency: 24, loss: 0 },
            { id: 5, name: 'Client B', target: '10.20.30.41', status: 'down', latency: 0, loss: 100 }
        ];
        this.renderTable();
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
            const pillClass = isUp ? 'pill-up' : 'pill-down';
            const pillText = isUp ? 'UP' : 'DOWN';

            let latClass = 'lat-good';
            if (!isUp) latClass = '';
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
            ${isUp ? `<span class="lat ${latClass}">${t.latency}ms</span>` : `<span style="color:#94a3b8;">-</span>`}
          </td>
          <td style="text-align:center;">
            <span style="font-weight:600; color:${t.loss > 0 ? '#b91c1c' : '#15803d'};">${t.loss}%</span>
          </td>
          <td style="text-align:right;">
             <button class="btn btn-outline btn-sm">Edit</button>
          </td>
        </tr>
      `;
        }).join('');
    }
};

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function pmClick(el) {
    document.querySelectorAll('.pm-card').forEach(c => c.classList.remove('pmc-active'));
    if (el) {
        el.classList.add('pmc-active');
        PingPage.activeFilter = el.dataset.filter || 'all';
        PingPage.renderTable();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof App !== 'undefined') App.init();
    PingPage.init();
});
