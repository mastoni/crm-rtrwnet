// system-resources.js - Frontend script to fetch and display system resources

const iconCpu = `<svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" class="progress-icon-small"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>`;

const iconRam = `<svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" class="progress-icon-small"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line></svg>`;

const iconDisk = `<svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" class="progress-icon-small"><line x1="22" y1="12" x2="2" y2="12"></line><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path><line x1="6" y1="16" x2="6.01" y2="16"></line><line x1="10" y1="16" x2="10.01" y2="16"></line></svg>`;

const iconUptime = `<svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" class="info-icon"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
const iconModel = `<svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" class="info-icon"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect></svg>`;
const iconOs = `<svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" class="info-icon"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;

async function fetchResources() {
    try {
        const res = await App.api('/system/resources/data');
        if (res?.success) {
            renderData(res.data);
        } else {
            showError('Gagal memuat data resource');
        }
    } catch (err) {
        showError('Koneksi ke server terputus');
    }
}

function renderData(data) {
    // Router
    document.getElementById('router-status').className = 'status-badge online';
    document.getElementById('router-status').innerHTML = '<span class="status-dot"></span> Online';

    const routerHtml = `
    <div class="info-grid">
      <div class="info-row">
        <div class="info-label-group">${iconModel}<span class="info-label">Board Name</span></div>
        <div class="info-value">${data.router.board}</div>
      </div>
      <div class="info-row">
        <div class="info-label-group">${iconOs}<span class="info-label">RouterOS Version</span></div>
        <div class="info-value">${data.router.version}</div>
      </div>
      <div class="info-row">
        <div class="info-label-group">${iconUptime}<span class="info-label">Uptime</span></div>
        <div class="info-value">${data.router.uptime}</div>
      </div>
    </div>
    <div class="progress-section">
      ${renderProgress('CPU Load', iconCpu, data.router.cpu_load, '%')}
      ${renderProgress('Memory Usage', iconRam, data.router.ram_usage, '%', data.router.ram_detail)}
      ${renderProgress('Disk Usage', iconDisk, data.router.disk_usage, '%', data.router.disk_detail)}
    </div>
  `;
    document.getElementById('router-content').innerHTML = routerHtml;

    // Server
    document.getElementById('server-status').className = 'status-badge online';
    document.getElementById('server-status').innerHTML = '<span class="status-dot"></span> Online';

    const serverHtml = `
    <div class="info-grid">
      <div class="info-row">
        <div class="info-label-group">${iconModel}<span class="info-label">Platform</span></div>
        <div class="info-value">${data.server.platform}</div>
      </div>
      <div class="info-row">
        <div class="info-label-group">${iconOs}<span class="info-label">Node.js Version</span></div>
        <div class="info-value">${data.server.node_version}</div>
      </div>
      <div class="info-row">
        <div class="info-label-group">${iconUptime}<span class="info-label">Uptime</span></div>
        <div class="info-value">${data.server.uptime}</div>
      </div>
    </div>
    <div class="progress-section">
      ${renderProgress('CPU Usage', iconCpu, data.server.cpu_load, '%')}
      ${renderProgress('Memory Usage', iconRam, data.server.ram_usage, '%', data.server.ram_detail)}
    </div>
  `;
    document.getElementById('server-content').innerHTML = serverHtml;
}

function renderProgress(label, icon, value, unit, detail) {
    let colorClass = 'low';
    if (value > 60) colorClass = 'medium';
    if (value > 85) colorClass = 'high';

    return `
    <div class="progress-card">
      <div class="progress-header">
        <div class="progress-label-group">
          ${icon}
          <span class="progress-label">${label}</span>
        </div>
        <div class="progress-value-group">
          <span class="progress-percent">${value}${unit}</span>
          ${detail ? `<span class="progress-detail">${detail}</span>` : ''}
        </div>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill ${colorClass}" style="width: ${value}%"></div>
      </div>
    </div>
  `;
}

function showError(msg) {
    const errHtml = `
    <div class="error-state">
      <div class="error-icon-wrapper">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
      </div>
      <h4 class="error-title">Error</h4>
      <p class="error-message">${msg}</p>
    </div>
  `;
    document.getElementById('router-content').innerHTML = errHtml;
    document.getElementById('server-content').innerHTML = errHtml;
    document.getElementById('router-status').className = 'status-badge offline';
    document.getElementById('router-status').innerHTML = '<span class="status-dot"></span> Offline';
    document.getElementById('server-status').className = 'status-badge offline';
    document.getElementById('server-status').innerHTML = '<span class="status-dot"></span> Offline';
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof App !== 'undefined') App.init();
    fetchResources();
    setInterval(fetchResources, 10000);
});
