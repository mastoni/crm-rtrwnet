// ============================================
// ISP NetOps - Dashboard Analytics
// New Features: Top Customers, Network Uptime, 
// Ticket Stats, Bandwidth Trends, Customer Growth, Revenue Forecast
// ============================================

let bandwidthTrendsChart = null;
let customerGrowthChart = null;
let revenueForecastChart = null;

document.addEventListener('DOMContentLoaded', () => {
    waitForApex(() => {
        loadTopCustomers();
        loadNetworkUptime();
        loadTicketStats();
        loadBandwidthTrends();
        loadCustomerGrowth();
        loadRevenueForecast();
        initAnalyticsControls();
    });
});

function waitForApex(cb) {
    if (typeof ApexCharts !== 'undefined') { cb(); return; }
    let tries = 0;
    const t = setInterval(() => {
        tries++;
        if (typeof ApexCharts !== 'undefined') { clearInterval(t); cb(); }
        else if (tries > 50) { clearInterval(t); console.error('[Analytics] ApexCharts gagal load'); cb(); }
    }, 100);
}

// ─── ANALYTICS CONTROLS ──────────────────────────────────────
function initAnalyticsControls() {
    // Top Customers Period Selector
    const topCustomersPeriod = document.getElementById('topCustomersPeriod');
    if (topCustomersPeriod) {
        topCustomersPeriod.addEventListener('change', () => loadTopCustomers());
    }

    // Uptime Period Selector
    const uptimePeriod = document.getElementById('uptimePeriod');
    if (uptimePeriod) {
        uptimePeriod.addEventListener('change', () => loadNetworkUptime());
    }

    // Bandwidth Trends Period Selector
    const bandwidthTrendsPeriod = document.getElementById('bandwidthTrendsPeriod');
    if (bandwidthTrendsPeriod) {
        bandwidthTrendsPeriod.addEventListener('change', () => loadBandwidthTrends());
    }

    // Refresh Dashboard Button
    const refreshBtn = document.getElementById('refreshDashboard');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadTopCustomers();
            loadNetworkUptime();
            loadTicketStats();
            loadBandwidthTrends();
            loadCustomerGrowth();
            loadRevenueForecast();
        });
    }
}

// ─── TOP CUSTOMERS BY BANDWIDTH ──────────────────────────────
async function loadTopCustomers() {
    const container = document.getElementById('topCustomersList');
    if (!container) return;

    const periodSelect = document.getElementById('topCustomersPeriod');
    const period = periodSelect ? periodSelect.value : '7d';

    try {
        const data = await App.api(`/dashboard/top-customers?limit=10&period=${period}`);
        if (!data?.success || !data.data.length) {
            container.innerHTML = '<div class="empty-state">No customer data available</div>';
            return;
        }

        container.innerHTML = data.data.map((customer, idx) => `
      <div class="customer-bandwidth-item">
        <div class="customer-rank">#${idx + 1}</div>
        <div class="customer-info">
          <div class="customer-name">${escHtml(customer.name)}</div>
          <div class="customer-meta">
            <span class="customer-id">${escHtml(customer.customer_id)}</span>
            <span class="customer-package">${escHtml(customer.package_name || '-')}</span>
          </div>
        </div>
        <div class="customer-usage">
          <div class="usage-gb">${customer.total_gb} GB</div>
          <div class="usage-speed">
            <span style="color:#3b82f6;">↓${customer.avg_download_mbps} Mbps</span>
            <span style="color:#f97316;">↑${customer.avg_upload_mbps} Mbps</span>
          </div>
        </div>
        <div class="usage-bar">
          <div class="usage-fill" style="width: ${Math.min(customer.usage_percent, 100)}%"></div>
        </div>
      </div>
    `).join('');
    } catch (err) {
        console.error('Error loading top customers:', err);
        container.innerHTML = '<div class="error-state">Failed to load data</div>';
    }
}

// ─── NETWORK UPTIME STATISTICS ───────────────────────────────
async function loadNetworkUptime() {
    const summaryContainer = document.getElementById('uptimeSummary');
    const listContainer = document.getElementById('uptimeDevicesList');
    if (!listContainer) return;

    const periodSelect = document.getElementById('uptimePeriod');
    const period = periodSelect ? periodSelect.value : '7d';

    try {
        const data = await App.api(`/dashboard/network-uptime?period=${period}`);
        if (!data?.success) {
            listContainer.innerHTML = '<div class="empty-state">No uptime data available</div>';
            return;
        }

        // Update summary
        if (summaryContainer) {
            const avgUptime = document.getElementById('avgUptime');
            const criticalDevices = document.getElementById('criticalDevices');
            if (avgUptime) avgUptime.textContent = data.data.summary.average_uptime + '%';
            if (criticalDevices) {
                criticalDevices.textContent = data.data.summary.critical_devices;
                criticalDevices.style.color = data.data.summary.critical_devices > 0 ? '#ef4444' : '#22c55e';
            }
        }

        // Show only devices with uptime < 100% or critical ones (top 5)
        const criticalDevices = data.data.devices
            .filter(d => d.uptime_percent < 100)
            .slice(0, 5);

        if (criticalDevices.length === 0) {
            listContainer.innerHTML = '<div class="success-state">All devices running perfectly! 🎉</div>';
            return;
        }

        listContainer.innerHTML = criticalDevices.map(device => {
            const uptimeClass = device.uptime_percent >= 99 ? 'good' :
                device.uptime_percent >= 95 ? 'warning' : 'critical';
            return `
        <div class="uptime-device-item">
          <div class="device-info-uptime">
            <span class="device-status-dot ${device.current_status}"></span>
            <div>
              <div class="device-name-uptime">${escHtml(device.device_name)}</div>
              <div class="device-ip-uptime">${escHtml(device.device_ip)}</div>
            </div>
          </div>
          <div class="uptime-value ${uptimeClass}">${device.uptime_percent}%</div>
          <div class="uptime-incidents">
            ${device.downtime_incidents} incidents
          </div>
        </div>
      `;
        }).join('');
    } catch (err) {
        console.error('Error loading network uptime:', err);
        listContainer.innerHTML = '<div class="error-state">Failed to load data</div>';
    }
}

// ─── TICKET STATISTICS ───────────────────────────────────────
async function loadTicketStats() {
    try {
        const data = await App.api('/dashboard/ticket-stats?period=30d');
        if (!data?.success) return;

        const s = data.data.summary;
        setText('openTickets', s.open_tickets);
        setText('resolvedTickets', s.resolved_tickets);
        setText('avgResolutionTime', s.avg_resolution_hours + 'h');

        // Optional: Add ticket trend chart or details
    } catch (err) {
        console.error('Error loading ticket stats:', err);
    }
}

// ─── BANDWIDTH TRENDS CHART ──────────────────────────────────
async function loadBandwidthTrends() {
    const chartEl = document.getElementById('bandwidthTrendsChart');
    if (!chartEl) return;

    const periodSelect = document.getElementById('bandwidthTrendsPeriod');
    const period = periodSelect ? periodSelect.value : 'daily';

    try {
        const data = await App.api(`/dashboard/bandwidth-trends?period=${period}`);
        if (!data?.success || !data.data.length) {
            chartEl.innerHTML = '<div class="empty-state">No trend data available</div>';
            return;
        }

        // Prepare chart data
        const categories = data.data.map(d => {
            if (period === 'weekly') {
                return d.date;
            } else if (period === 'realtime') {
                return `${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`;
            } else {
                return `${d.date} ${String(d.hour).padStart(2, '0')}:00`;
            }
        }).reverse();

        const avgDownload = data.data.map(d => parseFloat(d.avg_download_mbps)).reverse();
        const avgUpload = data.data.map(d => parseFloat(d.avg_upload_mbps)).reverse();

        if (bandwidthTrendsChart) {
            bandwidthTrendsChart.destroy();
        }

        bandwidthTrendsChart = new ApexCharts(chartEl, {
            chart: {
                type: 'area',
                height: 280,
                toolbar: { show: false },
                fontFamily: 'DM Sans, sans-serif',
                zoom: { enabled: false }
            },
            series: [
                { name: 'Download', data: avgDownload },
                { name: 'Upload', data: avgUpload }
            ],
            colors: ['#3b82f6', '#f97316'],
            dataLabels: { enabled: false },
            stroke: {
                curve: 'smooth',
                width: 2
            },
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.4,
                    opacityTo: 0.1,
                    stops: [0, 100]
                }
            },
            xaxis: {
                categories: categories,
                labels: {
                    rotate: -45,
                    style: { fontSize: '10px', colors: '#94a3b8' }
                }
            },
            yaxis: {
                labels: {
                    formatter: v => v.toFixed(1) + ' Mbps',
                    style: { fontSize: '10px', colors: '#94a3b8' }
                }
            },
            grid: {
                borderColor: '#f0f4ff',
                strokeDashArray: 3
            },
            tooltip: {
                shared: true,
                intersect: false,
                y: {
                    formatter: v => v.toFixed(2) + ' Mbps'
                }
            },
            legend: {
                position: 'top',
                horizontalAlign: 'right'
            }
        });

        bandwidthTrendsChart.render();

        // Auto-refresh tiap 60 detik kalau mode realtime
        if (window._bwTrendsRefresh) {
            clearInterval(window._bwTrendsRefresh);
            window._bwTrendsRefresh = null;
        }
        if (period === 'realtime') {
            window._bwTrendsRefresh = setInterval(() => loadBandwidthTrends(), 60000);
        }
    } catch (err) {
        console.error('Error loading bandwidth trends:', err);
        chartEl.innerHTML = '<div class="error-state">Failed to load data</div>';
    }
}

// ─── CUSTOMER GROWTH CHART ───────────────────────────────────
async function loadCustomerGrowth() {
    const chartEl = document.getElementById('customerGrowthChart');
    if (!chartEl) return;

    try {
        const data = await App.api('/dashboard/customer-growth?months=12');
        if (!data?.success || !data.data.monthly_data.length) {
            chartEl.innerHTML = '<div class="empty-state">No growth data available</div>';
            return;
        }

        // Update summary stats
        const s = data.data.summary;
        setText('totalCustomersGrowth', s.total_customers);
        const growthRateEl = document.getElementById('growthRate');
        if (growthRateEl) {
            growthRateEl.textContent = (s.growth_rate > 0 ? '+' : '') + s.growth_rate + '%';
            growthRateEl.style.color = s.growth_rate >= 0 ? '#22c55e' : '#ef4444';
        }

        // Prepare chart data
        const categories = data.data.monthly_data.map(d => d.month);
        const newCustomers = data.data.monthly_data.map(d => d.new_customers);
        const cumulativeTotal = data.data.monthly_data.map(d => d.cumulative_total);

        if (customerGrowthChart) {
            customerGrowthChart.destroy();
        }

        customerGrowthChart = new ApexCharts(chartEl, {
            chart: {
                type: 'bar',
                height: 280,
                toolbar: { show: false },
                fontFamily: 'DM Sans, sans-serif'
            },
            series: [
                { name: 'New Customers', type: 'column', data: newCustomers },
                { name: 'Total Customers', type: 'line', data: cumulativeTotal }
            ],
            colors: ['#3b82f6', '#22c55e'],
            plotOptions: {
                bar: {
                    borderRadius: 6,
                    columnWidth: '50%'
                }
            },
            stroke: {
                width: [0, 3],
                curve: 'smooth'
            },
            dataLabels: { enabled: false },
            xaxis: {
                categories: categories,
                labels: {
                    style: { fontSize: '10px', colors: '#94a3b8' }
                }
            },
            yaxis: [
                {
                    title: { text: 'New Customers' },
                    labels: {
                        style: { fontSize: '10px', colors: '#94a3b8' }
                    }
                },
                {
                    opposite: true,
                    title: { text: 'Total Customers' },
                    labels: {
                        style: { fontSize: '10px', colors: '#94a3b8' }
                    }
                }
            ],
            grid: {
                borderColor: '#f0f4ff',
                strokeDashArray: 3
            },
            legend: {
                position: 'top',
                horizontalAlign: 'right'
            },
            tooltip: {
                shared: true,
                intersect: false
            }
        });

        customerGrowthChart.render();
    } catch (err) {
        console.error('Error loading customer growth:', err);
        chartEl.innerHTML = '<div class="error-state">Failed to load data</div>';
    }
}

// ─── REVENUE FORECAST CHART ──────────────────────────────────
async function loadRevenueForecast() {
    const chartEl = document.getElementById('revenueForecastChart');
    if (!chartEl) return;

    try {
        const data = await App.api('/dashboard/revenue-forecast?months=6');
        if (!data?.success) {
            chartEl.innerHTML = '<div class="empty-state">No forecast data available</div>';
            return;
        }

        // Update current month revenue
        const currentRevEl = document.getElementById('currentMonthRevenue');
        if (currentRevEl && App.formatCurrency) {
            currentRevEl.textContent = App.formatCurrency(data.data.summary.current_month_revenue);
        }

        // Combine historical and forecast
        const allData = [...data.data.historical, ...data.data.forecast];
        const categories = allData.map(d => d.month);
        const historical = data.data.historical.map(d => d.total_revenue);
        const forecast = data.data.forecast.map(d => d.forecasted_revenue);

        // Pad historical with nulls for forecast months
        const historicalPadded = [...historical, ...Array(forecast.length).fill(null)];
        // Pad forecast with nulls for historical months
        const forecastPadded = [...Array(historical.length).fill(null), ...forecast];

        if (revenueForecastChart) {
            revenueForecastChart.destroy();
        }

        revenueForecastChart = new ApexCharts(chartEl, {
            chart: {
                type: 'line',
                height: 280,
                toolbar: { show: false },
                fontFamily: 'DM Sans, sans-serif'
            },
            series: [
                { name: 'Actual Revenue', data: historicalPadded },
                { name: 'Forecasted', data: forecastPadded }
            ],
            colors: ['#3b82f6', '#f59e0b'],
            stroke: {
                width: [3, 3],
                curve: 'smooth',
                dashArray: [0, 5]
            },
            dataLabels: { enabled: false },
            xaxis: {
                categories: categories,
                labels: {
                    style: { fontSize: '10px', colors: '#94a3b8' }
                }
            },
            yaxis: {
                labels: {
                    formatter: v => {
                        if (!v) return '';
                        return 'Rp ' + (v / 1000000).toFixed(1) + 'M';
                    },
                    style: { fontSize: '10px', colors: '#94a3b8' }
                }
            },
            grid: {
                borderColor: '#f0f4ff',
                strokeDashArray: 3
            },
            markers: {
                size: 4,
                hover: { size: 6 }
            },
            legend: {
                position: 'top',
                horizontalAlign: 'right'
            },
            tooltip: {
                shared: true,
                intersect: false,
                y: {
                    formatter: v => {
                        if (!v) return '';
                        return App.formatCurrency ? App.formatCurrency(v) : 'Rp ' + v.toLocaleString('id-ID');
                    }
                }
            }
        });

        revenueForecastChart.render();
    } catch (err) {
        console.error('Error loading revenue forecast:', err);
        chartEl.innerHTML = '<div class="error-state">Failed to load data</div>';
    }
}

// ─── HELPERS ─────────────────────────────────────────────────
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}