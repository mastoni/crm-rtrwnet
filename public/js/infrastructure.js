/**
 * infrastructure.js — DIGSnet Map Infrastructure
 * Tile: Streets / Satellite / Dark
 * Add: ODC, ODP, Tower, Customer
 * Manual Draw Link: klik titik A → klik titik B → simpan ke DB
 * Animated fiber optic lines (glowing green pulse)
 */

let map, tileLayer, markers = [], polylines = [];
let currentFilter = '', editId = null;
let pendingLat = null, pendingLng = null, placeMode = false, placeType = null;
let allCustomers = [], selectedCustomerId = null;
let allInfraPoints = {};

// ── Traffic / Online status ──────────────────────────────
let trafficData = {};   // customer DB id → {online,rateDown,rateUp,utilDown,utilUp,uptime}
const trafficHistory = {}; // customer DB id → [{rx,tx,t}] ring buffer 60 titik
let trafficTimer = null;
const POLL_MS = 2000;  // poll setiap 2 detik (real-time)

// Draw link state
let drawMode = false;
let drawFrom = null;       // { id, lat, lng, name, type } — first endpoint
let drawWaypoints = [];         // intermediate points clicked on map (not markers)
let drawTempLine = null;       // preview polyline (full path)
let drawSegLines = [];         // committed segment polylines

const COLORS = {
    odc: '#1d4ed8', odp: '#1d4ed8', tower: '#475569',
    customer: '#f97316', pop: '#ef4444', ont: '#22c55e'
};

const TILES = {
    streets: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attr: '&copy; OpenStreetMap contributors &copy; CARTO' },
    satellite: { url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', attr: '&copy; Google', subdomains: '0123' },
    dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr: '&copy; CARTO' }
};

// ─── CSS ──────────────────────────────────────────────
(function () {
    const s = document.createElement('style');
    s.textContent = `
    /* Fiber cables — no border, pure glow */
    .fiber-active, .fiber-trunk, .fiber-wireless { stroke-dasharray:none !important; }
    .fiber-inactive { stroke-dasharray:3 9; opacity:.18; }
    .fiber-preview  { stroke-dasharray:none; opacity:.7; }

    @keyframes custPulse { 0%{transform:scale(.85);opacity:.5} 100%{transform:scale(2.1);opacity:0} }
    #infraMap.draw-mode  { cursor:crosshair !important; }
    #infraMap.place-mode { cursor:crosshair !important; }
    .infra-line-tooltip {
      background:rgba(8,8,12,.9)!important; border:none!important; border-radius:8px!important;
      color:#fff!important; font-family:'DM Sans',sans-serif!important;
      font-size:12px!important; padding:5px 12px!important;
      box-shadow:0 2px 14px rgba(0,0,0,.3)!important; white-space:nowrap;
    }
    .infra-line-tooltip::before { display:none!important; }
    .link-popup-wrap .leaflet-popup-content-wrapper {
      border-radius:12px!important; padding:0!important;
      box-shadow:0 6px 24px rgba(0,0,0,.2)!important;
    }
    .link-popup-wrap .leaflet-popup-content { margin:0!important; }
    .link-popup-wrap .leaflet-popup-tip-container { display:none; }
    .flow-dot { transition:none!important; }

    /* Draw mode bar */
    #drawModeBar {
      position:absolute; top:62px; left:50%; transform:translateX(-50%);
      z-index:810; background:rgba(34,197,94,.95); color:#fff;
      border-radius:10px; padding:9px 18px; font-size:13px; font-weight:600;
      display:none; align-items:center; gap:10px;
      box-shadow:0 4px 20px rgba(34,197,94,.4);
    }
    #drawModeBar.active { display:flex; }
    #drawModeBar .draw-cancel {
      background:rgba(255,255,255,.2); border:1px solid rgba(255,255,255,.35);
      border-radius:8px; color:#fff; padding:3px 10px; font-size:11px; cursor:pointer;
    }
    /* Draw link button - inline di map-topbar */
    .map-draw-btn {
      background:#fff; color:#1e3a8a; border:2px solid #3b82f6;
      border-radius:10px; padding:7px 13px; font-size:12px;
      font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px;
      box-shadow:0 2px 8px rgba(59,130,246,.15); transition:all .15s; white-space:nowrap;
      flex-shrink:0;
    }
    .map-draw-btn:hover,.map-draw-btn.active { background:#1e3a8a; color:#fff; border-color:#1e3a8a; }
    .map-draw-btn svg { width:14px; height:14px; }

    /* Highlight ring on selected marker during draw */
    .draw-selected-ring {
      width:46px; height:46px; border-radius:50%;
      border:3px solid #22c55e; background:rgba(34,197,94,.15);
      animation:ringPulse .7s ease-in-out infinite alternate;
      pointer-events:none;
    }
    @keyframes ringPulse { from{transform:scale(.9);opacity:.7} to{transform:scale(1.1);opacity:1} }
    /* Hilangkan grid/border antar tile */
    .leaflet-tile {
      border:none !important;
      outline:none !important;
      margin:0 !important;
      padding:0 !important;
      box-shadow:none !important;
    }
    .leaflet-tile-pane { opacity: 1; }
    .leaflet-zoom-animated .leaflet-tile-container { will-change: transform; }
  `;
    document.head.appendChild(s);
})();

// ─── Init ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadInfraData();
    loadAllCustomers();

    // ── ODP Photo: tombol upload trigger input file ──
    document.addEventListener('click', function (e) {
        if (e.target.closest('#odp-upload-btn')) {
            const input = document.getElementById('odp-photo-input');
            if (input) { input.value = ''; input.click(); }
        }
        if (e.target.id === 'odp-photo-preview' && e.target.src) {
            window.open(e.target.src, '_blank');
        }
        // ODC photo handlers
        if (e.target.closest('#odc-upload-btn')) {
            const input = document.getElementById('odc-photo-input');
            if (input) { input.value = ''; input.click(); }
        }
        if (e.target.id === 'odc-photo-preview' && e.target.src) {
            window.open(e.target.src, '_blank');
        }
        if (e.target.id === 'odc-photo-remove') { removeOdcPhoto(); }
    });

    // ── ODP Photo: tampilkan preview saat file dipilih ──
    document.addEventListener('change', function (e) {
        // ODC photo change
        if (e.target.id === 'odc-photo-input') {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const prev = document.getElementById('odc-photo-preview');
            const remBtn = document.getElementById('odc-photo-remove');
            const btn = document.getElementById('odc-upload-btn');
            const reader = new FileReader();
            reader.onload = ev => {
                if (prev) { prev.src = ev.target.result; prev.style.display = 'block'; }
                if (remBtn) remBtn.style.display = 'inline-block';
                if (btn) btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> ' + (file.name.length > 20 ? file.name.slice(0, 18) + '…' : file.name);
            };
            reader.readAsDataURL(file);
            return;
        }
        if (e.target.id !== 'odp-photo-input') return;
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const prev = document.getElementById('odp-photo-preview');
        const remBtn = document.getElementById('odp-photo-remove');
        const btn = document.getElementById('odp-upload-btn');
        const reader = new FileReader();
        reader.onload = ev => {
            if (prev) { prev.src = ev.target.result; prev.style.display = 'block'; }
            if (remBtn) remBtn.style.display = 'inline-block';
            if (btn) btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> ' + (file.name.length > 20 ? file.name.slice(0, 18) + '…' : file.name);
        };
        reader.readAsDataURL(file);
    });
});

function initMap() {
    map = L.map('infraMap', { zoomControl: false }).setView([-6.595, 106.790], 14);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Pindahkan stats pill ke samping zoom (dalam leaflet-bottom-left)
    setTimeout(() => {
        const statsEl = document.querySelector('.map-stats');
        const container = document.querySelector('#infraMap .leaflet-bottom.leaflet-left');
        if (statsEl && container) container.appendChild(statsEl);
    }, 0);

    const streetCfg = TILES.streets;
    tileLayer = L.tileLayer(streetCfg.url, {
        attribution: streetCfg.attr, maxZoom: 20,
        updateWhenIdle: false, keepBuffer: 6,
        detectRetina: false,
        opacity: 1
    }).addTo(map);

    map.on('click', function (e) {
        if (placeMode) {
            pendingLat = e.latlng.lat; pendingLng = e.latlng.lng;
            exitPlaceMode();
            if (_pendingOpenModal) {
                _openModalAfterPick(); // open modal after location picked
            } else {
                updateCoordPreview(pendingLat, pendingLng); // edit mode: just update preview
            }
            return;
        }
        if (drawMode && drawFrom) {
            // Add waypoint on empty map click (not on a marker)
            const ll = [e.latlng.lat, e.latlng.lng];
            drawWaypoints.push(ll);
            // Draw a committed dot at waypoint
            const dot = L.circleMarker(ll, {
                radius: 5, color: '#00e5cc', fillColor: '#00e5cc', fillOpacity: 1,
                weight: 2, interactive: false, className: 'draw-waypoint-dot'
            }).addTo(map);
            drawSegLines.push(dot);
            showToast('Titik waypoint ditambahkan — klik marker untuk selesai', 'success');
        }
    });

    map.on('mousemove', function (e) {
        if (!drawMode || !drawFrom) return;
        // Build full path: from → waypoints → cursor
        const pts = [[drawFrom.lat, drawFrom.lng], ...drawWaypoints, [e.latlng.lat, e.latlng.lng]];
        if (drawTempLine) { drawTempLine.setLatLngs(pts); }
        else {
            drawTempLine = L.polyline(pts, {
                color: '#00e5cc', weight: 2, interactive: false, className: 'fiber-preview'
            }).addTo(map);
        }
        // Show live distance in draw bar
        let totalDist = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            totalDist += map.distance(pts[i], pts[i + 1]);
        }
        const distTxt = totalDist > 1000 ? (totalDist / 1000).toFixed(2) + ' km' : Math.round(totalDist) + ' m';
        const bar = document.getElementById('drawModeText');
        if (bar && drawFrom) bar.innerHTML = `<strong>${drawFrom.name}</strong> dipilih &middot; ${drawWaypoints.length} titik belok &middot; ~${distTxt} — klik marker untuk selesai`;
    });
}

// ─── Tile switcher ────────────────────────────────────
function switchTile(type, btn) {
    document.querySelectorAll('.tile-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    map.removeLayer(tileLayer);
    const cfg = TILES[type];
    // Set background sesuai tile — dark/satellite pakai background gelap
    const mapEl = document.getElementById('infraMap');
    if (type === 'dark' || type === 'satellite') {
        mapEl.style.background = '#1a1a2e';
    } else {
        mapEl.style.background = '#e8e0d8';
    }
    tileLayer = L.tileLayer(cfg.url, {
        attribution: cfg.attr, maxZoom: 20,
        subdomains: cfg.subdomains || 'abcd',
        updateWhenIdle: false, keepBuffer: 6,
        detectRetina: false,
        opacity: 1
    }).addTo(map);
}

// ─── Filter ───────────────────────────────────────────
function setFilter(type, chip) {
    // Hapus active dari semua chip
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    // Aktifkan semua chip dengan data-type yang sama (desktop + mobile)
    document.querySelectorAll(`.chip[data-type="${type}"]`).forEach(c => c.classList.add('active'));
    currentFilter = type;
    loadInfraData(type);
}

// ─── Load all ─────────────────────────────────────────
async function loadInfraData(type = currentFilter) {
    clearAll();
    const stats = { odc: 0, odp: 0, tower: 0, customer: 0, pop: 0 };

    const allRes = await App.api('/infrastructure/map');
    if (allRes?.success) allRes.data.forEach(pt => { allInfraPoints[pt.id] = pt; });

    const url = (type && type !== 'customer') ? `/infrastructure/map?types=${type}` : '/infrastructure/map';
    const res = await App.api(url);
    if (res?.success) {
        res.data.forEach(pt => {
            if (type === 'customer') return;
            if (pt.type === 'customer') return; // rendered by addCustomerMarker, skip
            addInfraMarker(pt);
            if (stats[pt.type] !== undefined) stats[pt.type]++;
        });
    }

    if (!type || type === 'customer') {
        const cr = await App.api('/customers/map');
        if (cr?.success) cr.data.forEach(c => {
            if (!c.latitude || !c.longitude) return;
            addCustomerMarker(c); stats.customer++;
        });
    }

    drawParentConnections(type);
    await drawDBLinks(type);

    document.getElementById('st-odc').textContent = stats.odc;
    document.getElementById('st-odp').textContent = stats.odp;
    document.getElementById('st-tower').textContent = stats.tower;
    document.getElementById('st-cust').textContent = stats.customer;
    document.getElementById('st-pop').textContent = stats.pop;

    if (markers.length > 0) {
        try { map.fitBounds(L.featureGroup(markers).getBounds().pad(0.1)); } catch (e) { }
    }
    // Start traffic polling
    startTrafficPolling();
}

// ─── Parent-based auto connections ───────────────────
function drawParentConnections(filter) {
    if (filter === 'customer') return;
    Object.values(allInfraPoints).forEach(pt => {
        if (pt.type !== 'odp' || !pt.parent_id) return;
        const parent = allInfraPoints[pt.parent_id];
        if (!parent) return;
        renderFiberLine(
            [+pt.latitude, +pt.longitude], [+parent.latitude, +parent.longitude],
            '#00e5cc', pt.name, parent.name, null, 'fiber-active', 'fiber', 'active', null,
            null, null, []
        );
    });
}

// ─── DB Links ─────────────────────────────────────────
async function drawDBLinks(filter) {
    const res = await App.api('/infrastructure-links');
    if (!res?.success) return;

    // Count connections per ODP/ODC to update port usage dynamically
    const connCount = {};
    res.data.forEach(link => {
        const from = link.fromPoint, to = link.toPoint;
        if (!from || !to) return;
        [from.id, to.id].forEach(id => { connCount[id] = (connCount[id] || 0) + 1; });
    });
    // Update allInfraPoints used_ports based on actual connections
    Object.entries(connCount).forEach(([id, cnt]) => {
        if (allInfraPoints[id]) allInfraPoints[id]._connCount = cnt;
    });

    res.data.forEach(link => {
        const from = link.fromPoint, to = link.toPoint;
        if (!from?.latitude || !to?.latitude) return;
        const isCustLink = from.type === 'customer' || to.type === 'customer';
        if (filter === 'customer' && !isCustLink) return;
        if (filter && filter !== 'customer' && isCustLink) return;

        const colorMap = { fiber: '#00e5cc', trunk: '#4db8ff', wireless: '#a78bfa', copper: '#fb923c' };
        const cssMap = { fiber: 'fiber-active', trunk: 'fiber-trunk', wireless: 'fiber-wireless', copper: 'fiber-active' };
        const color = colorMap[link.link_type] || '#22c55e';
        const css = link.status === 'active' ? (cssMap[link.link_type] || 'fiber-active') : 'fiber-inactive';

        // Parse waypoints from DB
        let wpts = [];
        if (link.waypoints) {
            try { wpts = typeof link.waypoints === 'string' ? JSON.parse(link.waypoints) : link.waypoints; } catch (e) { }
        }
        renderFiberLine(
            [+from.latitude, +from.longitude], [+to.latitude, +to.longitude],
            color, from.name, to.name, link.id, css, link.link_type, link.status, link.distance_m,
            from.id, to.id, wpts
        );
    });
}

// ─── Core fiber line renderer ─────────────────────────
function renderFiberLine(from, to, color, fromName, toName, linkId, cssClass, linkType, status, distM, fromPtId, toPtId, waypoints) {
    // Build full path including waypoints
    const wps = (waypoints && Array.isArray(waypoints) && waypoints.length) ? waypoints : [];
    const fullPath = [from, ...wps, to];

    // Glow layer lebar (soft blur effect)
    // Wide soft glow — no border
    const glow = L.polyline(fullPath, { color, weight: 10, opacity: .14, interactive: false }).addTo(map);
    polylines.push(glow);

    // Mid glow
    const mid = L.polyline(fullPath, { color, weight: 4, opacity: .28, interactive: false }).addTo(map);
    polylines.push(mid);

    // Core fiber line — thin & bright
    const line = L.polyline(fullPath, {
        color: '#ffffff', weight: linkId ? 1.2 : 1,
        opacity: status === 'inactive' ? .12 : .55,
        className: cssClass,
        interactive: !!linkId
    }).addTo(map);

    if (linkId) {
        const dist = distM ? ` · ${distM}m` : '';
        const tType = linkType ? ` · ${linkType.charAt(0).toUpperCase() + linkType.slice(1)}` : '';
        // Build dynamic tooltip with traffic if available
        const getTooltipHtml = () => {
            const fmtR = bps => { if (!bps) return null; if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps'; if (bps >= 1000) return Math.round(bps / 1000) + ' Kbps'; return bps + ' bps'; };
            let trafficHtml = '';
            // Look up traffic for customer endpoint
            const custPt = [fromPtId, toPtId].map(id => {
                const pt = allInfraPoints[id];
                if (!pt || pt.type !== 'customer' || !pt.metadata) return null;
                try {
                    const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata) : pt.metadata;
                    const td = meta.customer_id ? trafficData[meta.customer_id] : null;
                    return td;
                } catch (e) { return null; }
            }).find(Boolean);
            if (custPt) {
                const dl = fmtR(custPt.rateDown), ul = fmtR(custPt.rateUp);
                const online = custPt.online;
                trafficHtml = `<span style="margin-left:8px;opacity:.8">${online ? '🟢' : '🔴'}</span>`
                    + (dl ? ` <span style="color:#60a5fa">↓${dl}</span>` : '')
                    + (ul ? ` <span style="color:#fb923c">↑${ul}</span>` : '');
            }
            return `<strong>${fromName}</strong> <span style="opacity:.5">→</span> <strong>${toName}</strong>${tType}${dist}${trafficHtml}`;
        };
        const tt = L.tooltip({ sticky: true, className: 'infra-line-tooltip', permanent: false });
        tt.setContent(getTooltipHtml());
        line.bindTooltip(tt);
        // Refresh tooltip content on mouseover to get latest traffic
        line.on('mouseover', () => { tt.setContent(getTooltipHtml()); });
        line.on('click', e => {
            L.DomEvent.stopPropagation(e);
            showLinkPopup(linkId, fromName, toName, linkType, status, e.latlng, color, fromPtId, toPtId);
        });
    }
    polylines.push(line);

    // Animated data packets — multi-packet dengan trail effect
    if (status !== 'inactive') {
        const allSegments = [];
        // Kumpulkan semua segmen: from → waypoint[0] → ... → to
        const segPts = [from, ...wps, to];
        for (let i = 0; i < segPts.length - 1; i++) {
            allSegments.push([segPts[i], segPts[i + 1]]);
        }
        // Spawn DL (forward) + UL (backward) — 2 per arah
        const numPerDir = 2;
        for (let p = 0; p < numPerDir; p++) {
            addFlowPacket(allSegments, color, p / (numPerDir * 2));        // DL
            addFlowPacket(allSegments, color, 0.5 + p / (numPerDir * 2));  // UL
        }
    }
}

// ─── Packet Flow — Canvas Overlay (DL + UL dual direction) ──
let _flowCanvas = null, _flowCtx = null, _flowRAF = null;
const _flowPackets = [];

function ensureFlowCanvas() {
    if (_flowCanvas) return;

    // Canvas diletakkan di .leaflet-map-pane (parent semua Leaflet panes)
    // z-index di-set manual 450: di atas kabel (overlayPane=400), di bawah marker(600)/popup(700)
    const mapContainer = map.getContainer(); // div#infraMap
    const mapPaneEl = mapContainer.querySelector('.leaflet-map-pane');
    const mountEl = mapPaneEl || mapContainer;

    _flowCanvas = document.createElement('canvas');
    _flowCanvas.id = 'flow-canvas';
    // Posisi absolute mengikuti .leaflet-map-pane (sudah di-transform saat pan)
    // Kita TIDAK ikut transform — pakai fixed pixel relative ke map container
    _flowCanvas.style.cssText = [
        'position:absolute',
        'top:0', 'left:0',
        'pointer-events:none',
        'z-index:450',         // di atas overlay(400), di bawah marker(600)
        // reset transform agar tidak ikut Leaflet map-pane translate
        'transform:none !important',
        'will-change:contents'
    ].join(';');

    // Pasang di mapContainer langsung (bukan di map-pane) agar tidak ter-translate
    mapContainer.style.position = 'relative';
    mapContainer.appendChild(_flowCanvas);

    function resizeCanvas() {
        _flowCanvas.width = mapContainer.offsetWidth;
        _flowCanvas.height = mapContainer.offsetHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    map.on('resize', resizeCanvas);

    // Saat map bergerak/zoom, clear history pixel agar trail tidak jadi garis salah arah
    map.on('move zoom movestart zoomstart drag', () => {
        _flowPackets.forEach(p => { p.history = []; });
    });

    _flowCtx = _flowCanvas.getContext('2d');
    startFlowLoop();
}

function hexToRgbArr(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}

function latLngToPixel(latlng) {
    const pt = map.latLngToContainerPoint(L.latLng(latlng[0], latlng[1]));
    return { x: pt.x, y: pt.y };
}

function startFlowLoop() {
    let lastTime = performance.now();
    function loop(now) {
        _flowRAF = requestAnimationFrame(loop);
        const dt = Math.min(now - lastTime, 50);
        lastTime = now;

        const ctx = _flowCtx;
        const W = _flowCanvas.width, H = _flowCanvas.height;
        ctx.clearRect(0, 0, W, H);

        // Clip: exclude area yang tertutup popup yang sedang terbuka
        const popupEl = document.querySelector('.leaflet-popup');
        ctx.save();
        if (popupEl) {
            const mapRect = _flowCanvas.getBoundingClientRect();
            const popRect = popupEl.getBoundingClientRect();
            // Buat clipping region = seluruh canvas MINUS area popup
            const px = popRect.left - mapRect.left;
            const py = popRect.top - mapRect.top;
            const pw = popRect.width;
            const ph = popRect.height + 20; // +20 untuk tip/arrow
            ctx.beginPath();
            // Full canvas rect
            ctx.rect(0, 0, W, H);
            // Lubang di area popup (evenodd rule = exclude)
            ctx.rect(px - 6, py - 6, pw + 12, ph + 12);
            ctx.clip('evenodd');
        }

        _flowPackets.forEach(p => {
            p.t = (p.t + dt / p.duration) % 1.0;

            // Posisi head saat ini
            const headLL = p.getPosAtT(p.t);
            const headPx = latLngToPixel(headLL);

            // Simpan history posisi pixel untuk trail
            p.history.push({ x: headPx.x, y: headPx.y });
            if (p.history.length > p.trailLen) p.history.shift();

            const [r, g, b] = p.rgb;
            const fade = p.t < 0.06 ? p.t / 0.06 : p.t > 0.94 ? (1 - p.t) / 0.06 : 1;
            if (p.t >= 1) { p.t = 0; p.history = []; }
            if (fade < 0.02) return;

            // ── Trail garis (seperti referensi — bukan dots) ──
            if (p.history.length > 1) {
                for (let i = 1; i < p.history.length; i++) {
                    const p0 = p.history[i - 1], p1 = p.history[i];
                    const ratio = i / p.history.length;
                    const a = ratio * ratio * p.alpha * 0.55 * fade;
                    const lw = ratio * p.size * 0.9;
                    ctx.beginPath();
                    ctx.moveTo(p0.x, p0.y);
                    ctx.lineTo(p1.x, p1.y);
                    ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
                    ctx.lineWidth = lw;
                    ctx.lineCap = 'round';
                    ctx.stroke();
                }
            }

            // ── Glow bloom (two-pass) ──
            for (let pass = 0; pass < 2; pass++) {
                const rad = p.size * (pass === 0 ? 5.5 : 2.5);
                const alpha = pass === 0 ? 0.18 : 0.72;
                const grd = ctx.createRadialGradient(headPx.x, headPx.y, 0, headPx.x, headPx.y, rad);
                grd.addColorStop(0, `rgba(${r},${g},${b},${p.alpha * alpha * fade})`);
                grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
                ctx.beginPath();
                ctx.arc(headPx.x, headPx.y, rad, 0, Math.PI * 2);
                ctx.fillStyle = grd;
                ctx.fill();
            }

            // ── Solid colored core ──
            ctx.beginPath();
            ctx.arc(headPx.x, headPx.y, p.size * 0.78, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha * fade})`;
            ctx.fill();

            // ── Bright white specular ──
            ctx.beginPath();
            ctx.arc(headPx.x - p.size * 0.22, headPx.y - p.size * 0.22, p.size * 0.32, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${0.85 * fade})`;
            ctx.fill();
        });
        ctx.restore(); // restore clip
    }
    requestAnimationFrame(loop);
}

function addFlowPacket(segments, color, offsetT) {
    ensureFlowCanvas();

    const segLengths = segments.map(([a, b]) => {
        const dy = (b[0] - a[0]) * 111320;
        const dx = (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180);
        return Math.sqrt(dx * dx + dy * dy);
    });
    const totalLen = segLengths.reduce((s, l) => s + l, 0) || 1;
    const segWeights = segLengths.map(l => l / totalLen);

    function getPosAtT(t) {
        let acc = 0;
        for (let i = 0; i < segments.length; i++) {
            const w = segWeights[i];
            if (t <= acc + w || i === segments.length - 1) {
                const localT = Math.min(1, (t - acc) / Math.max(w, 0.0001));
                const [a, b] = segments[i];
                return [a[0] + (b[0] - a[0]) * localT, a[1] + (b[1] - a[1]) * localT];
            }
            acc += w;
        }
        return segments[segments.length - 1][1];
    }

    const isDL = offsetT < 0.5; // DL = forward, UL = backward
    // DL warna kabel asli, UL warna warmer (amber) agar terlihat beda arah
    const dlRgb = hexToRgbArr(color);
    const ulRgb = [255, 160, 60]; // amber untuk UL
    _flowPackets.push({
        t: isDL ? (offsetT * 2) : (1 - offsetT * 2),
        duration: 3200 + Math.random() * 1800,
        trailLen: 14 + Math.floor(Math.random() * 10),
        size: isDL ? (2.5 + Math.random() * 1.5) : (1.8 + Math.random() * 1.2),
        alpha: 0.75 + Math.random() * 0.25,
        rgb: isDL ? dlRgb : ulRgb,
        history: [],
        forward: isDL,
        getPosAtT: isDL ? getPosAtT : (t) => getPosAtT(1 - t)
    });
}

// Bersihkan semua paket saat clearAll
function clearFlowPackets() {
    _flowPackets.length = 0;
    if (_flowCtx && _flowCanvas) {
        _flowCtx.clearRect(0, 0, _flowCanvas.width, _flowCanvas.height);
    }
}

// ─── Link popup ───────────────────────────────────────
function showLinkPopup(linkId, fromName, toName, linkType, status, latlng, color, fromPtId, toPtId) {
    L.popup({ className: 'link-popup-wrap', maxWidth: 240 })
        .setLatLng(latlng)
        .setContent(`
      <div style="font-family:'DM Sans',sans-serif;padding:14px 16px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:5px;">${fromName} → ${toName}</div>
        <div style="margin-bottom:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="background:${color}22;color:${color};padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;">${(linkType || 'fiber').toUpperCase()}</span>
          <span style="font-size:11px;color:#64748b;">Status: <strong>${status}</strong></span>
        </div>
        ${(() => {
                // Show traffic for customer link
                const fmtR = bps => { if (!bps || bps === 0) return '0 bps'; if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps'; if (bps >= 1000) return Math.round(bps / 1000) + ' Kbps'; return bps + ' bps'; };
                const bar = (pct) => `<div style="width:100%;height:4px;background:#e8edf5;border-radius:2px;overflow:hidden;margin-top:3px"><div style="width:${Math.min(100, pct || 0)}%;height:100%;background:${(pct || 0) > 80 ? '#ef4444' : (pct || 0) > 60 ? '#f59e0b' : '#22c55e'};border-radius:2px"></div></div>`;
                const custTd = [fromPtId, toPtId].map(id => {
                    const pt = allInfraPoints[id];
                    if (!pt || pt.type !== 'customer' || !pt.metadata) return null;
                    try { const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata) : pt.metadata; return meta.customer_id ? trafficData[meta.customer_id] : null; }
                    catch (e) { return null; }
                }).find(Boolean);
                if (!custTd) return '';
                return `<div style="border-top:1px solid #f0f4fa;padding-top:10px;margin-top:2px">
            <div style="font-size:10.5px;font-weight:700;color:#8899b0;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
              ${custTd.online ? 'ONLINE' : 'OFFLINE'}
              ${custTd.onlineSource ? '<span style="font-size:9px;background:#e6fff7;color:#065f46;padding:1px 5px;border-radius:3px;margin-left:4px">' + (custTd.onlineSource.toUpperCase()) + '</span>' : ''}
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span style="color:#6b7fa8">↓ Download</span>
              <span style="color:#3b82f6;font-weight:700">${fmtR(custTd.rateDown)}</span>
            </div>
            ${bar(custTd.utilDown)}
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:6px;margin-bottom:4px">
              <span style="color:#6b7fa8">↑ Upload</span>
              <span style="color:#f97316;font-weight:700">${fmtR(custTd.rateUp)}</span>
            </div>
            ${bar(custTd.utilUp)}
            ${custTd.maxDown ? `<div style="font-size:10px;color:#8899b0;margin-top:4px">Limit: ${fmtR(custTd.maxDown)} / ${fmtR(custTd.maxUp)}</div>` : ''}
          </div>`;
            })()}
        <button onclick="deleteLink(${linkId})"
          style="width:100%;padding:8px;background:#fef2f2;color:#dc2626;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;gap:5px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/></svg>
          Hapus Link
        </button>
      </div>`)
        .openOn(map);
}

async function deleteLink(id) {
    if (!confirm('Hapus link ini?')) return;
    const res = await App.api(`/infrastructure-links/${id}`, { method: 'DELETE' });
    if (res?.success) { map.closePopup(); loadInfraData(); }
    else alert('Gagal: ' + (res?.message || 'Error'));
}

// ─── Infra marker ─────────────────────────────────────
function addInfraMarker(pt) {
    const color = COLORS[pt.type] || '#64748b';
    const lbl = pt.type === 'tower' ? 'Tiang' : pt.type.toUpperCase();
    const status = pt.status || 'active';
    const stColor = status === 'active' ? '#22c55e' : status === 'maintenance' ? '#f59e0b' : '#dc2626';

    // ── Icon per type ──
    function makeIcon() {
        if (pt.type === 'odp') {
            // Pin style like customer, wifi signal icon, port utilization dot
            const _used = (allInfraPoints[pt.id]?._connCount) ?? (pt.used_ports || 0);
            const portPct = pt.capacity ? Math.min(100, Math.round(_used / pt.capacity * 100)) : 0;
            const dotColor = portPct > 80 ? '#ef4444' : portPct > 60 ? '#f59e0b' : '#22c55e';
            return L.divIcon({
                className: '',
                html: `<div style="position:relative;width:36px;height:42px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.3))">
          <svg width="36" height="42" viewBox="0 0 36 42" fill="none">
            <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 24 18 24S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${color}"/>
            <circle cx="18" cy="19" r="2.5" fill="white"/>
            <path d="M12 14.5a8.5 8.5 0 0112 0" stroke="white" stroke-width="2" stroke-linecap="round" fill="none"/>
            <path d="M14.5 17a5 5 0 017 0" stroke="white" stroke-width="2" stroke-linecap="round" fill="none"/>
          </svg>
          <div style="position:absolute;top:-4px;right:-4px;width:12px;height:12px;background:${dotColor};border-radius:50%;border:2px solid #fff;box-shadow:0 0 4px ${dotColor}88"></div>
        </div>`,
                iconSize: [36, 42], iconAnchor: [18, 42]
            });
        }
        if (pt.type === 'odc') {
            return L.divIcon({
                className: '',
                html: `<div style="position:relative;width:36px;height:42px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.3))">
          <svg width="36" height="42" viewBox="0 0 36 42" fill="none">
            <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 24 18 24S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${color}"/>
            <rect x="9" y="11" width="18" height="4" rx="1" fill="none" stroke="white" stroke-width="1.8"/>
            <rect x="9" y="17" width="18" height="4" rx="1" fill="none" stroke="white" stroke-width="1.8"/>
            <circle cx="24" cy="13" r="1.2" fill="white"/>
            <circle cx="24" cy="19" r="1.2" fill="white"/>
          </svg>
        </div>`,
                iconSize: [36, 42], iconAnchor: [18, 42]
            });
        }
        if (pt.type === 'tower') {
            return L.divIcon({
                className: '',
                html: `<div style="position:relative;width:32px;height:38px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.3))">
          <svg width="32" height="38" viewBox="0 0 36 42" fill="none">
            <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 24 18 24S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${color}"/>
            <line x1="18" y1="9" x2="18" y2="25" stroke="white" stroke-width="2" stroke-linecap="round"/>
            <line x1="12" y1="16" x2="24" y2="16" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
            <line x1="11" y1="20" x2="25" y2="20" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M14 12l4-4 4 4" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </div>`,
                iconSize: [32, 38], iconAnchor: [16, 38]
            });
        }
        if (pt.type === 'pop') {
            return L.divIcon({
                className: '',
                html: `<div style="position:relative;width:36px;height:42px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.3))">
          <svg width="36" height="42" viewBox="0 0 36 42" fill="none">
            <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 24 18 24S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${color}"/>
            <rect x="8" y="12" width="20" height="14" rx="2" fill="none" stroke="white" stroke-width="1.8"/>
            <line x1="12" y1="9" x2="12" y2="12" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
            <line x1="18" y1="9" x2="18" y2="12" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
            <line x1="24" y1="9" x2="24" y2="12" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="18" cy="19" r="2.5" fill="white"/>
          </svg>
        </div>`,
                iconSize: [36, 42], iconAnchor: [18, 42]
            });
        }
        // default
        const letter = pt.type.substring(0, 1).toUpperCase();
        return L.divIcon({
            className: '',
            html: `<div style="width:30px;height:30px;background:${color};border-radius:50%;border:3px solid rgba(255,255,255,.95);box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;">
        <span style="color:#fff;font-size:10px;font-weight:700;font-family:'DM Sans',sans-serif;">${letter}</span>
      </div>`,
            iconSize: [30, 30], iconAnchor: [15, 15]
        });
    }

    const m = L.marker([+pt.latitude, +pt.longitude], {
        icon: makeIcon(),
        draggable: true,
        autoPan: true
    }).addTo(map);

    // ── Drag: simpan posisi baru ke DB ──
    let _dragToast = null;
    m.on('dragstart', () => {
        map.closePopup();
        // Tampilkan hint
        showToast('Geser ke posisi baru — lepas untuk menyimpan', 'success');
    });

    m.on('drag', () => {
        // Update visual kabel real-time saat drag
        allInfraPoints[pt.id].latitude = m.getLatLng().lat;
        allInfraPoints[pt.id].longitude = m.getLatLng().lng;
    });

    m.on('dragend', async (e) => {
        const { lat, lng } = e.target.getLatLng();
        try {
            const res = await App.api(`/infrastructure/${pt.id}`, {
                method: 'PUT',
                body: JSON.stringify({ latitude: lat, longitude: lng })
            });
            if (res?.success) {
                pt.latitude = lat;
                pt.longitude = lng;
                allInfraPoints[pt.id].latitude = lat;
                allInfraPoints[pt.id].longitude = lng;
                // Refresh kabel agar mengikuti posisi baru
                loadInfraData();
                showToast(`${pt.name} dipindahkan`, 'success');
            } else {
                // Kembalikan ke posisi semula jika gagal
                m.setLatLng([+pt.latitude, +pt.longitude]);
                showToast('Gagal menyimpan posisi', 'error');
            }
        } catch (err) {
            m.setLatLng([+pt.latitude, +pt.longitude]);
            showToast('Gagal: ' + err.message, 'error');
        }
    });

    // ── Popup builder ──
    function buildInfraPopup() {
        // Auto usage: dari jumlah link aktual (lebih akurat dari used_ports manual)
        const autoUsed = (allInfraPoints[pt.id]?._connCount) ?? (pt.used_ports || 0);
        const portBar = pt.capacity ? (() => {
            const pct = Math.min(100, Math.round(autoUsed / pt.capacity * 100));
            const bc = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
            return `<div style="margin:10px 0 4px">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
          <span style="color:#8899b0">Port Usage</span>
          <span style="font-weight:700;color:${bc}">${autoUsed} / ${pt.capacity}
            <span style="font-size:10px;font-weight:500;color:#8899b0;margin-left:3px">terhubung</span>
          </span>
        </div>
        <div style="height:5px;background:#eef2f9;border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${bc};border-radius:3px;transition:width .4s"></div>
        </div>
      </div>`;
        })() : '';

        const stDot = `<span style="display:inline-block;width:7px;height:7px;background:${stColor};border-radius:50%;margin-right:4px;vertical-align:middle"></span>`;
        const icons = {
            odp: `<svg width="15" height="15" fill="none" stroke="white" stroke-width="2.2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M8 9.5a5 5 0 018 0"/><path d="M5 7a9 9 0 0114 0"/></svg>`,
            odc: `<svg width="15" height="15" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="5" rx="1"/><rect x="2" y="10" width="20" height="5" rx="1"/></svg>`,
            tower: `<svg width="15" height="15" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="22"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="6" y1="14" x2="18" y2="14"/></svg>`,
            pop: `<svg width="15" height="15" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2" fill="white" stroke="none"/></svg>`
        };

        return `<div style="font-family:'DM Sans',sans-serif;min-width:230px;border-radius:14px;overflow:hidden">
      <div style="background:linear-gradient(135deg,${color} 0%,${color}cc 100%);padding:14px 16px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;background:rgba(255,255,255,.2);border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${icons[pt.type] || ''}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pt.name}</div>
            <div style="font-size:11px;color:rgba(255,255,255,.75);margin-top:1px">${stDot}${status.charAt(0).toUpperCase() + status.slice(1)} · ${lbl}</div>
          </div>
        </div>
      </div>
      <div style="background:#fff;padding:12px 16px">
        ${pt.address ? `<div style="display:flex;align-items:flex-start;gap:5px;font-size:12px;color:#6b7fa8;margin-bottom:8px"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;margin-top:1px"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/></svg>${pt.address}</div>` : ''}
        ${portBar}
        ${(() => { try { const m = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata || '{}') : pt.metadata || {}; return m.photo_url ? `<div style="margin:10px 0 4px"><img src="${m.photo_url}" alt="foto" onclick="window.open('${m.photo_url}','_blank')" style="width:100%;max-height:140px;object-fit:cover;border-radius:9px;cursor:zoom-in;border:1px solid #e8edf5"></div>` : ''; } catch (e) { return ''; } })()}
        ${pt.notes ? `<div style="font-size:11px;color:#94a3b8;margin-top:8px;padding-top:8px;border-top:1px dashed #eef2f9;font-style:italic">${pt.notes}</div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px">
          <button onclick="openNavigation(${pt.latitude},${pt.longitude},'${pt.name.replace(/'/g, "\'")}')"
            style="padding:9px;background:#f0fdf4;color:#15803d;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;gap:4px;transition:opacity .15s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polygon points="3,11 22,2 13,21 11,13 3,11"/></svg>Navigasi
          </button>
          <button onclick="editPoint(${pt.id})"
            style="padding:9px;background:#eff6ff;color:#1d4ed8;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;gap:4px;transition:opacity .15s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>Edit
          </button>
          <button onclick="deletePoint(${pt.id},'${pt.name.replace(/'/g, "\'")}')"
            style="padding:9px;background:#fff5f5;color:#dc2626;border:none;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;gap:4px;transition:opacity .15s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6"/></svg>Hapus
          </button>
        </div>
      </div>
    </div>`;
    }

    // Bind popup BEFORE click handler
    m.bindPopup(buildInfraPopup, { maxWidth: 280, className: 'cp-popup-wrap' });

    m.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        if (drawMode) {
            handleDrawClick({ id: pt.id, lat: +pt.latitude, lng: +pt.longitude, name: pt.name, type: pt.type });
            return;
        }
        m.openPopup();
    });

    markers.push(m);
    m._infraPt = pt;
}

// ─── Customer marker ──────────────────────────────────
function addCustomerMarker(c) {
    const active = c.status === 'active';
    const isolated = c.status === 'isolated';
    const pinColor = active ? '#1e3a8a' : (isolated ? '#b45309' : '#dc2626');
    const icon = L.divIcon({
        className: '',
        html: `<div style="position:relative;width:36px;height:42px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35));">
      <svg width="36" height="42" viewBox="0 0 36 42" fill="none">
        <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 24 18 24S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${pinColor}"/>
        <path d="M10 18.5L18 11l8 7.5" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12 17v6a1 1 0 001 1h3v-3h4v3h3a1 1 0 001-1v-6" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      ${active ? `<div style="position:absolute;inset:-5px;border-radius:50%;border:2px solid ${pinColor};opacity:0;animation:custPulse 2.2s ease-out infinite;pointer-events:none;"></div>` : ''}
    </div>`,
        iconSize: [36, 42], iconAnchor: [18, 42]
    });

    const m = L.marker([+c.latitude, +c.longitude], { icon }).addTo(map);

    m.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        if (drawMode) {
            // Use infra_point id for customers — find matching infra point
            const infraPt = Object.values(allInfraPoints).find(pt =>
                pt.type === 'customer' && pt.metadata &&
                (() => { try { const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata) : pt.metadata; return meta.customer_id === c.id; } catch (e) { return false; } })()
            );
            if (infraPt) {
                handleDrawClick({ id: infraPt.id, lat: +infraPt.latitude, lng: +infraPt.longitude, name: c.name, type: 'customer' });
            } else {
                // No infra point yet — show hint
                showToast('Tambahkan pelanggan ini ke peta dulu melalui tombol Tambah Titik → Pelanggan', 'warning');
            }
            return;
        }
        // Normal popup
        let odpName = null, odpStatus = null;
        Object.values(allInfraPoints).forEach(pt => {
            if (pt.type === 'customer' && pt.metadata && pt.parent_id) {
                try {
                    const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata) : pt.metadata;
                    if (meta.customer_id === c.id) {
                        const par = allInfraPoints[pt.parent_id];
                        if (par) { odpName = par.name; odpStatus = par.status; }
                    }
                } catch (err) { }
            }
        });
        const harga = c.package?.price ? 'Rp ' + parseInt(c.package.price).toLocaleString('id-ID') : '—';
        const phone = c.phone || '—';
        const td = trafficData[c.id] || {};
        const isOnline = td.online || false;
        const statusDot = isOnline ? '<span style="display:inline-block;width:8px;height:8px;background:#22c55e;border-radius:50%;margin-right:4px;box-shadow:0 0 5px rgba(34,197,94,.8)"></span>' : '<span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:50%;margin-right:4px"></span>';
        const fmtRate = bps => { if (!bps) return '0 bps'; if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps'; if (bps >= 1000) return (bps / 1000).toFixed(0) + ' Kbps'; return bps + ' bps'; };
        const utilBar = pct => `<div style="width:100%;height:5px;background:#e8edf5;border-radius:3px;overflow:hidden;margin-top:3px"><div style="width:${Math.min(100, pct)}%;height:100%;background:${pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e'};border-radius:3px"></div></div>`;
        const odpHtml = odpName
            ? `<span style="color:${odpStatus === 'active' ? '#22c55e' : '#f59e0b'};font-weight:700;">${odpStatus === 'active' ? '✓' : '⚠'} ${odpName}</span>`
            : `<span style="color:#f59e0b;font-weight:700;">⚠ Not Connected</span>`;
        // Build popup dynamically so traffic data is always fresh
        const buildPopup = () => {
            const td2 = trafficData[c.id] || {};
            const isOnl2 = td2.online || false;
            const sDot2 = isOnl2 ? '<span style="display:inline-block;width:8px;height:8px;background:#22c55e;border-radius:50%;margin-right:4px;box-shadow:0 0 5px rgba(34,197,94,.8)"></span>' : '<span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:50%;margin-right:4px"></span>';
            const fR2 = bps => { if (!bps || bps === 0) return '0 bps'; if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps'; if (bps >= 1000) return (bps / 1000).toFixed(0) + ' Kbps'; return bps + ' bps'; };
            const uBar2 = (pct, liveKey) => `<div style="width:100%;height:5px;background:#e8edf5;border-radius:3px;overflow:hidden;margin-top:3px"><div data-live="${liveKey}" style="width:${Math.min(100, pct || 0)}%;height:100%;background:${(pct || 0) > 80 ? '#ef4444' : (pct || 0) > 60 ? '#f59e0b' : '#22c55e'};border-radius:3px"></div></div>`;
            return `
      <div class="cp-popup">
        <div class="cp-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
          <span>${c.name}</span>
        </div>
        <div class="cp-body">
          <div class="cp-row"><span class="cp-lbl">Customer ID</span><span class="cp-val">${c.customer_id}</span></div>
          <div class="cp-row"><span class="cp-lbl">Layanan</span><span class="cp-val">${c.package?.name || '—'}</span></div>
          
          <div class="cp-row"><span class="cp-lbl">WhatsApp</span><span class="cp-val">${phone}</span></div>
          <div class="cp-row"><span class="cp-lbl">ODP Status</span><span class="cp-val">${odpHtml}</span></div>
          <div id="rx-row-${c.id}" style="padding:6px 16px;border-bottom:1px solid #f1f5f9;background:#f8fafc;display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:11px;color:#94a3b8;font-weight:500;display:flex;align-items:center;gap:4px">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>
              RX Power ONT
            </span>
            <span id="rx-val-${c.id}" style="font-size:11px;color:#94a3b8">Memuat...</span>
          </div>
          <div class="cp-row"><span class="cp-lbl">Status Online</span><span class="cp-val" data-live="status">${sDot2}${isOnl2
                    ? '<span style="color:#16a34a;font-weight:700">ONLINE</span>'
                    + (td2.onlineSource ? '<span style="background:#e6fff7;color:#065f46;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:4px;text-transform:uppercase">' + (td2.onlineSource === 'pppoe' ? 'PPPoE' : td2.onlineSource === 'arp' ? 'ARP' : td2.onlineSource === 'dhcp' ? 'DHCP' : 'Queue') + '</span>' : '')
                    + (td2.uptime ? '<span style="color:#8899b0;font-size:10px"> (' + td2.uptime + ')</span>' : '')
                    : '<span style="color:#ef4444;font-weight:700">OFFLINE</span>'
                }</span></div>
          ${td2.queueName ? `<div class="cp-row" style="flex-direction:column;align-items:flex-start;gap:3px">
            <div style="display:flex;justify-content:space-between;width:100%">
              <span class="cp-lbl">↓ Download</span>
              <span class="cp-val" style="color:#3b82f6" data-live="dl-rate">${fR2(td2.rateDown)}</span>
            </div>
            ${uBar2(td2.utilDown, "dl-bar")}
            <div style="display:flex;justify-content:space-between;width:100%;margin-top:4px">
              <span class="cp-lbl">↑ Upload</span>
              <span class="cp-val" style="color:#f97316" data-live="ul-rate">${fR2(td2.rateUp)}</span>
            </div>
            ${uBar2(td2.utilUp, "ul-bar")}
            ${td2.maxDown ? `<div style="font-size:10px;color:#8899b0;margin-top:2px">Layanan: ${fR2(td2.maxDown)} / ${fR2(td2.maxUp)}</div>` : ''}
          </div>` : ''}
          ${td2.ip ? `<div class="cp-row"><span class="cp-lbl">IP Address</span><span class="cp-val" style="font-family:monospace;font-size:11px">${td2.ip}</span></div>` : ''}
          <!-- Traffic Histogram -->
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
              <span style="font-size:11px;font-weight:700;color:#374151">Traffic History</span>
               <div style="display:flex;gap:3px">
                 <button onclick="setCustRange(${c.id},'rt',this)" style="padding:2px 6px;font-size:9.5px;font-weight:700;border:1px solid #1d4ed8;border-radius:4px;background:#1d4ed8;color:#fff;cursor:pointer;font-family:inherit">Live</button>
                 <button onclick="setCustRange(${c.id},'1m',this)" style="padding:2px 6px;font-size:9.5px;font-weight:600;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;color:#64748b;cursor:pointer;font-family:inherit">30m</button>
                 <button onclick="setCustRange(${c.id},'3h',this)" style="padding:2px 6px;font-size:9.5px;font-weight:600;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;color:#64748b;cursor:pointer;font-family:inherit">3h</button>
                 <button onclick="setCustRange(${c.id},'24h',this)" style="padding:2px 6px;font-size:9.5px;font-weight:600;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;color:#64748b;cursor:pointer;font-family:inherit">24h</button>
                 <button onclick="setCustRange(${c.id},'3d',this)" style="padding:2px 6px;font-size:9.5px;font-weight:600;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;color:#64748b;cursor:pointer;font-family:inherit">3d</button>
               </div>
            </div>
            <canvas id="chart-cust-${c.id}" width="270" height="72" style="width:100%;height:72px;display:block;border-radius:8px;background:#f1f5f9;border:1px solid #e2e8f0"></canvas>
            <div style="display:flex;align-items:center;gap:10px;margin-top:4px;font-size:10px;color:#94a3b8">
              <span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:10px;height:2px;background:#3b82f6"></span>DL</span>
              <span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:10px;height:2px;background:#f97316"></span>UL</span>
              <span id="chart-cust-${c.id}-note" style="margin-left:auto">Memuat...</span>
            </div>
          </div>
        </div>
        <div class="cp-actions" style="grid-template-columns:1fr 1fr 1fr">
          <button class="cp-btn cp-nav" onclick="openNavigation(${c.latitude},${c.longitude},'${c.name.replace(/'/g, "\\'")}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3,11 22,2 13,21 11,13 3,11"/></svg>Navigasi
          </button>
          <button class="cp-btn cp-edit" onclick="editCustInfra(${c.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit
          </button>
          <button class="cp-btn" style="background:#fff5f5;color:#dc2626;border-radius:0 0 14px 0;border-left:1px solid #fee2e2" onclick="removeMarkerFromMap(${c.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/></svg>Hapus
          </button>
        </div>
      </div>`;
        };
        // Auto-load chart saat popup dibuka
        m.on('popupopen', () => {
            setTimeout(() => loadCustChart(c.id), 100);
            // Delay sedikit agar DOM popup sudah ready
            setTimeout(() => fetchCustRxPower(c.id), 150);
        });
        // Bind once with function — Leaflet calls it fresh each time popup opens
        m.bindPopup(buildPopup, { maxWidth: 320, className: 'cp-popup-wrap', keepInView: true });
        m.openPopup();
    });
    m._custData = c; // store for traffic polling
    markers.push(m);
}

// ─── Draw link mode ───────────────────────────────────
function toggleDrawMode() {
    if (drawMode) { cancelDrawMode(); return; }
    drawMode = true;
    drawFrom = null;
    document.getElementById('infraMap').classList.add('draw-mode');
    document.getElementById('drawModeBar').classList.add('active');
    document.getElementById('drawModeText').textContent = 'Klik titik PERTAMA (Pelanggan/ODP/ODC)';
    document.getElementById('drawBtn').classList.add('active');
    map.closePopup();
}

function cancelDrawMode() {
    drawMode = false; drawFrom = null;
    drawWaypoints = [];
    if (drawTempLine) { map.removeLayer(drawTempLine); drawTempLine = null; }
    drawSegLines.forEach(l => map.removeLayer(l)); drawSegLines = [];
    document.getElementById('infraMap').classList.remove('draw-mode');
    document.getElementById('drawModeBar').classList.remove('active');
    document.getElementById('drawBtn').classList.remove('active');
}

function handleDrawClick(pt) {
    if (!drawFrom) {
        // First point
        drawFrom = pt; drawWaypoints = [];
        document.getElementById('drawModeText').innerHTML =
            `<strong>${pt.name}</strong> dipilih &middot; klik peta untuk belokkan garis, klik marker untuk selesai`;
        showSelectRing(pt.lat, pt.lng);
    } else {
        // Second marker — finish line
        if (drawFrom.id === pt.id) { showToast('Pilih titik yang berbeda', 'warning'); return; }
        // Auto-calculate distance along waypoints
        const pts = [[drawFrom.lat, drawFrom.lng], ...drawWaypoints, [pt.lat, pt.lng]];
        let totalM = 0;
        for (let i = 0; i < pts.length - 1; i++) totalM += map.distance(pts[i], pts[i + 1]);
        openLinkModal(drawFrom, pt, Math.round(totalM), drawWaypoints);
    }
}

let selectRingMarker = null;
function showSelectRing(lat, lng) {
    if (selectRingMarker) map.removeLayer(selectRingMarker);
    selectRingMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div class="draw-selected-ring"></div>', iconSize: [46, 46], iconAnchor: [23, 23] }),
        interactive: false, zIndexOffset: -10
    }).addTo(map);
}

// ─── Link save modal ──────────────────────────────────
let linkFrom = null, linkTo = null;

let linkWaypoints = [];

function openLinkModal(from, to, autoDistM, waypoints) {
    linkFrom = from; linkTo = to;
    linkWaypoints = waypoints || [];
    document.getElementById('lm-from').textContent = from.name;
    document.getElementById('lm-to').textContent = to.name;
    document.getElementById('lm-type').value = 'fiber';
    document.getElementById('lm-dist').value = autoDistM || '';
    document.getElementById('lm-notes').value = '';
    // Show waypoint count
    const wpInfo = document.getElementById('lm-waypoints');
    if (wpInfo) wpInfo.textContent = linkWaypoints.length > 0
        ? `${linkWaypoints.length} titik belok · jarak otomatis terhitung`
        : 'Garis lurus (tanpa titik belok)';
    document.getElementById('linkModal').classList.add('active');
}

function closeLinkModal() {
    document.getElementById('linkModal').classList.remove('active');
    cancelDrawMode();
    if (selectRingMarker) { map.removeLayer(selectRingMarker); selectRingMarker = null; }
}

async function saveLink() {
    if (!linkFrom || !linkTo) return;
    const btn = document.getElementById('saveLinkBtn');
    btn.textContent = 'Menyimpan...'; btn.disabled = true;
    try {
        const payload = {
            from_point_id: linkFrom.id,
            to_point_id: linkTo.id,
            link_type: document.getElementById('lm-type').value,
            distance_m: parseInt(document.getElementById('lm-dist').value) || null,
            notes: document.getElementById('lm-notes').value,
            status: 'active',
            waypoints: linkWaypoints.length ? linkWaypoints : null
        };
        const res = await App.api('/infrastructure-links', { method: 'POST', body: JSON.stringify(payload) });
        if (res?.success) {
            closeLinkModal();
            loadInfraData();
            showToast('Link berhasil dibuat!', 'success');
        } else {
            alert('Gagal: ' + (res?.message || 'Error'));
        }
    } finally { btn.textContent = 'Simpan'; btn.disabled = false; }
}

// ─── Toast notification ───────────────────────────────
function showToast(msg, type = 'success', duration = 2800) {
    const t = document.createElement('div');
    const bg = type === 'success' ? '#22c55e' : type === 'warning' ? '#f59e0b' : type === 'info' ? '#3b82f6' : '#ef4444';
    t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:${bg};color:#fff;padding:10px 20px;border-radius:10px;font-family:'DM Sans',sans-serif;
    font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2);
    animation:fadeInUp .25s ease;pointer-events:none;`;
    t.textContent = msg;
    document.body.appendChild(t);
    if (duration > 0) setTimeout(() => t.remove(), duration);
    return t;
}


// ─── Traffic polling ──────────────────────────────────────
async function fetchTraffic() {
    try {
        const tok = localStorage.getItem('token');
        const hdr = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
        if (tok && tok !== 'null') hdr['Authorization'] = 'Bearer ' + tok;
        const r = await fetch('/api/mikrotik/customer-traffic', { headers: hdr, credentials: 'include' });
        if (!r.ok) {
            console.warn('[Traffic] HTTP', r.status, r.statusText);
            return;
        }
        const data = await r.json();
        if (!data?.success) {
            console.warn('[Traffic] API error:', data?.message);
            return;
        }
        trafficData = {};
        data.data.forEach(d => { trafficData[d.id] = d; });
        updateMarkerTraffic();
        // Push ke ring buffer untuk chart real-time
        const now = Date.now();
        data.data.forEach(d => {
            if (!trafficHistory[d.id]) trafficHistory[d.id] = [];
            trafficHistory[d.id].push({ rx: (d.rateDown || 0) / 1e6, tx: (d.rateUp || 0) / 1e6, t: now });
            if (trafficHistory[d.id].length > 60) trafficHistory[d.id].shift();
        });
        // Update chart jika popup terbuka
        updateOpenPopupChart();
        updateOnlineStats(data.meta?.online || 0);
        // Refresh open popup by directly updating DOM elements (no re-render needed)
        refreshOpenPopup();
        const meta = data.meta || {};
        console.log('[Traffic] OK — total:', meta.total, 'online:', meta.online,
            'withQueue:', meta.withQueue, 'pppoe:', meta.pppoeActive);
        // Warn if no customers have IP/PPPoE configured
        if (meta.withQueue === 0 && meta.total > 0 && !window._trafficWarnShown) {
            window._trafficWarnShown = true;
            showToast('⚠ Traffic: Isi field IP Statis atau Username PPPoE di data pelanggan agar terbaca', 'warning');
        }
    } catch (e) {
        console.warn('[Traffic] fetch error:', e.message);
    }
}

function startTrafficPolling() {
    if (trafficTimer) clearInterval(trafficTimer);
    fetchTraffic();
    trafficTimer = setInterval(fetchTraffic, POLL_MS);
}

function stopTrafficPolling() {
    if (trafficTimer) { clearInterval(trafficTimer); trafficTimer = null; }
}

// Streak counter per customer — persist di luar marker agar tidak reset
const _onlineStreak = {}; // custId → consecutive online count
const _offlineStreak = {}; // custId → consecutive offline count
const CONFIRM_ONLINE = 2;  // butuh 2x berturut (~4 detik) sebelum jadi hijau
const CONFIRM_OFFLINE = 8;  // butuh 8x berturut (~16 detik) sebelum jadi merah

function updateMarkerTraffic() {
    markers.forEach(m => {
        if (!m._custData || !m._makePinIcon) return;
        const id = m._custData.id;
        const td = trafficData[id];
        if (!td) return;

        if (td.online === true) {
            _onlineStreak[id] = (_onlineStreak[id] || 0) + 1;
            _offlineStreak[id] = 0;
            // Hijau setelah CONFIRM_ONLINE poll berturut-turut (debounce)
            if (_onlineStreak[id] >= CONFIRM_ONLINE && m._onlineStatus !== true) {
                m.setIcon(m._makePinIcon(true));
                m._onlineStatus = true;
            }
        } else {
            _offlineStreak[id] = (_offlineStreak[id] || 0) + 1;
            _onlineStreak[id] = 0;
            // Merah hanya setelah CONFIRM_OFFLINE poll berturut-turut
            if (_offlineStreak[id] >= CONFIRM_OFFLINE && m._onlineStatus !== false) {
                m.setIcon(m._makePinIcon(false));
                m._onlineStatus = false;
            }
        }
        m._trafficData = td;
    });
}

function updateOnlineStats(online) {
    const el = document.getElementById('st-online');
    if (el) el.textContent = online;
}


// ─── Refresh open popup DOM directly ─────────────────────
function refreshOpenPopup() {
    // Find the marker whose popup is currently open
    const m = markers.find(mk => mk._custData && mk._popup && mk._popup.isOpen());
    if (!m) return;
    const td = trafficData[m._custData.id];
    if (!td) return;

    const fR = bps => {
        if (!bps || bps === 0) return '0 bps';
        if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps';
        if (bps >= 1000) return (bps / 1000).toFixed(0) + ' Kbps';
        return bps + ' bps';
    };
    const pct2bar = (pct, el) => {
        if (!el) return;
        pct = Math.min(100, pct || 0);
        el.style.width = pct + '%';
        el.style.background = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
    };

    const popup = document.querySelector('.leaflet-popup-content .cp-popup');
    if (!popup) return;

    // Status Online row
    const statusEl = popup.querySelector('[data-live="status"]');
    if (statusEl) {
        // Pakai _onlineStatus dari marker sebagai sumber kebenaran (sudah di-debounce)
        const activeMarker = markers.find(mk => mk._custData && mk._popup && mk._popup.isOpen());
        const stableOnline = activeMarker?._onlineStatus ?? td.online;

        const dot = stableOnline
            ? '<span style="display:inline-block;width:8px;height:8px;background:#22c55e;border-radius:50%;margin-right:4px;box-shadow:0 0 5px rgba(34,197,94,.8)"></span>'
            : '<span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:50%;margin-right:4px"></span>';
        const srcLabel = td.onlineSource
            ? { 'pppoe': 'PPPoE', 'arp': 'ARP', 'dhcp': 'DHCP', 'queue': 'Queue' }[td.onlineSource] || td.onlineSource
            : '';
        const srcBadge = stableOnline && srcLabel
            ? '<span style="background:#e6fff7;color:#065f46;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:4px;text-transform:uppercase">' + srcLabel + '</span>'
            : '';
        statusEl.innerHTML = dot + (stableOnline
            ? '<span style="color:#16a34a;font-weight:700">ONLINE</span>' + srcBadge + (td.uptime ? '<span style="color:#8899b0;font-size:10px"> (' + td.uptime + ')</span>' : '')
            : '<span style="color:#ef4444;font-weight:700">OFFLINE</span>');
    }

    // Download rate
    const dlEl = popup.querySelector('[data-live="dl-rate"]');
    if (dlEl) dlEl.textContent = fR(td.rateDown);
    pct2bar(td.utilDown, popup.querySelector('[data-live="dl-bar"]'));

    // Upload rate
    const ulEl = popup.querySelector('[data-live="ul-rate"]');
    if (ulEl) ulEl.textContent = fR(td.rateUp);
    pct2bar(td.utilUp, popup.querySelector('[data-live="ul-bar"]'));
}


// ─── Customer Traffic Chart ───────────────────────────────
// custId yang sedang popup terbuka (untuk auto-update chart)
let openPopupCustId = null;
const custChartRange = {}; // custId → 'rt'|'1h'|'6h'|'24h'|'7d'

// ─── RX Power ONT per Customer ───────────────────────────
async function fetchCustRxPower(custId) {
    console.log('[RX] fetching for custId:', custId);
    // Retry sampai element ada di DOM (max 5x)
    let valEl = document.getElementById(`rx-val-${custId}`);
    console.log('[RX] element found immediately:', !!valEl);
    if (!valEl) {
        let attempts = 0;
        await new Promise(resolve => {
            const check = setInterval(() => {
                valEl = document.getElementById(`rx-val-${custId}`);
                attempts++;
                console.log(`[RX] attempt ${attempts}, found:`, !!valEl);
                if (valEl || attempts >= 10) { clearInterval(check); resolve(); }
            }, 100);
        });
    }
    if (!valEl) { console.warn('[RX] element not found after retries'); return; }

    try {
        const r = await fetch(`/api/infrastructure/customer/${custId}/rx-power`);
        const j = await r.json();

        if (!j.success || !j.data?.rx_power) {
            valEl.innerHTML = `<span style="color:#94a3b8;font-size:11px">${j.error || 'Tidak tersedia'}</span>`;
            return;
        }

        const rx = parseFloat(j.data.rx_power);

        // Warna berdasarkan kualitas sinyal
        let color = '#16a34a', quality = 'Bagus';
        if (rx < -27) { color = '#ef4444'; quality = 'Kritis'; }
        else if (rx < -25) { color = '#f59e0b'; quality = 'Lemah'; }

        // 5-bar signal indicator
        const bars = [1, 2, 3, 4, 5].map(i => {
            const active = rx >= -27 + (i * 1.5);
            return `<span style="width:3px;height:${4 + i * 3}px;border-radius:1px;background:${active ? color : '#e2e8f0'};display:block"></span>`;
        }).join('');

        // Suhu badge jika ada
        const tmpBadge = j.data.temperature
            ? `<span style="font-size:10px;color:#64748b;background:#f1f5f9;padding:1px 6px;border-radius:4px;margin-left:4px">${j.data.temperature}°C</span>`
            : '';

        valEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px">
        <div style="display:flex;align-items:flex-end;gap:1px">${bars}</div>
        <span style="font-family:monospace;font-weight:700;color:${color};font-size:12px">${rx.toFixed(2)} dBm</span>
        <span style="font-size:10px;color:${color};background:${color}18;padding:1px 6px;border-radius:4px;font-weight:600;border:none;outline:none;box-shadow:none">${quality}</span>
        ${tmpBadge}
      </div>`;
    } catch (e) {
        if (valEl) valEl.innerHTML = `<span style="color:#94a3b8;font-size:11px">Error</span>`;
    }
}

function loadCustChart(custId) {
    openPopupCustId = custId;
    if (!custChartRange[custId]) custChartRange[custId] = 'rt';
    renderCustChart(custId);
}

function setCustRange(custId, range, btnEl) {
    custChartRange[custId] = range;
    openPopupCustId = custId;

    // Update tab styling
    if (btnEl) {
        const tabs = btnEl.parentElement;
        if (tabs) tabs.querySelectorAll('button').forEach(b => {
            b.style.background = '#f8fafc'; b.style.color = '#64748b';
            b.style.borderColor = '#e2e8f0'; b.style.fontWeight = '600';
        });
        btnEl.style.background = '#1d4ed8'; btnEl.style.color = '#fff';
        btnEl.style.borderColor = '#1d4ed8'; btnEl.style.fontWeight = '700';
    }

    if (range === 'rt') {
        renderCustChart(custId);
    } else {
        fetchCustHistory(custId, range);
    }
}

function renderCustChart(custId) {
    const range = custChartRange[custId] || 'rt';
    if (range !== 'rt') return; // non-rt dihandle fetchCustHistory

    const canvas = document.getElementById('chart-cust-' + custId);
    const note = document.getElementById('chart-cust-' + custId + '-note');
    if (!canvas) return;

    const hist = trafficHistory[custId] || [];
    if (hist.length === 0) {
        drawEmptyChart(canvas, 'Menunggu data traffic...');
        if (note) note.textContent = 'Polling setiap 2 detik';
        return;
    }

    const chartData = hist.map(h => ({ rx_mbps: h.rx, tx_mbps: h.tx }));
    drawTrafficChart(canvas, chartData);

    const td = trafficData[custId] || {};
    const fmt = v => !v ? '0' : v >= 1 ? v.toFixed(1) + ' Mbps' : (v * 1000).toFixed(0) + ' Kbps';
    if (note) note.textContent = `Live · ↓${fmt((td.rateDown || 0) / 1e6)} ↑${fmt((td.rateUp || 0) / 1e6)} · `;
}

function updateOpenPopupChart() {
    if (!openPopupCustId) return;
    const range = custChartRange[openPopupCustId] || 'rt';
    if (range === 'rt') renderCustChart(openPopupCustId);
}

async function fetchCustHistory(custId, range) {
    const canvas = document.getElementById('chart-cust-' + custId);
    const note = document.getElementById('chart-cust-' + custId + '-note');
    if (!canvas) return;

    const td = trafficData[custId] || {};
    const queueName = td.queueName;
    if (!queueName) {
        drawEmptyChart(canvas, 'Tidak ada queue — aktifkan traffic monitoring');
        if (note) note.textContent = 'Tidak ada queue';
        return;
    }

    if (note) note.textContent = 'Memuat...';
    drawEmptyChart(canvas, 'Memuat data...');

    try {
        const tok = localStorage.getItem('token');
        const hdr = { 'X-Requested-With': 'XMLHttpRequest' };
        if (tok && tok !== 'null') hdr['Authorization'] = 'Bearer ' + tok;
        const url = `/api/mikrotik/customer-history?queueName=${encodeURIComponent(queueName)}&range=${range}`;
        const res = await fetch(url, { headers: hdr, credentials: 'include' });
        const data = await res.json();

        // Cek range masih aktif (user belum ganti tab)
        if (custChartRange[custId] !== range) return;

        if (!data.success || !data.data || data.data.length === 0) {
            drawEmptyChart(canvas, 'Belum ada data history untuk ' + range);
            if (note) note.textContent = 'Tidak ada data · ' + range;
            return;
        }

        drawTrafficChart(canvas, data.data);
        const maxDl = Math.max(...data.data.map(d => d.rx_mbps));
        const maxUl = Math.max(...data.data.map(d => d.tx_mbps));
        const fmtM = v => v >= 1 ? v.toFixed(1) + ' Mbps' : (v * 1000).toFixed(0) + ' Kbps';
        if (note) note.textContent = `${range} · ↓${fmtM(maxDl)} ↑${fmtM(maxUl)} peak · ${data.data.length} titik`;
    } catch (e) {
        drawEmptyChart(canvas, 'Gagal memuat: ' + e.message);
        if (note) note.textContent = 'Error';
    }
}

function drawTrafficChart(canvas, data) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const pad = { t: 14, b: 4, l: 38, r: 8 };
    const cW = W - pad.l - pad.r;
    const cH = H - pad.t - pad.b;

    ctx.clearRect(0, 0, W, H);
    // Light background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    if (!data || data.length < 2) { drawEmptyChart(canvas); return; }

    const maxVal = Math.max(...data.map(d => Math.max(d.rx_mbps, d.tx_mbps)), 0.01);
    const n = data.length;
    const step = cW / Math.max(n - 1, 1);

    // Format Mbps label
    const fmtMbps = v => v >= 1 ? v.toFixed(1) + 'M' : (v * 1000).toFixed(0) + 'K';

    // Grid lines + Y labels
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.8;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 3; i++) {
        const y = pad.t + (cH / 3) * i;
        const val = maxVal * (1 - i / 3);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cW, y); ctx.stroke();
        if (i < 3) ctx.fillText(fmtMbps(val), pad.l - 3, y + 3);
    }

    // Draw smooth area + line
    const drawArea = (key, color, fillColor) => {
        if (n < 2) return;
        const pts = data.map((d, i) => ({
            x: pad.l + i * step,
            y: pad.t + cH - Math.min(1, d[key] / maxVal) * cH
        }));

        // Area fill
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pad.t + cH);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(pts[pts.length - 1].x, pad.t + cH);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        // Smooth line
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            const cpx = (pts[i - 1].x + pts[i].x) / 2;
            ctx.bezierCurveTo(cpx, pts[i - 1].y, cpx, pts[i].y, pts[i].x, pts[i].y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round';
        ctx.stroke();
    };

    drawArea('tx_mbps', '#f97316', 'rgba(249,115,22,0.12)');
    drawArea('rx_mbps', '#2563eb', 'rgba(37,99,235,0.15)');

    // Peak label top-right
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('↓' + fmtMbps(Math.max(...data.map(d => d.rx_mbps))), W - pad.r, 10);
}

function drawEmptyChart(canvas, msg) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg || 'Tidak ada data history', W / 2, H / 2 + 4);
}

// ─── Remove customer marker from map only (keep DB) ──────
async function removeMarkerFromMap(custId) {
    if (!confirm('Hapus marker dari peta? Data pelanggan tidak akan terhapus.')) return;
    try {
        // Clear lat/lng on customer record so it won't appear on map
        const tok = localStorage.getItem('token');
        const hdr = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
        if (tok && tok !== 'null') hdr['Authorization'] = 'Bearer ' + tok;
        await fetch('/api/customers/' + custId, {
            method: 'PUT', headers: hdr, credentials: 'include',
            body: JSON.stringify({ latitude: null, longitude: null })
        });
        // Also remove infra point for this customer
        const infraPt = Object.values(allInfraPoints).find(pt => {
            if (pt.type !== 'customer' || !pt.metadata) return false;
            try { const m = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata) : pt.metadata; return m.customer_id === custId; } catch (e) { return false; }
        });
        if (infraPt) await fetch('/api/infrastructure/' + infraPt.id, { method: 'DELETE', headers: hdr, credentials: 'include' });
        map.closePopup();
        showToast('Marker dihapus dari peta', 'success');
        loadInfraData();
    } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

// ─── Clear all ────────────────────────────────────────
function clearAll() {
    clearFlowPackets();
    markers.forEach(m => {
        if (m._flowInterval) clearInterval(m._flowInterval);
        try { map.removeLayer(m); } catch (e) { }
    });
    polylines.forEach(p => { try { map.removeLayer(p); } catch (e) { } });
    markers = []; polylines = []; allInfraPoints = {};
}

// ─── Place mode ───────────────────────────────────────
function openAddModal() {
    editId = null;
    pendingLat = null; pendingLng = null;
    resetForm();
    // Step 1: pick location first (modal closed, crosshair active)
    const defaultTab = 'odc';
    placeType = defaultTab;
    placeMode = true;
    document.getElementById('infraMap').classList.add('place-mode');
    const bar = document.getElementById('placeModeBar');
    bar.classList.add('active');
    document.getElementById('placeModeText').textContent = 'Klik peta untuk menempatkan titik';
    // After map click, _onPlacePick() will open the modal
    _pendingOpenModal = true;
}

let _pendingOpenModal = false;

function _openModalAfterPick() {
    _pendingOpenModal = false;
    editId = null;
    const titleEl = document.getElementById('modalTitle'); if (titleEl) titleEl.textContent = 'Tambah Titik Infrastruktur';
    const saveBtn = document.getElementById('saveBtn'); if (saveBtn) saveBtn.textContent = 'Simpan';
    const tabsEl = document.getElementById('modalTabs'); if (tabsEl) tabsEl.style.display = 'flex';
    const defaultTab = placeType || 'odc';
    const infraModal = document.getElementById('infraModal');
    if (infraModal) {
        infraModal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        infraModal.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        infraModal.querySelector('.modal-tab[data-tab="' + defaultTab + '"]')?.classList.add('active');
        infraModal.classList.add('active');
    } else {
        App.showToast('Form modal penambahan titik infrastruktur belum tersedia di template', 'warning');
    }
    const tp = document.getElementById('tab-' + defaultTab); if (tp) tp.classList.add('active');
    updateCoordPreview(pendingLat, pendingLng);
    loadParentSelects();
    // Show "Ubah Lokasi" button
    const rpBtn = document.getElementById('rePickBtn');
    if (rpBtn) rpBtn.style.display = 'inline-flex';
}

function enterPlaceMode(type) {
    placeMode = true; placeType = type;
    document.getElementById('infraMap').classList.add('place-mode');
    const names = { odc: 'ODC', odp: 'ODP', tower: 'Tiang', customer: 'Pelanggan' };
    document.getElementById('placeModeText').textContent = `Klik peta untuk menempatkan ${names[type] || type}`;
    document.getElementById('placeModeBar').classList.add('active');
}
function cancelPlaceMode() { exitPlaceMode(); }
function exitPlaceMode() {
    placeMode = false;
    document.getElementById('infraMap').classList.remove('place-mode');
    document.getElementById('placeModeBar').classList.remove('active');
}

// ─── Modal (Add/Edit titik) ───────────────────────────
function openInfraModal(tabType) {
    editId = null;
    document.getElementById('modalTitle').textContent = 'Tambah Titik Infrastruktur';
    document.getElementById('saveBtn').textContent = 'Simpan';
    document.getElementById('modalTabs').style.display = 'flex';
    resetForm();
    switchTab(tabType || 'odc', document.querySelector(`.modal-tab[data-tab="${tabType || 'odc'}"]`));
    updateCoordPreview(pendingLat, pendingLng);
    document.getElementById('infraModal').classList.add('active');
    loadParentSelects();
}

function closeModal() {
    document.getElementById('infraModal').classList.remove('active');
    editId = null; pendingLat = null; pendingLng = null; selectedCustomerId = null;
    _pendingOpenModal = false; exitPlaceMode();
}

function switchTab(tab, btn) {
    const infraModal = document.getElementById('infraModal');
    infraModal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    infraModal.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    else { const tb = infraModal.querySelector('.modal-tab[data-tab="' + tab + '"]'); if (tb) tb.classList.add('active'); }
    const tp = document.getElementById('tab-' + tab); if (tp) tp.classList.add('active');
    // Update placeType when tab changes
    placeType = tab;
    const names = { odc: 'ODC', odp: 'ODP', tower: 'Tiang', customer: 'Pelanggan' };
    const bar = document.getElementById('placeModeText');
    if (bar) bar.textContent = 'Klik peta untuk menempatkan ' + (names[tab] || tab);
    // If modal is open for new point, allow re-picking location
    if (!editId) {
        const btn = document.getElementById('rePickBtn');
        if (btn) btn.style.display = 'inline-flex';
    }
}

function resetForm() {
    ['odc-name', 'odc-address', 'odc-notes', 'odp-name', 'odp-address', 'odp-notes',
        'tower-name', 'tower-address', 'tower-notes', 'cust-address', 'cust-notes'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
    ['odc-capacity', 'odc-used', 'odp-capacity', 'odp-used'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    ['odc-status', 'odp-status', 'tower-status'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = 'active';
    });
    const cs = document.getElementById('cust-search'); if (cs) cs.value = '';
    // Reset manual coord panel
    const manualWrap = document.getElementById('coordManualWrap');
    if (manualWrap) manualWrap.style.display = 'none';
    const manualToggle = document.getElementById('coordManualToggle');
    if (manualToggle) { manualToggle.style.background = 'var(--bg-card)'; manualToggle.style.color = 'var(--text-secondary)'; manualToggle.style.borderColor = 'var(--border)'; }
    const mLat = document.getElementById('manualLat'); if (mLat) mLat.value = '';
    const mLng = document.getElementById('manualLng'); if (mLng) mLng.value = '';
    const paste = document.getElementById('pasteCoord'); if (paste) paste.value = '';
    // Reset foto ODP
    const photoUrl = document.getElementById('odp-photo-url'); if (photoUrl) { photoUrl.value = ''; photoUrl.dataset.existMeta = ''; }
    const photoPrev = document.getElementById('odp-photo-preview'); if (photoPrev) { photoPrev.src = ''; photoPrev.style.display = 'none'; }
    const photoInput = document.getElementById('odp-photo-input'); if (photoInput) photoInput.value = '';
    const photoRemove = document.getElementById('odp-photo-remove'); if (photoRemove) photoRemove.style.display = 'none';
    // Reset ODC photo
    const odcPhotoUrl = document.getElementById('odc-photo-url'); if (odcPhotoUrl) { odcPhotoUrl.value = ''; odcPhotoUrl.dataset.existMeta = ''; }
    const odcPhotoPrev = document.getElementById('odc-photo-preview'); if (odcPhotoPrev) { odcPhotoPrev.src = ''; odcPhotoPrev.style.display = 'none'; }
    const odcPhotoInput = document.getElementById('odc-photo-input'); if (odcPhotoInput) odcPhotoInput.value = '';
    const odcPhotoRemove = document.getElementById('odc-photo-remove'); if (odcPhotoRemove) odcPhotoRemove.style.display = 'none';
    const custSel = document.getElementById('custSelected'); if (custSel) custSel.style.display = 'none';
    const custDrop = document.getElementById('custDropdown'); if (custDrop) custDrop.classList.remove('open');
    selectedCustomerId = null;
}

function updateCoordPreview(lat, lng) {
    const el = document.getElementById('coordPreview');
    const dot = document.getElementById('coordDot');
    if (lat !== null && lng !== null) {
        if (el) el.innerHTML = `<span style="font-family:monospace;font-size:12px;color:var(--text-primary)"><strong>${(+lat).toFixed(6)}</strong>, <strong>${(+lng).toFixed(6)}</strong></span>`;
        if (dot) dot.style.background = '#22c55e';
        // Sync manual inputs jika terbuka
        const mLat = document.getElementById('manualLat');
        const mLng = document.getElementById('manualLng');
        if (mLat && !mLat.matches(':focus')) mLat.value = (+lat).toFixed(6);
        if (mLng && !mLng.matches(':focus')) mLng.value = (+lng).toFixed(6);
    } else {
        el.innerHTML = `<span style="font-size:12px;color:var(--text-secondary)">Belum dipilih — klik <em>Pilih di Peta</em> atau input manual</span>`;
        if (dot) dot.style.background = '#e2e8f0';
    }
}

function toggleManualCoord() {
    const wrap = document.getElementById('coordManualWrap');
    const btn = document.getElementById('coordManualToggle');
    if (!wrap) return;
    const isOpen = wrap.style.display !== 'none';
    wrap.style.display = isOpen ? 'none' : 'block';
    btn.style.background = isOpen ? 'var(--bg-card)' : '#eff6ff';
    btn.style.color = isOpen ? 'var(--text-secondary)' : 'var(--primary)';
    btn.style.borderColor = isOpen ? 'var(--border)' : 'var(--primary)';
    // Isi field jika ada koordinat
    if (!isOpen && pendingLat !== null) {
        document.getElementById('manualLat').value = (+pendingLat).toFixed(6);
        document.getElementById('manualLng').value = (+pendingLng).toFixed(6);
    }
}

function applyManualCoord() {
    const lat = parseFloat(document.getElementById('manualLat')?.value);
    const lng = parseFloat(document.getElementById('manualLng')?.value);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        pendingLat = lat; pendingLng = lng;
        updateCoordPreview(lat, lng);
        // Pan peta ke koordinat tersebut
        map.setView([lat, lng], map.getZoom());
    }
}

function parseCoordPaste() {
    const raw = document.getElementById('pasteCoord')?.value?.trim() || '';
    // Coba beberapa format:
    // 1. "-6.391581, 106.457346"
    // 2. "-6.391581 106.457346"
    // 3. Google Maps URL "?q=-6.391581,106.457346"
    // 4. "@-6.391,106.457" (Google Maps URL format)
    let lat, lng;
    const urlMatch = raw.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || raw.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (urlMatch) {
        lat = parseFloat(urlMatch[1]); lng = parseFloat(urlMatch[2]);
    } else {
        const parts = raw.split(/[\s,;]+/).filter(Boolean);
        if (parts.length >= 2) { lat = parseFloat(parts[0]); lng = parseFloat(parts[1]); }
    }
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        pendingLat = lat; pendingLng = lng;
        document.getElementById('manualLat').value = lat.toFixed(6);
        document.getElementById('manualLng').value = lng.toFixed(6);
        document.getElementById('pasteCoord').value = '';
        updateCoordPreview(lat, lng);
        map.setView([lat, lng], Math.max(map.getZoom(), 16));
        document.getElementById('pasteCoord').style.borderColor = '#22c55e';
        setTimeout(() => { const el = document.getElementById('pasteCoord'); if (el) el.style.borderColor = ''; }, 1500);
    } else {
        const el = document.getElementById('pasteCoord');
        if (el) { el.style.borderColor = '#ef4444'; setTimeout(() => el.style.borderColor = '', 1500); }
    }
}

async function loadParentSelects() {
    const [odcRes, odpRes] = await Promise.all([App.api('/infrastructure?type=odc'), App.api('/infrastructure?type=odp')]);
    const odcList = odcRes?.success ? odcRes.data : [];
    const odpList = odpRes?.success ? odpRes.data : [];
    const odpSel = document.getElementById('odp-parent');
    const custSel = document.getElementById('cust-parent');
    if (odpSel) { odpSel.innerHTML = '<option value="">-- Tidak ada --</option>'; odcList.forEach(o => odpSel.innerHTML += `<option value="${o.id}">${o.name}</option>`); }
    if (custSel) { custSel.innerHTML = '<option value="">-- Tidak ada --</option>'; odpList.forEach(o => custSel.innerHTML += `<option value="${o.id}">${o.name}</option>`); }
}

async function loadAllCustomers() {
    const res = await App.api('/customers?limit=500');
    if (res?.success) allCustomers = Array.isArray(res.data) ? res.data : (res.data?.rows || []);
}

function searchCustomer(query) {
    const dd = document.getElementById('custDropdown');
    if (!query) { dd.classList.remove('open'); return; }
    const q = query.toLowerCase();
    const filtered = allCustomers.filter(c => c.name.toLowerCase().includes(q) || c.customer_id.toLowerCase().includes(q)).slice(0, 10);
    dd.innerHTML = filtered.length === 0
        ? '<div class="cust-item" style="color:var(--text-secondary)">Tidak ditemukan</div>'
        : filtered.map(c => `<div class="cust-item" onclick="selectCustomer(${c.id},'${c.name.replace(/'/g, "\\'")}','${c.customer_id}','${(c.address || '').replace(/'/g, "\\'")}','${c.package?.name || '-'}')"><strong>${c.name}</strong><span>${c.customer_id} · ${c.package?.name || '—'} · <span style="color:${c.status === 'active' ? '#22c55e' : '#ef4444'}">${c.status}</span></span></div>`).join('');
    dd.classList.add('open');
}

function selectCustomer(id, name, custId, address, pkg) {
    selectedCustomerId = id;
    document.getElementById('cust-search').value = name;
    document.getElementById('custDropdown').classList.remove('open');
    document.getElementById('custSelected').style.display = 'block';
    document.getElementById('custSelName').textContent = name;
    document.getElementById('custSelDetail').textContent = `${custId} · ${pkg}`;
    if (!document.getElementById('cust-address').value) document.getElementById('cust-address').value = address;
}

document.addEventListener('click', e => { if (!e.target.closest('.customer-search-wrap')) document.getElementById('custDropdown')?.classList.remove('open'); });

// ─── Save titik ───────────────────────────────────────
async function savePoint() {
    if (pendingLat === null || pendingLng === null) {
        const infraModal2 = document.getElementById('infraModal');
        const activeTab2 = (infraModal2.querySelector('.modal-tab.active') || { dataset: { tab: 'odc' } }).dataset.tab;
        showToast('Klik peta untuk memilih koordinat lokasi', 'warning');
        enterPlaceMode(activeTab2);
        return;
    }

    // Scope selector ke dalam #infraModal agar tidak terpengaruh elemen lain
    const infraModal = document.getElementById('infraModal');
    const activeTabBtn = infraModal.querySelector('.modal-tab.active');
    const tab = activeTabBtn?.dataset.tab;

    if (!tab) { alert('Pilih tipe titik (ODC/ODP/Tiang/Pelanggan)'); return; }

    let payload = { latitude: pendingLat, longitude: pendingLng };
    if (tab === 'odc') {
        const name = document.getElementById('odc-name').value.trim(); if (!name) return alert('Nama ODC wajib');
        const odcPhotoUrl = document.getElementById('odc-photo-url')?.value || '';
        const odcPhotoFile = document.getElementById('odc-photo-input')?.files[0];
        let finalOdcPhotoUrl = odcPhotoUrl;
        if (odcPhotoFile) { try { finalOdcPhotoUrl = await uploadOdcPhoto(odcPhotoFile); } catch (e) { } }
        const odcExistMeta = (() => { try { const el = document.getElementById('odc-photo-url'); return el?.dataset?.existMeta ? JSON.parse(el.dataset.existMeta) : {}; } catch (e) { return {}; } })();
        const odcNewMeta = finalOdcPhotoUrl ? { ...odcExistMeta, photo_url: finalOdcPhotoUrl } : (odcPhotoUrl === '' && !finalOdcPhotoUrl ? { ...odcExistMeta, photo_url: undefined } : odcExistMeta);
        if (odcNewMeta.photo_url === undefined) delete odcNewMeta.photo_url;
        payload = { ...payload, type: 'odc', name, capacity: parseInt(document.getElementById('odc-capacity').value) || null, used_ports: parseInt(document.getElementById('odc-used').value) || 0, address: document.getElementById('odc-address').value, status: document.getElementById('odc-status').value, notes: document.getElementById('odc-notes').value, metadata: Object.keys(odcNewMeta).length ? odcNewMeta : null };
    } else if (tab === 'odp') {
        const name = document.getElementById('odp-name').value.trim(); if (!name) return alert('Nama ODP wajib');
        const pid = document.getElementById('odp-parent').value;
        const photoUrl = document.getElementById('odp-photo-url')?.value || '';
        // Upload foto dulu jika ada file baru dipilih
        const photoFile = document.getElementById('odp-photo-input')?.files[0];
        let finalPhotoUrl = photoUrl;
        if (photoFile) { try { finalPhotoUrl = await uploadOdpPhoto(photoFile); } catch (e) { } }
        const existMeta = (() => { try { const el = document.getElementById('odp-photo-url'); return el?.dataset?.existMeta ? JSON.parse(el.dataset.existMeta) : {}; } catch (e) { return {}; } })();
        const newMeta = finalPhotoUrl ? { ...existMeta, photo_url: finalPhotoUrl } : (photoUrl === '' && !finalPhotoUrl ? { ...existMeta, photo_url: undefined } : existMeta);
        if (newMeta.photo_url === undefined) delete newMeta.photo_url;
        payload = { ...payload, type: 'odp', name, capacity: parseInt(document.getElementById('odp-capacity').value) || null, used_ports: parseInt(document.getElementById('odp-used').value) || 0, parent_id: pid ? parseInt(pid) : null, address: document.getElementById('odp-address').value, status: document.getElementById('odp-status').value, notes: document.getElementById('odp-notes').value, metadata: Object.keys(newMeta).length ? newMeta : null };
    } else if (tab === 'tower') {
        const name = document.getElementById('tower-name').value.trim(); if (!name) return alert('Nama Tiang wajib');
        payload = { ...payload, type: 'tower', name, address: document.getElementById('tower-address').value, status: document.getElementById('tower-status').value, notes: document.getElementById('tower-notes').value };
    } else if (tab === 'customer') {
        if (!selectedCustomerId) return alert('Pilih pelanggan');
        const pid = document.getElementById('cust-parent').value;
        const co = allCustomers.find(c => c.id === selectedCustomerId);
        payload = { ...payload, type: 'customer', name: co ? co.name : 'Pelanggan', address: document.getElementById('cust-address').value || co?.address, parent_id: pid ? parseInt(pid) : null, notes: document.getElementById('cust-notes').value, metadata: { customer_id: selectedCustomerId } };
        await App.api(`/customers/${selectedCustomerId}`, { method: 'PUT', body: JSON.stringify({ latitude: pendingLat, longitude: pendingLng }) });
    }
    const btn = document.getElementById('saveBtn'); btn.textContent = 'Menyimpan...'; btn.disabled = true;
    try {
        const res = editId
            ? await App.api(`/infrastructure/${editId}`, { method: 'PUT', body: JSON.stringify(payload) })
            : await App.api('/infrastructure', { method: 'POST', body: JSON.stringify(payload) });
        if (res?.success) { closeModal(); loadInfraData(); }
        else alert('Gagal: ' + (res?.message || 'Error'));
    } finally { btn.textContent = 'Simpan'; btn.disabled = false; }
}

// ─── Edit titik ───────────────────────────────────────
async function editPoint(id) {
    const res = await App.api(`/infrastructure/${id}`); if (!res?.success) return;
    const pt = res.data; editId = id;
    pendingLat = +pt.latitude; pendingLng = +pt.longitude;
    const tab = { odc: 'odc', odp: 'odp', tower: 'tower', customer: 'customer' }[pt.type] || 'odc';
    document.getElementById('modalTitle').textContent = `Edit ${pt.type === 'tower' ? 'Tiang' : pt.type.toUpperCase()}`;
    document.getElementById('saveBtn').textContent = 'Update';
    resetForm();
    switchTab(tab, document.querySelector(`.modal-tab[data-tab="${tab}"]`));
    updateCoordPreview(pendingLat, pendingLng);
    await loadParentSelects();
    if (tab === 'odc') {
        document.getElementById('odc-name').value = pt.name; document.getElementById('odc-capacity').value = pt.capacity || '';
        document.getElementById('odc-used').value = pt.used_ports || 0; document.getElementById('odc-address').value = pt.address || '';
        document.getElementById('odc-status').value = pt.status; document.getElementById('odc-notes').value = pt.notes || '';
        try {
            const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata || '{}') : pt.metadata || {};
            const urlEl = document.getElementById('odc-photo-url');
            if (urlEl) { urlEl.value = meta.photo_url || ''; urlEl.dataset.existMeta = JSON.stringify(meta); }
            const prev = document.getElementById('odc-photo-preview');
            const remBtn = document.getElementById('odc-photo-remove');
            if (meta.photo_url) { prev.src = meta.photo_url; prev.style.display = 'block'; if (remBtn) remBtn.style.display = 'inline-block'; }
            else { if (prev) prev.style.display = 'none'; if (remBtn) remBtn.style.display = 'none'; }
        } catch (e) { }
    } else if (tab === 'odp') {
        document.getElementById('odp-name').value = pt.name; document.getElementById('odp-capacity').value = pt.capacity || '';
        document.getElementById('odp-used').value = pt.used_ports || 0; document.getElementById('odp-address').value = pt.address || '';
        document.getElementById('odp-status').value = pt.status; document.getElementById('odp-notes').value = pt.notes || '';
        if (pt.parent_id) document.getElementById('odp-parent').value = pt.parent_id;
        // Load foto dari metadata
        try {
            const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata || '{}') : pt.metadata || {};
            const urlEl = document.getElementById('odp-photo-url');
            if (urlEl) { urlEl.value = meta.photo_url || ''; urlEl.dataset.existMeta = JSON.stringify(meta); }
            const prev = document.getElementById('odp-photo-preview');
            const remBtn = document.getElementById('odp-photo-remove');
            if (meta.photo_url) { prev.src = meta.photo_url; prev.style.display = 'block'; if (remBtn) remBtn.style.display = 'inline-block'; }
            else { if (prev) prev.style.display = 'none'; if (remBtn) remBtn.style.display = 'none'; }
        } catch (e) { }
    } else if (tab === 'tower') {
        document.getElementById('tower-name').value = pt.name; document.getElementById('tower-address').value = pt.address || '';
        document.getElementById('tower-status').value = pt.status; document.getElementById('tower-notes').value = pt.notes || '';
    }
    document.getElementById('infraModal').classList.add('active');
}

// ─── Edit infra point milik customer ──────────────────
function editCustInfra(custId) {
    // Cari infra point bertipe 'customer' yang metadata-nya punya customer_id ini
    const infraPt = Object.values(allInfraPoints).find(pt => {
        if (pt.type !== 'customer' || !pt.metadata) return false;
        try {
            const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata) : pt.metadata;
            return meta.customer_id === custId;
        } catch (e) { return false; }
    });

    if (!infraPt) {
        showToast('Titik infrastruktur pelanggan ini belum ada di peta', 'warning');
        return;
    }

    map.closePopup();
    editPoint(infraPt.id);
}

// ─── Delete titik ─────────────────────────────────────
async function deletePoint(id, name) {
    if (!confirm(`Hapus "${name}"?`)) return;
    const res = await App.api(`/infrastructure/${id}`, { method: 'DELETE' });
    if (res?.success) { map.closePopup(); loadInfraData(); }
    else alert('Gagal: ' + (res?.message || 'Error'));
}

// ─── Navigation ───────────────────────────────────────
function openNavigation(lat, lng, name) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}

// ─── ODP Photo helpers ────────────────────────────────
// Event listener dipasang via JS (bukan onchange inline) agar lebih reliable


function removeOdpPhoto() {
    const prev = document.getElementById('odp-photo-preview');
    const urlEl = document.getElementById('odp-photo-url');
    const input = document.getElementById('odp-photo-input');
    const remBtn = document.getElementById('odp-photo-remove');
    const btn = document.getElementById('odp-upload-btn');
    if (prev) { prev.src = ''; prev.style.display = 'none'; }
    if (urlEl) { urlEl.value = ''; if (urlEl.dataset) urlEl.dataset.existMeta = ''; }
    if (input) { input.value = ''; }
    if (remBtn) { remBtn.style.display = 'none'; }
    if (btn) { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload Foto'; }
}

async function uploadOdpPhoto(file) {
    const btn = document.getElementById('odp-upload-btn');
    if (btn) btn.innerHTML = '⏳ Mengupload...';
    const form = new FormData();
    form.append('photo', file);
    const tok = localStorage.getItem('token');
    const hdr = {};
    if (tok && tok !== 'null') hdr['Authorization'] = 'Bearer ' + tok;
    try {
        const res = await fetch('/api/upload/infra-photo', { method: 'POST', headers: hdr, credentials: 'include', body: form });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Upload gagal');
        const urlEl = document.getElementById('odp-photo-url');
        if (urlEl) urlEl.value = data.url;
        // Update preview ke URL server
        const prev = document.getElementById('odp-photo-preview');
        if (prev) prev.src = data.url;
        if (btn) btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Terupload';
        return data.url;
    } catch (e) {
        if (btn) btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload Foto';
        throw e;
    }
}
// ─── ODC Photo helpers ────────────────────────────────
function removeOdcPhoto() {
    const prev = document.getElementById('odc-photo-preview');
    const urlEl = document.getElementById('odc-photo-url');
    const input = document.getElementById('odc-photo-input');
    const remBtn = document.getElementById('odc-photo-remove');
    const btn = document.getElementById('odc-upload-btn');
    if (prev) { prev.src = ''; prev.style.display = 'none'; }
    if (urlEl) { urlEl.value = ''; if (urlEl.dataset) urlEl.dataset.existMeta = ''; }
    if (input) { input.value = ''; }
    if (remBtn) { remBtn.style.display = 'none'; }
    if (btn) { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload Foto'; }
}

async function uploadOdcPhoto(file) {
    const btn = document.getElementById('odc-upload-btn');
    if (btn) btn.innerHTML = 'Mengupload...';
    const form = new FormData();
    form.append('photo', file);
    const tok = localStorage.getItem('token');
    const hdr = {};
    if (tok && tok !== 'null') hdr['Authorization'] = 'Bearer ' + tok;
    try {
        const res = await fetch('/api/upload/infra-photo', { method: 'POST', headers: hdr, credentials: 'include', body: form });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Upload gagal');
        const urlEl = document.getElementById('odc-photo-url');
        if (urlEl) urlEl.value = data.url;
        const prev = document.getElementById('odc-photo-preview');
        if (prev) prev.src = data.url;
        if (btn) btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Terupload';
        return data.url;
    } catch (e) {
        if (btn) btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload Foto';
        throw e;
    }
}

// ─── Customer marker ──────────────────────────────────────
function addCustomerMarker(cust) {
    const active = cust.status === 'active';
    const isolated = cust.status === 'isolated';

    function makePinIcon(online) {
        // online=true → hijau, online=false → merah, online=null (belum dicek) → biru
        const pinColor = online === true ? '#16a34a'   // ONLINE → hijau
            : online === false ? '#dc2626'   // OFFLINE → merah
                : (active ? '#1e3a8a' : (isolated ? '#ecc40e' : '#dc2626')); // unknown → biru (aktif) / amber (isolir) / merah (lainnya)
        // Dot hijau berpendar saat online
        const dot = online === true
            ? `<div style="position:absolute;top:-5px;right:-5px;width:13px;height:13px;background:#22c55e;border-radius:50%;border:2px solid #fff;box-shadow:0 0 7px rgba(34,197,94,.9);"></div>`
            : online === false
                ? `<div style="position:absolute;top:-5px;right:-5px;width:13px;height:13px;background:#ef4444;border-radius:50%;border:2px solid #fff;"></div>`
                : '';
        const ring = active
            ? `<div style="position:absolute;inset:-5px;border-radius:50%;border:2px solid ${pinColor};opacity:0;animation:custPulse 2.2s ease-out infinite;pointer-events:none;"></div>`
            : '';
        return L.divIcon({
            className: '',
            html: `<div style="position:relative;width:36px;height:42px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35));">
        <svg width="36" height="42" viewBox="0 0 36 42" fill="none">
          <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 24 18 24S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${pinColor}"/>
          <path d="M10 18.5L18 11l8 7.5" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 17v6a1 1 0 001 1h3v-3h4v3h3a1 1 0 001-1v-6" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${dot}${ring}
      </div>`,
            iconSize: [36, 42], iconAnchor: [18, 42]
        });
    }

    function buildPopup() {
        const td = trafficData[cust.id] || {};
        const isOnl = td.online || false;

        // Find ODP connection
        let odpName = null, odpStatus = null;
        Object.values(allInfraPoints).forEach(pt => {
            if (pt.type === 'customer' && pt.metadata && pt.parent_id) {
                try {
                    const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata) : pt.metadata;
                    if (meta.customer_id === cust.id) {
                        const par = allInfraPoints[pt.parent_id];
                        if (par) { odpName = par.name; odpStatus = par.status; }
                    }
                } catch (e) { }
            }
        });

        const harga = cust.package?.price ? 'Rp ' + parseInt(cust.package.price).toLocaleString('id-ID') : '—';
        const phone = cust.phone || '—';
        const odpHtml = odpName
            ? `<span style="color:${odpStatus === 'active' ? '#22c55e' : '#f59e0b'};font-weight:700">${odpStatus === 'active' ? '' : '⚠'} ${odpName}</span>`
            : `<span style="color:#f59e0b;font-weight:700">⚠ Not Connected</span>`;

        const dot = isOnl
            ? `<span style="display:inline-block;width:8px;height:8px;background:#22c55e;border-radius:50%;margin-right:4px;box-shadow:0 0 5px rgba(34,197,94,.8)"></span>`
            : `<span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:50%;margin-right:4px"></span>`;

        const srcMap = { pppoe: 'PPPoE', arp: 'ARP', dhcp: 'DHCP', queue: 'Queue' };
        const srcBadge = isOnl && td.onlineSource
            ? `<span style="background:#e6fff7;color:#065f46;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:4px;text-transform:uppercase">${srcMap[td.onlineSource] || td.onlineSource}</span>`
            : '';
        const uptimeTxt = td.uptime ? `<span style="color:#8899b0;font-size:10px"> (${td.uptime})</span>` : '';
        const statusHtml = isOnl
            ? `${dot}<span style="color:#16a34a;font-weight:700">ONLINE</span>${srcBadge}${uptimeTxt}`
            : `${dot}<span style="color:#ef4444;font-weight:700">OFFLINE</span>`;

        const fR = bps => { if (!bps) return '0 bps'; if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps'; if (bps >= 1000) return (bps / 1000).toFixed(0) + ' Kbps'; return bps + ' bps'; };
        const bar = (pct, key) => `<div style="width:100%;height:5px;background:#e8edf5;border-radius:3px;overflow:hidden;margin-top:3px"><div data-live="${key}" style="width:${Math.min(100, pct || 0)}%;height:100%;background:${(pct || 0) > 80 ? '#ef4444' : (pct || 0) > 60 ? '#f59e0b' : '#22c55e'};border-radius:3px"></div></div>`;

        const trafficRows = td.queueName ? `
      <div class="cp-row" style="flex-direction:column;align-items:flex-start;gap:3px">
        <div style="display:flex;justify-content:space-between;width:100%">
          <span class="cp-lbl">↓ Download</span>
          <span class="cp-val" style="color:#3b82f6" data-live="dl-rate">${fR(td.rateDown)}</span>
        </div>
        ${bar(td.utilDown, 'dl-bar')}
        <div style="display:flex;justify-content:space-between;width:100%;margin-top:4px">
          <span class="cp-lbl">↑ Upload</span>
          <span class="cp-val" style="color:#f97316" data-live="ul-rate">${fR(td.rateUp)}</span>
        </div>
        ${bar(td.utilUp, 'ul-bar')}
        ${td.maxDown ? `<div style="font-size:10px;color:#8899b0;margin-top:2px">Limit: ${fR(td.maxDown)} / ${fR(td.maxUp)}</div>` : ''}
      </div>` : '';
        const ipRow = td.ip ? `<div class="cp-row"><span class="cp-lbl">IP Address</span><span class="cp-val" style="font-family:monospace;font-size:11px">${td.ip}</span></div>` : '';

        return `<div class="cp-popup">
      <div class="cp-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
        <span>${cust.name}</span>
      </div>
      <div class="cp-body">
        <div class="cp-row"><span class="cp-lbl">Customer ID</span><span class="cp-val">${cust.customer_id}</span></div>
        <div class="cp-row"><span class="cp-lbl">Layanan</span><span class="cp-val">${cust.package?.name || '—'}</span></div>
      
        <div class="cp-row"><span class="cp-lbl">WhatsApp</span><span class="cp-val">${phone}</span></div>
        <div class="cp-row"><span class="cp-lbl">ODP</span><span class="cp-val">${odpHtml}</span></div>
        <div id="rx-row-${cust.id}" style="padding:6px 16px;border-bottom:1px solid #f1f5f9;background:#f8fafc;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:13px;color:#94a3b8;font-weight:500;display:flex;align-items:center;gap:4px">
      
            RX
          </span>
          <span id="rx-val-${cust.id}" style="font-size:11px;color:#94a3b8">Memuat...</span>
        </div>
        <div class="cp-row"><span class="cp-lbl">Status</span><span class="cp-val" data-live="status">${statusHtml}</span></div>
        ${trafficRows}
        ${ipRow}
        <!-- Traffic Chart -->
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <span style="font-size:11px;font-weight:700;color:#374151">Traffic History</span>
            <div style="display:flex;gap:3px">
              <div style="display:flex;gap:2px" id="cht-tabs-${cust.id}">
                <button onclick="setCustRange(${cust.id},\'rt\',this)" style="padding:2px 6px;font-size:9.5px;font-weight:700;border:1px solid #1d4ed8;border-radius:4px;background:#1d4ed8;color:#fff;cursor:pointer;font-family:inherit" title="Real-time">Live</button>
                <button onclick="setCustRange(${cust.id},\'1m\',this)" style="padding:2px 6px;font-size:9.5px;font-weight:600;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;color:#64748b;cursor:pointer;font-family:inherit">30m</button>
                <button onclick="setCustRange(${cust.id},\'3h\',this)" style="padding:2px 6px;font-size:9.5px;font-weight:600;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;color:#64748b;cursor:pointer;font-family:inherit">3h</button>
                <button onclick="setCustRange(${cust.id},\'24h\',this)" style="padding:2px 6px;font-size:9.5px;font-weight:600;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;color:#64748b;cursor:pointer;font-family:inherit">24h</button>
                <button onclick="setCustRange(${cust.id},\'3d\',this)" style="padding:2px 6px;font-size:9.5px;font-weight:600;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;color:#64748b;cursor:pointer;font-family:inherit">3d</button>
              </div>
            </div>
          </div>
          <canvas id="chart-cust-${cust.id}" width="270" height="72" style="width:100%;height:72px;display:block;border-radius:8px;background:#f1f5f9;border:1px solid #e2e8f0"></canvas>
          <div style="display:flex;align-items:center;gap:10px;margin-top:4px;font-size:10px;color:#94a3b8">
            <span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:10px;height:2px;background:#2563eb;border-radius:1px"></span>DL</span>
            <span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:10px;height:2px;background:#f97316;border-radius:1px"></span>UL</span>
            <span id="chart-cust-${cust.id}-note" style="margin-left:auto">Memuat...</span>
          </div>
        </div>
      </div>
      <div class="cp-actions" style="grid-template-columns:1fr 1fr 1fr">
        <button class="cp-btn cp-nav" onclick="openNavigation(${cust.latitude},${cust.longitude},'${cust.name.replace(/'/g, "\'")}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3,11 22,2 13,21 11,13 3,11"/></svg>Navigasi
        </button>
        <button class="cp-btn cp-edit" onclick="editCustInfra(${cust.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit
        </button>
        <button class="cp-btn" style="background:#fff5f5;color:#dc2626;border-radius:0 0 14px 0;border-left:1px solid #fee2e2" onclick="removeMarkerFromMap(${cust.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><circle cx="12" cy="11" r="3"/><line x1="4" y1="4" x2="20" y2="20" stroke-width="2.5"/></svg>Hapus
        </button>
      </div>
    </div>`;
    }

    // Create marker with draggable enabled
    const m = L.marker([+cust.latitude, +cust.longitude], {
        icon: makePinIcon(null),
        draggable: true
    }).addTo(map);

    // Drag start — tampilkan hint
    let _dragToast = null;
    m.on('dragstart', () => {
        m.closePopup();
        _dragToast = showToast('Geser ke posisi baru, lepas untuk menyimpan…', 'info', 0);
    });

    // Drag — update kabel terhubung secara real-time
    m.on('drag', () => {
        const pos = m.getLatLng();
        const infraPt = Object.values(allInfraPoints).find(pt => {
            if (pt.type !== 'customer' || !pt.metadata) return false;
            try { const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata) : pt.metadata; return meta.customer_id === cust.id; } catch (ex) { return false; }
        });
        if (infraPt) {
            allInfraPoints[infraPt.id].latitude = pos.lat;
            allInfraPoints[infraPt.id].longitude = pos.lng;
        }
    });

    // Drag end — simpan koordinat baru ke server
    m.on('dragend', async (e) => {
        if (_dragToast) { _dragToast.remove(); _dragToast = null; }
        const { lat, lng } = e.target.getLatLng();

        // Cari infra point milik customer ini
        const infraPt = Object.values(allInfraPoints).find(pt => {
            if (pt.type !== 'customer' || !pt.metadata) return false;
            try { const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata) : pt.metadata; return meta.customer_id === cust.id; } catch (ex) { return false; }
        });

        try {
            // 1. Simpan koordinat ke tabel customers
            const res = await App.api(`/customers/${cust.id}`, {
                method: 'PUT',
                body: JSON.stringify({ latitude: lat, longitude: lng })
            });

            // 2. Kalau ada infra point, update juga koordinatnya
            if (infraPt) {
                await App.api(`/infrastructure/${infraPt.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ latitude: lat, longitude: lng })
                });
                infraPt.latitude = lat;
                infraPt.longitude = lng;
                allInfraPoints[infraPt.id].latitude = lat;
                allInfraPoints[infraPt.id].longitude = lng;
            }

            // Update data lokal
            cust.latitude = lat;
            cust.longitude = lng;

            // Refresh kabel
            loadInfraData();
            showToast(` Posisi ${cust.name} berhasil disimpan`, 'success');
        } catch (err) {
            showToast('Gagal menyimpan posisi: ' + err.message, 'error');
            // Kembalikan ke posisi lama
            m.setLatLng([+cust.latitude, +cust.longitude]);
            if (infraPt) {
                infraPt.latitude = cust.latitude;
                infraPt.longitude = cust.longitude;
                allInfraPoints[infraPt.id].latitude = cust.latitude;
                allInfraPoints[infraPt.id].longitude = cust.longitude;
            }
        }
    });

    // Auto-load chart 6h setelah popup dibuka
    m.on('popupopen', () => {
        setTimeout(() => loadCustChart(cust.id), 120);
        setTimeout(() => fetchCustRxPower(cust.id), 200);
    });

    // Bind popup ONCE outside click — Leaflet calls buildPopup() fresh each open
    m.bindPopup(buildPopup, { maxWidth: 320, className: 'cp-popup-wrap', keepInView: true });

    // Click: draw mode or open popup
    m.on('click', function (e) {
        L.DomEvent.stopPropagation(e);
        if (drawMode) {
            const infraPt = Object.values(allInfraPoints).find(pt => {
                if (pt.type !== 'customer' || !pt.metadata) return false;
                try { const meta = typeof pt.metadata === 'string' ? JSON.parse(pt.metadata) : pt.metadata; return meta.customer_id === cust.id; } catch (e) { return false; }
            });
            if (infraPt) handleDrawClick({ id: infraPt.id, lat: +infraPt.latitude, lng: +infraPt.longitude, name: cust.name, type: 'customer' });
            else showToast('Tambahkan pelanggan ke peta melalui Tambah Titik → Pelanggan', 'warning');
            return;
        }
        m.openPopup();
    });
    m.on('popupclose', () => {
        openPopupCustId = null;
        custChartRange[cust.id] = 'rt';
    });

    // Store references for traffic polling
    m._custData = cust;
    m._makePinIcon = makePinIcon;
    m._onlineStatus = null;
    markers.push(m);
}