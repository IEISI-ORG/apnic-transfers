/**
 * APNIC Resource Transfers Analysis Dashboard
 * Powered by sql.js (WebAssembly SQLite) and Chart.js
 */

// Application State
// Escape text for insertion into innerHTML templates (values come from third-party registry data).
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

const state = {
  db: null,
  SQL: null,
  charts: {},
  ipv4Data: [],
  ipv4Units: {
    monthly: 'ips',   // 'ips' | 'slash24'
    type: 'ips',      // 'ips' | 'transfers'
    flow: 'ips',      // 'ips' | 'transfers'
    prefix: 'transfers' // 'transfers' | 'ips'
  },
  records: {
    page: 1,
    pageSize: 50,
    totalCount: 0,
    currentRows: []
  },
  lastSqlResult: null,
  theme: localStorage.getItem('apnic_theme') || 'dark'
};

// SQL Query Presets
const SQL_PRESETS = {
  monthly_ipv4: `-- Monthly IPv4 aggregation with breakdowns
SELECT
  substr(transfer_date, 1, 4) || '-' || substr(transfer_date, 5, 2) AS month,
  COUNT(*) AS transfers,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) / 256.0 AS slash24_equiv,
  COUNT(CASE WHEN LOWER(transfer_type) = 'unused' THEN 1 END) AS market_tx,
  COUNT(CASE WHEN LOWER(transfer_type) = 'm&a' THEN 1 END) AS ma_tx,
  COUNT(CASE WHEN LOWER(transfer_type) = 'hrt' THEN 1 END) AS hrt_tx
FROM transfers
WHERE resource_type = 'ipv4'
GROUP BY month
ORDER BY month ASC;`,

  largest_transfers: `-- Top 20 Largest IPv4 Single Block Transfers
SELECT 
  id,
  resource,
  1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER)) AS total_ips,
  (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) / 256.0 AS slash24_equiv,
  from_organisation,
  from_economy,
  from_rir,
  to_organisation,
  to_economy,
  to_rir,
  transfer_date,
  transfer_type
FROM transfers
WHERE resource_type = 'ipv4'
ORDER BY total_ips DESC, transfer_date DESC
LIMIT 20;`,

  top_transferors: `-- Top 15 Source Organizations by Transferred IPv4 Addresses
SELECT 
  from_organisation,
  from_economy,
  COUNT(*) AS transfer_count,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) / 256.0 AS slash24_equiv
FROM transfers
WHERE resource_type = 'ipv4' AND from_organisation != ''
GROUP BY from_organisation, from_economy
ORDER BY total_ips DESC
LIMIT 15;`,

  top_recipients: `-- Top 15 Recipient Organizations by Received IPv4 Addresses
SELECT 
  to_organisation,
  to_economy,
  COUNT(*) AS transfer_count,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) / 256.0 AS slash24_equiv
FROM transfers
WHERE resource_type = 'ipv4' AND to_organisation != ''
GROUP BY to_organisation, to_economy
ORDER BY total_ips DESC
LIMIT 15;`,

  inter_rir_matrix: `-- Inter-RIR Transfer Volume Matrix (From RIR -> To RIR)
SELECT 
  from_rir,
  to_rir,
  COUNT(*) AS transfers,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) / 256.0 AS slash24_equiv
FROM transfers
WHERE resource_type = 'ipv4'
GROUP BY from_rir, to_rir
ORDER BY total_ips DESC;`,

  yearly_rollup: `-- Annual IPv4 Transfer Rollup (2010 - Present)
SELECT
  substr(transfer_date, 1, 4) AS year,
  COUNT(DISTINCT substr(transfer_date, 1, 6)) AS months_active,
  COUNT(*) AS transfers,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) / 256.0 AS slash24_equiv,
  SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) / 65536.0 AS slash16_equiv
FROM transfers
WHERE resource_type = 'ipv4'
GROUP BY year
ORDER BY year ASC;`,

  asn_summary: `-- ASN Transfers by Year and Transfer Policy
SELECT 
  substr(transfer_date, 1, 4) AS year,
  COUNT(*) AS total_asns,
  COUNT(CASE WHEN CAST(resource AS INTEGER) <= 65535 THEN 1 END) AS asn_16bit_2byte,
  COUNT(CASE WHEN CAST(resource AS INTEGER) > 65535 THEN 1 END) AS asn_32bit_4byte,
  COUNT(CASE WHEN LOWER(transfer_type) = 'unused' THEN 1 END) AS market_unused,
  COUNT(CASE WHEN LOWER(transfer_type) = 'm&a' THEN 1 END) AS ma,
  COUNT(CASE WHEN LOWER(transfer_type) = 'hrt' THEN 1 END) AS hrt
FROM transfers
WHERE resource_type = 'asn'
GROUP BY year
ORDER BY year ASC;`,

  ipv6_prefixes: `-- IPv6 Subnet Size Breakdown
SELECT 
  CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER) AS prefix_length,
  '/' || substr(resource, instr(resource, '/') + 1) AS prefix,
  COUNT(*) AS total_transfers,
  COUNT(CASE WHEN from_rir = 'APNIC' AND to_rir = 'APNIC' THEN 1 END) AS intra_apnic,
  COUNT(CASE WHEN from_rir != 'APNIC' OR to_rir != 'APNIC' THEN 1 END) AS inter_rir
FROM transfers
WHERE resource_type = 'ipv6'
GROUP BY prefix_length
ORDER BY prefix_length ASC;`
};

// --------------------------------------------------------------------------
// Initialization
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  setupTabNavigation();
  setupFilterHandlers();
  setupSqlSandbox();
  setupRecordsExplorer();
  setupModalAndDropZone();
  await initDatabase();
});

// --------------------------------------------------------------------------
// Theme Toggle
// --------------------------------------------------------------------------
function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  updateThemeIcons();

  const toggleBtn = document.getElementById('btn-theme-toggle');
  toggleBtn.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('apnic_theme', state.theme);
    updateThemeIcons();
    updateChartsTheme();
  });
}

function updateThemeIcons() {
  const sun = document.getElementById('theme-icon-sun');
  const moon = document.getElementById('theme-icon-moon');
  if (state.theme === 'dark') {
    sun.style.display = 'block';
    moon.style.display = 'none';
  } else {
    sun.style.display = 'none';
    moon.style.display = 'block';
  }
}

function updateChartsTheme() {
  const isDark = state.theme === 'dark';
  const textColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';

  Chart.defaults.color = textColor;
  Chart.defaults.borderColor = gridColor;

  // Re-render all charts
  Object.values(state.charts).forEach(c => c && c.update());
}

// --------------------------------------------------------------------------
// Tab Navigation
// --------------------------------------------------------------------------
function setupTabNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }

      // Refresh relevant tab
      if (targetId === 'tab-ipv4') {
        loadIPv4Analytics();
      } else if (targetId === 'tab-ipv6') {
        loadIPv6Analytics();
      } else if (targetId === 'tab-asn') {
        loadAsnAnalytics();
      } else if (targetId === 'tab-records') {
        queryRecords();
      } else if (targetId === 'tab-sql') {
        if (!document.getElementById('sql-editor').value.trim()) {
          loadPresetQuery('monthly_ipv4');
        }
      }
    });
  });
}

// --------------------------------------------------------------------------
// Database Management (sql.js)
// --------------------------------------------------------------------------
async function initDatabase() {
  setDbStatus('loading', 'Initializing sql.js (WebAssembly)...');

  try {
    const config = {
      locateFile: file => {
        // Look in vendor directory first
        return `vendor/${file}`;
      }
    };

    if (typeof initSqlJs === 'undefined') {
      throw new Error('sql.js library is not loaded. Check script include.');
    }

    state.SQL = await initSqlJs(config);
    await loadDefaultDatabase();
  } catch (err) {
    console.error('Error initializing sql.js:', err);
    setDbStatus('error', 'Failed to load SQLite engine');
  }
}

async function loadDefaultDatabase() {
  setDbStatus('loading', 'Loading transfers.db...');
  try {
    const res = await fetch('transfers.db');
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }
    const buf = await res.arrayBuffer();
    state.db = new state.SQL.Database(new Uint8Array(buf));

    // Verify row count
    const countRes = state.db.exec("SELECT COUNT(*) FROM transfers;");
    const count = countRes[0]?.values[0][0] || 0;

    setDbStatus('ready', `transfers.db (${count.toLocaleString()} records)`);
    
    populateEconomyDropdown();
    loadIPv4Analytics();
  } catch (err) {
    console.error('Error loading default transfers.db:', err);
    setDbStatus('error', 'Could not load transfers.db (Click to load file)');
  }
}

function setDbStatus(type, message) {
  const pill = document.getElementById('db-status');
  const text = document.getElementById('db-status-text');
  pill.className = `db-status-pill ${type === 'ready' ? '' : type}`;
  text.textContent = message;
}

// --------------------------------------------------------------------------
// Economy Dropdown
// --------------------------------------------------------------------------
function populateEconomyDropdown() {
  if (!state.db) return;
  try {
    const res = state.db.exec(`
      SELECT DISTINCT economy FROM (
        SELECT from_economy AS economy FROM transfers WHERE resource_type = 'ipv4' AND from_economy != ''
        UNION
        SELECT to_economy AS economy FROM transfers WHERE resource_type = 'ipv4' AND to_economy != ''
      ) ORDER BY economy ASC;
    `);

    const select = document.getElementById('ipv4-filter-economy');
    select.innerHTML = '<option value="all" selected>All Economies</option>';

    if (res.length > 0 && res[0].values) {
      res[0].values.forEach(([econ]) => {
        const opt = document.createElement('option');
        opt.value = econ;
        opt.textContent = econ;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn('Failed to populate economies:', e);
  }
}

// --------------------------------------------------------------------------
// Filter Handlers
// --------------------------------------------------------------------------
function setupFilterHandlers() {
  const presetSelect = document.getElementById('ipv4-preset-range');
  const groupStart = document.getElementById('group-custom-start');
  const groupEnd = document.getElementById('group-custom-end');

  presetSelect.addEventListener('change', () => {
    if (presetSelect.value === 'custom') {
      groupStart.style.display = 'flex';
      groupEnd.style.display = 'flex';
    } else {
      groupStart.style.display = 'none';
      groupEnd.style.display = 'none';
    }
    loadIPv4Analytics();
  });

  document.getElementById('btn-ipv4-apply').addEventListener('click', loadIPv4Analytics);
  document.getElementById('btn-ipv4-reset').addEventListener('click', () => {
    presetSelect.value = 'all';
    groupStart.style.display = 'none';
    groupEnd.style.display = 'none';
    document.getElementById('ipv4-filter-type').value = 'all';
    document.getElementById('ipv4-filter-flow').value = 'all';
    document.getElementById('ipv4-filter-economy').value = 'all';
    loadIPv4Analytics();
  });

  // Table view toggle
  document.getElementById('ipv4-table-view').addEventListener('change', () => {
    renderIPv4Table(state.ipv4Data);
  });

  // Export buttons
  document.getElementById('btn-export-ipv4-csv').addEventListener('click', exportIPv4Csv);
  document.getElementById('btn-export-ipv4-json').addEventListener('click', exportIPv4Json);

  // Chart toggles
  document.querySelectorAll('.chart-btn-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const parent = btn.parentElement;
      parent.querySelectorAll('.chart-btn-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.getAttribute('data-target');
      const unit = btn.getAttribute('data-unit');
      const metric = btn.getAttribute('data-metric');

      if (target === 'monthlyChart') {
        state.ipv4Units.monthly = unit;
        renderMonthlyIPv4Chart(state.ipv4Data);
      } else if (target === 'typeChart') {
        state.ipv4Units.type = metric;
        renderTypeIPv4Chart(state.ipv4Data);
      } else if (target === 'flowChart') {
        state.ipv4Units.flow = metric;
        renderFlowIPv4Chart(state.ipv4Data);
      } else if (target === 'prefixChart') {
        state.ipv4Units.prefix = metric;
        loadPrefixDistribution();
      }
    });
  });
}

// --------------------------------------------------------------------------
// IPv4 Analytics & Queries
// --------------------------------------------------------------------------
function getIPv4FilterConditions() {
  const preset = document.getElementById('ipv4-preset-range').value;
  const filterType = document.getElementById('ipv4-filter-type').value;
  const filterFlow = document.getElementById('ipv4-filter-flow').value;
  const filterEconomy = document.getElementById('ipv4-filter-economy').value;

  const conditions = ["resource_type = 'ipv4'"];

  // Date range logic
  if (preset === 'last12') {
    conditions.push("substr(transfer_date, 1, 6) >= '202509'");
  } else if (preset === 'last24') {
    conditions.push("substr(transfer_date, 1, 6) >= '202409'");
  } else if (preset === 'last36') {
    conditions.push("substr(transfer_date, 1, 6) >= '202309'");
  } else if (preset === 'last60') {
    conditions.push("substr(transfer_date, 1, 6) >= '202109'");
  } else if (['2026', '2025', '2024', '2023', '2022', '2021', '2020'].includes(preset)) {
    conditions.push(`substr(transfer_date, 1, 4) = '${preset}'`);
  } else if (preset === 'custom') {
    const start = document.getElementById('ipv4-start-month').value.replace('-', '').slice(0, 6);
    const end = document.getElementById('ipv4-end-month').value.replace('-', '').slice(0, 6);
    if (start) conditions.push(`substr(transfer_date, 1, 6) >= '${start}'`);
    if (end) conditions.push(`substr(transfer_date, 1, 6) <= '${end}'`);
  }

  // Policy type
  if (filterType !== 'all') {
    conditions.push(`LOWER(transfer_type) = '${filterType.toLowerCase()}'`);
  }

  // Flow
  if (filterFlow === 'intra') {
    conditions.push("from_rir = 'APNIC' AND to_rir = 'APNIC'");
  } else if (filterFlow === 'inbound') {
    conditions.push("from_rir != 'APNIC' AND to_rir = 'APNIC'");
  } else if (filterFlow === 'outbound') {
    conditions.push("from_rir = 'APNIC' AND to_rir != 'APNIC'");
  }

  // Economy
  if (filterEconomy !== 'all') {
    conditions.push(`(from_economy = '${filterEconomy}' OR to_economy = '${filterEconomy}')`);
  }

  return conditions.join(' AND ');
}

function loadIPv4Analytics() {
  if (!state.db) return;

  const whereClause = getIPv4FilterConditions();
  const query = `
    SELECT
      substr(transfer_date, 1, 4) || '-' || substr(transfer_date, 5, 2) AS month,
      COUNT(*) AS transfers,
      SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips,
      
      -- Transfer Type breakdowns
      COUNT(CASE WHEN LOWER(transfer_type) = 'unused' THEN 1 END) AS unused_transfers,
      SUM(CASE WHEN LOWER(transfer_type) = 'unused' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS unused_ips,
      
      COUNT(CASE WHEN LOWER(transfer_type) = 'm&a' THEN 1 END) AS ma_transfers,
      SUM(CASE WHEN LOWER(transfer_type) = 'm&a' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS ma_ips,
      
      COUNT(CASE WHEN LOWER(transfer_type) = 'hrt' THEN 1 END) AS hrt_transfers,
      SUM(CASE WHEN LOWER(transfer_type) = 'hrt' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS hrt_ips,
      
      -- RIR Flow breakdowns
      COUNT(CASE WHEN from_rir = 'APNIC' AND to_rir = 'APNIC' THEN 1 END) AS intra_transfers,
      SUM(CASE WHEN from_rir = 'APNIC' AND to_rir = 'APNIC' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS intra_ips,
      
      COUNT(CASE WHEN from_rir != 'APNIC' AND to_rir = 'APNIC' THEN 1 END) AS inbound_transfers,
      SUM(CASE WHEN from_rir != 'APNIC' AND to_rir = 'APNIC' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS inbound_ips,
      
      COUNT(CASE WHEN from_rir = 'APNIC' AND to_rir != 'APNIC' THEN 1 END) AS outbound_transfers,
      SUM(CASE WHEN from_rir = 'APNIC' AND to_rir != 'APNIC' THEN (1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) ELSE 0 END) AS outbound_ips

    FROM transfers
    WHERE ${whereClause}
    GROUP BY month
    ORDER BY month ASC;
  `;

  try {
    const res = state.db.exec(query);
    const rows = res.length > 0 ? res[0].values : [];

    let cumulTransfers = 0;
    let cumulIps = 0;

    state.ipv4Data = rows.map(r => {
      const month = r[0];
      const transfers = r[1] || 0;
      const total_ips = r[2] || 0;
      const unused_tx = r[3] || 0;
      const unused_ips = r[4] || 0;
      const ma_tx = r[5] || 0;
      const ma_ips = r[6] || 0;
      const hrt_tx = r[7] || 0;
      const hrt_ips = r[8] || 0;
      const intra_tx = r[9] || 0;
      const intra_ips = r[10] || 0;
      const inbound_tx = r[11] || 0;
      const inbound_ips = r[12] || 0;
      const outbound_tx = r[13] || 0;
      const outbound_ips = r[14] || 0;

      cumulTransfers += transfers;
      cumulIps += total_ips;

      return {
        month,
        transfers,
        total_ips,
        slash24_equiv: total_ips / 256.0,
        slash16_equiv: total_ips / 65536.0,
        cumul_transfers: cumulTransfers,
        cumul_ips: cumulIps,
        cumul_slash24: cumulIps / 256.0,
        unused_tx,
        unused_ips,
        ma_tx,
        ma_ips,
        hrt_tx,
        hrt_ips,
        intra_tx,
        intra_ips,
        inbound_tx,
        inbound_ips,
        outbound_tx,
        outbound_ips,
        inter_rir_ips: inbound_ips + outbound_ips
      };
    });

    renderIPv4Kpis(state.ipv4Data);
    renderMonthlyIPv4Chart(state.ipv4Data);
    renderCumulativeIPv4Chart(state.ipv4Data);
    renderTypeIPv4Chart(state.ipv4Data);
    renderFlowIPv4Chart(state.ipv4Data);
    loadPrefixDistribution();
    loadTopEconomies();
    renderIPv4Table(state.ipv4Data);

  } catch (err) {
    console.error('Error running IPv4 monthly query:', err);
  }
}

// --------------------------------------------------------------------------
// Render IPv4 KPI Cards
// --------------------------------------------------------------------------
function renderIPv4Kpis(data) {
  if (!data || data.length === 0) {
    document.getElementById('kpi-ipv4-transfers').textContent = '0';
    document.getElementById('kpi-ipv4-ips').textContent = '0';
    document.getElementById('kpi-ipv4-avg-tx').innerHTML = '0';
    document.getElementById('kpi-ipv4-peak-tx').textContent = '-';
    return;
  }

  const totalMonths = data.length;
  const totalTransfers = data.reduce((acc, d) => acc + d.transfers, 0);
  const totalIps = data.reduce((acc, d) => acc + d.total_ips, 0);
  const totalIntra = data.reduce((acc, d) => acc + d.intra_tx, 0);
  const totalInbound = data.reduce((acc, d) => acc + d.inbound_tx, 0);
  const totalOutbound = data.reduce((acc, d) => acc + d.outbound_tx, 0);

  const slash24 = totalIps / 256.0;
  const slash16 = totalIps / 65536.0;
  const slash8 = totalIps / (256.0 * 65536.0);

  const avgTx = totalTransfers / totalMonths;
  const avgIps = totalIps / totalMonths;
  const avgSlash24 = avgIps / 256.0;

  const peakTxMonth = data.reduce((max, d) => d.transfers > max.transfers ? d : max, data[0]);
  const peakIpMonth = data.reduce((max, d) => d.total_ips > max.total_ips ? d : max, data[0]);

  document.getElementById('kpi-ipv4-months').textContent = `${totalMonths} months`;
  document.getElementById('kpi-ipv4-transfers').textContent = totalTransfers.toLocaleString();
  document.getElementById('kpi-ipv4-tx-sub').innerHTML = 
    `Intra: <strong>${totalIntra.toLocaleString()}</strong> | Inbound: <strong>${totalInbound.toLocaleString()}</strong> | Outbound: <strong>${totalOutbound.toLocaleString()}</strong>`;

  document.getElementById('kpi-ipv4-ips').textContent = totalIps.toLocaleString();
  document.getElementById('kpi-ipv4-equiv-sub').innerHTML = 
    `<strong>${Math.round(slash24).toLocaleString()}</strong> x /24 | <strong>${slash16.toFixed(1)}</strong> x /16 | <strong>${slash8.toFixed(2)}</strong> x /8`;

  document.getElementById('kpi-ipv4-avg-tx').innerHTML = 
    `${avgTx.toFixed(1)} <span style="font-size:0.9rem;font-weight:500;color:var(--text-secondary)">tx/mo</span>`;
  document.getElementById('kpi-ipv4-avg-ips').innerHTML = 
    `<strong>${Math.round(avgIps).toLocaleString()}</strong> IPs/mo (<strong>${Math.round(avgSlash24).toLocaleString()}</strong> /24s)`;

  document.getElementById('kpi-ipv4-peak-tx').textContent = 
    `${peakTxMonth.month} (${peakTxMonth.transfers.toLocaleString()} tx)`;
  document.getElementById('kpi-ipv4-peak-sub').innerHTML = 
    `Peak Volume: <strong>${peakIpMonth.month}</strong> (${peakIpMonth.total_ips.toLocaleString()} IPs)`;
}

// --------------------------------------------------------------------------
// Chart 1: Monthly IPv4 Trend (Transfers & Volume)
// --------------------------------------------------------------------------
function renderMonthlyIPv4Chart(data) {
  const ctx = document.getElementById('chart-monthly-ipv4').getContext('2d');
  const labels = data.map(d => d.month);
  const transfersData = data.map(d => d.transfers);
  
  const unit = state.ipv4Units.monthly;
  const volumeData = unit === 'slash24' ? data.map(d => d.slash24_equiv) : data.map(d => d.total_ips);
  const volumeLabel = unit === 'slash24' ? '/24 Equivalents' : 'Total IPv4 Addresses';

  if (state.charts.monthlyIPv4) {
    state.charts.monthlyIPv4.destroy();
  }

  state.charts.monthlyIPv4 = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Transfer Count',
          type: 'line',
          data: transfersData,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.2)',
          borderWidth: 2,
          pointRadius: labels.length > 50 ? 0 : 3,
          pointHoverRadius: 5,
          tension: 0.2,
          yAxisID: 'y'
        },
        {
          label: volumeLabel,
          type: 'bar',
          data: volumeData,
          backgroundColor: 'rgba(16, 185, 129, 0.65)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 14, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) label += ': ';
              if (context.parsed.y !== null) {
                label += Math.round(context.parsed.y).toLocaleString();
              }
              return label;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxTicksLimit: 24,
            font: { size: 10 }
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Number of Transfers', font: { size: 11 } },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: volumeLabel, font: { size: 11 } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// --------------------------------------------------------------------------
// Chart 2: Cumulative IPv4 Growth
// --------------------------------------------------------------------------
function renderCumulativeIPv4Chart(data) {
  const ctx = document.getElementById('chart-cumulative-ipv4').getContext('2d');
  const labels = data.map(d => d.month);
  const cumulIps = data.map(d => d.cumul_ips);
  const cumulTx = data.map(d => d.cumul_transfers);

  if (state.charts.cumulIPv4) {
    state.charts.cumulIPv4.destroy();
  }

  state.charts.cumulIPv4 = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Cumulative IPv4 IPs',
          data: cumulIps,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          fill: true,
          borderWidth: 2.5,
          pointRadius: 0,
          yAxisID: 'y'
        },
        {
          label: 'Cumulative Transfers',
          data: cumulTx,
          borderColor: '#a855f7',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [4, 4],
          pointRadius: 0,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 14, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y).toLocaleString()}`
          }
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12, font: { size: 10 } } },
        y: {
          title: { display: true, text: 'Cumulative IPs' },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        y1: {
          position: 'right',
          title: { display: true, text: 'Cumulative Transfers' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// --------------------------------------------------------------------------
// Chart 3: Transfer Policy Breakdown Stacked
// --------------------------------------------------------------------------
function renderTypeIPv4Chart(data) {
  const ctx = document.getElementById('chart-type-ipv4').getContext('2d');
  const labels = data.map(d => d.month);
  const isIps = state.ipv4Units.type === 'ips';

  const unusedData = isIps ? data.map(d => d.unused_ips) : data.map(d => d.unused_tx);
  const maData = isIps ? data.map(d => d.ma_ips) : data.map(d => d.ma_tx);
  const hrtData = isIps ? data.map(d => d.hrt_ips) : data.map(d => d.hrt_tx);

  if (state.charts.typeIPv4) {
    state.charts.typeIPv4.destroy();
  }

  state.charts.typeIPv4 = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Market / Unused',
          data: unusedData,
          backgroundColor: '#38bdf8',
          stack: 'stack0'
        },
        {
          label: 'M&A',
          data: maData,
          backgroundColor: '#a855f7',
          stack: 'stack0'
        },
        {
          label: 'Historical (HRT)',
          data: hrtData,
          backgroundColor: '#f59e0b',
          stack: 'stack0'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, ticks: { maxTicksLimit: 12, font: { size: 10 } } },
        y: {
          stacked: true,
          title: { display: true, text: isIps ? 'Total IPs' : 'Transfers' },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        }
      },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } }
      }
    }
  });
}

// --------------------------------------------------------------------------
// Chart 4: RIR Flow Dynamics Stacked
// --------------------------------------------------------------------------
function renderFlowIPv4Chart(data) {
  const ctx = document.getElementById('chart-flow-ipv4').getContext('2d');
  const labels = data.map(d => d.month);
  const isIps = state.ipv4Units.flow === 'ips';

  const intraData = isIps ? data.map(d => d.intra_ips) : data.map(d => d.intra_tx);
  const inData = isIps ? data.map(d => d.inbound_ips) : data.map(d => d.inbound_tx);
  const outData = isIps ? data.map(d => d.outbound_ips) : data.map(d => d.outbound_tx);

  if (state.charts.flowIPv4) {
    state.charts.flowIPv4.destroy();
  }

  state.charts.flowIPv4 = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Intra-APNIC',
          data: intraData,
          backgroundColor: '#10b981',
          stack: 'stack0'
        },
        {
          label: 'Inbound Inter-RIR',
          data: inData,
          backgroundColor: '#6366f1',
          stack: 'stack0'
        },
        {
          label: 'Outbound Inter-RIR',
          data: outData,
          backgroundColor: '#f43f5e',
          stack: 'stack0'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, ticks: { maxTicksLimit: 12, font: { size: 10 } } },
        y: {
          stacked: true,
          title: { display: true, text: isIps ? 'Total IPs' : 'Transfers' },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        }
      },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } }
      }
    }
  });
}

// --------------------------------------------------------------------------
// Chart 5: Prefix Length Distribution
// --------------------------------------------------------------------------
function loadPrefixDistribution() {
  if (!state.db) return;
  const whereClause = getIPv4FilterConditions();

  const query = `
    SELECT 
      CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER) AS prefix_len,
      COUNT(*) AS transfers,
      SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips
    FROM transfers
    WHERE ${whereClause}
    GROUP BY prefix_len
    ORDER BY prefix_len ASC;
  `;

  try {
    const res = state.db.exec(query);
    const rows = res.length > 0 ? res[0].values : [];

    const labels = rows.map(r => `/${r[0]}`);
    const isTransfers = state.ipv4Units.prefix === 'transfers';
    const values = isTransfers ? rows.map(r => r[1]) : rows.map(r => r[2]);

    const ctx = document.getElementById('chart-prefix-ipv4').getContext('2d');
    if (state.charts.prefixIPv4) {
      state.charts.prefixIPv4.destroy();
    }

    state.charts.prefixIPv4 = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: isTransfers ? 'Transfer Count' : 'Total Addresses',
          data: values,
          backgroundColor: '#38bdf8',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            title: { display: true, text: isTransfers ? 'Transfers' : 'Total IPs' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          }
        }
      }
    });

  } catch (err) {
    console.error('Prefix distribution error:', err);
  }
}

// --------------------------------------------------------------------------
// Charts 6 & 7: Top Economies
// --------------------------------------------------------------------------
function loadTopEconomies() {
  if (!state.db) return;
  const whereClause = getIPv4FilterConditions();

  // Top Source Economies
  const sourceQuery = `
    SELECT 
      COALESCE(NULLIF(from_economy, ''), 'Unknown') AS economy,
      COUNT(*) AS transfers,
      SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips
    FROM transfers
    WHERE ${whereClause}
    GROUP BY economy
    ORDER BY total_ips DESC
    LIMIT 10;
  `;

  // Top Destination Economies
  const destQuery = `
    SELECT 
      COALESCE(NULLIF(to_economy, ''), 'Unknown') AS economy,
      COUNT(*) AS transfers,
      SUM(1 << (32 - CAST(substr(resource, instr(resource, '/') + 1) AS INTEGER))) AS total_ips
    FROM transfers
    WHERE ${whereClause}
    GROUP BY economy
    ORDER BY total_ips DESC
    LIMIT 10;
  `;

  try {
    const srcRes = state.db.exec(sourceQuery);
    const destRes = state.db.exec(destQuery);

    const srcRows = srcRes.length > 0 ? srcRes[0].values : [];
    const destRows = destRes.length > 0 ? destRes[0].values : [];

    // Render Source Chart
    const srcCtx = document.getElementById('chart-source-economies').getContext('2d');
    if (state.charts.srcEconomies) state.charts.srcEconomies.destroy();

    state.charts.srcEconomies = new Chart(srcCtx, {
      type: 'bar',
      data: {
        labels: srcRows.map(r => r[0]),
        datasets: [{
          label: 'IPs Transferred',
          data: srcRows.map(r => r[2]),
          backgroundColor: '#f59e0b',
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            title: { display: true, text: 'Total IPv4 Addresses' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          }
        }
      }
    });

    // Render Dest Chart
    const destCtx = document.getElementById('chart-dest-economies').getContext('2d');
    if (state.charts.destEconomies) state.charts.destEconomies.destroy();

    state.charts.destEconomies = new Chart(destCtx, {
      type: 'bar',
      data: {
        labels: destRows.map(r => r[0]),
        datasets: [{
          label: 'IPs Received',
          data: destRows.map(r => r[2]),
          backgroundColor: '#10b981',
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            title: { display: true, text: 'Total IPv4 Addresses' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          }
        }
      }
    });

  } catch (e) {
    console.error('Top economies error:', e);
  }
}

// --------------------------------------------------------------------------
// Monthly Summary Table View
// --------------------------------------------------------------------------
function renderIPv4Table(data) {
  const table = document.getElementById('table-monthly-ipv4');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const mode = document.getElementById('ipv4-table-view').value;

  if (mode === 'compact') {
    thead.innerHTML = `
      <tr>
        <th>Month</th>
        <th class="text-right">Transfers</th>
        <th class="text-right">Total IPs</th>
        <th class="text-right">/24 Equiv</th>
        <th class="text-right">Cumul IPs</th>
        <th class="text-right">Cumul /24s</th>
      </tr>
    `;

    tbody.innerHTML = data.map(d => `
      <tr>
        <td><strong>${esc(d.month)}</strong></td>
        <td class="text-right">${d.transfers.toLocaleString()}</td>
        <td class="text-right">${d.total_ips.toLocaleString()}</td>
        <td class="text-right">${Math.round(d.slash24_equiv).toLocaleString()}</td>
        <td class="text-right">${d.cumul_ips.toLocaleString()}</td>
        <td class="text-right">${Math.round(d.cumul_slash24).toLocaleString()}</td>
      </tr>
    `).join('');

  } else if (mode === 'detailed') {
    thead.innerHTML = `
      <tr>
        <th>Month</th>
        <th class="text-right">Transfers</th>
        <th class="text-right">Total IPs</th>
        <th class="text-right">/24 Equiv</th>
        <th class="text-right">Unused (Tx)</th>
        <th class="text-right">M&A (Tx)</th>
        <th class="text-right">HRT (Tx)</th>
        <th class="text-right">Intra (Tx)</th>
        <th class="text-right">Inbound (Tx)</th>
        <th class="text-right">Outbound (Tx)</th>
        <th class="text-right">Cumul IPs</th>
      </tr>
    `;

    tbody.innerHTML = data.map(d => `
      <tr>
        <td><strong>${esc(d.month)}</strong></td>
        <td class="text-right">${d.transfers.toLocaleString()}</td>
        <td class="text-right">${d.total_ips.toLocaleString()}</td>
        <td class="text-right">${Math.round(d.slash24_equiv).toLocaleString()}</td>
        <td class="text-right">${d.unused_tx.toLocaleString()}</td>
        <td class="text-right">${d.ma_tx.toLocaleString()}</td>
        <td class="text-right">${d.hrt_tx.toLocaleString()}</td>
        <td class="text-right">${d.intra_tx.toLocaleString()}</td>
        <td class="text-right">${d.inbound_tx.toLocaleString()}</td>
        <td class="text-right">${d.outbound_tx.toLocaleString()}</td>
        <td class="text-right">${d.cumul_ips.toLocaleString()}</td>
      </tr>
    `).join('');

  } else {
    // Standard View
    thead.innerHTML = `
      <tr>
        <th>Month</th>
        <th class="text-right">Transfers</th>
        <th class="text-right">Total IPs</th>
        <th class="text-right">/24 Equiv</th>
        <th class="text-right">Market (IPs)</th>
        <th class="text-right">M&A (IPs)</th>
        <th class="text-right">HRT (IPs)</th>
        <th class="text-right">Intra (IPs)</th>
        <th class="text-right">Inter-RIR (IPs)</th>
        <th class="text-right">Cumul IPs</th>
      </tr>
    `;

    tbody.innerHTML = data.map(d => `
      <tr>
        <td><strong>${esc(d.month)}</strong></td>
        <td class="text-right">${d.transfers.toLocaleString()}</td>
        <td class="text-right">${d.total_ips.toLocaleString()}</td>
        <td class="text-right">${Math.round(d.slash24_equiv).toLocaleString()}</td>
        <td class="text-right">${d.unused_ips.toLocaleString()}</td>
        <td class="text-right">${d.ma_ips.toLocaleString()}</td>
        <td class="text-right">${d.hrt_ips.toLocaleString()}</td>
        <td class="text-right">${d.intra_ips.toLocaleString()}</td>
        <td class="text-right">${d.inter_rir_ips.toLocaleString()}</td>
        <td class="text-right">${d.cumul_ips.toLocaleString()}</td>
      </tr>
    `).join('');
  }
}

// --------------------------------------------------------------------------
// IPv6 Analytics
// --------------------------------------------------------------------------
function loadIPv6Analytics() {
  if (!state.db) return;

  try {
    const kpiRes = state.db.exec(`
      SELECT 
        COUNT(*) AS total_transfers,
        COUNT(DISTINCT from_economy) + COUNT(DISTINCT to_economy) AS economies
      FROM transfers 
      WHERE resource_type = 'ipv6';
    `);

    if (kpiRes.length > 0 && kpiRes[0].values) {
      const [totalTx, econCount] = kpiRes[0].values[0];
      document.getElementById('kpi-ipv6-transfers').textContent = (totalTx || 0).toLocaleString();
      document.getElementById('kpi-ipv6-economies').textContent = (econCount || 0).toLocaleString();
    }

    // Monthly IPv6 Trend
    const monthlyRes = state.db.exec(`
      SELECT 
        substr(transfer_date, 1, 4) || '-' || substr(transfer_date, 5, 2) AS month,
        COUNT(*) AS transfers,
        COUNT(CASE WHEN LOWER(transfer_type) = 'unused' THEN 1 END) AS unused,
        COUNT(CASE WHEN LOWER(transfer_type) = 'm&a' THEN 1 END) AS ma,
        COUNT(CASE WHEN LOWER(transfer_type) = 'hrt' THEN 1 END) AS hrt
      FROM transfers
      WHERE resource_type = 'ipv6'
      GROUP BY month
      ORDER BY month ASC;
    `);

    if (monthlyRes.length > 0) {
      const mRows = monthlyRes[0].values;
      const ctx = document.getElementById('chart-monthly-ipv6').getContext('2d');
      if (state.charts.monthlyIPv6) state.charts.monthlyIPv6.destroy();

      state.charts.monthlyIPv6 = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: mRows.map(r => r[0]),
          datasets: [
            { label: 'Market / Unused', data: mRows.map(r => r[2]), backgroundColor: '#38bdf8', stack: 's0' },
            { label: 'M&A', data: mRows.map(r => r[3]), backgroundColor: '#a855f7', stack: 's0' },
            { label: 'HRT', data: mRows.map(r => r[4]), backgroundColor: '#f59e0b', stack: 's0' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { stacked: true, ticks: { maxTicksLimit: 12 } },
            y: { stacked: true, title: { display: true, text: 'IPv6 Transfers' } }
          }
        }
      });
    }

    // IPv6 Prefixes
    const prefixRes = state.db.exec(`
      SELECT 
        '/' || substr(resource, instr(resource, '/') + 1) AS prefix,
        COUNT(*) AS count
      FROM transfers
      WHERE resource_type = 'ipv6'
      GROUP BY prefix
      ORDER BY count DESC
      LIMIT 8;
    `);

    if (prefixRes.length > 0) {
      const pRows = prefixRes[0].values;
      const ctx = document.getElementById('chart-prefix-ipv6').getContext('2d');
      if (state.charts.prefixIPv6) state.charts.prefixIPv6.destroy();

      state.charts.prefixIPv6 = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: pRows.map(r => r[0]),
          datasets: [{
            data: pRows.map(r => r[1]),
            backgroundColor: ['#38bdf8', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#6366f1', '#14b8a6', '#f43f5e']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'right' } }
        }
      });
    }

  } catch (e) {
    console.error('IPv6 analytics error:', e);
  }
}

// --------------------------------------------------------------------------
// ASN Analytics
// --------------------------------------------------------------------------
function loadAsnAnalytics() {
  if (!state.db) return;

  try {
    const kpiRes = state.db.exec(`
      SELECT 
        COUNT(*) AS total_asns,
        COUNT(CASE WHEN CAST(resource AS INTEGER) <= 65535 THEN 1 END) AS asn_16bit,
        COUNT(CASE WHEN CAST(resource AS INTEGER) > 65535 THEN 1 END) AS asn_32bit
      FROM transfers 
      WHERE resource_type = 'asn';
    `);

    if (kpiRes.length > 0 && kpiRes[0].values) {
      const [total, bit16, bit32] = kpiRes[0].values[0];
      document.getElementById('kpi-asn-transfers').textContent = (total || 0).toLocaleString();
      document.getElementById('kpi-asn-types').textContent = `${bit16.toLocaleString()} / ${bit32.toLocaleString()}`;
    }

    const topSrcRes = state.db.exec(`
      SELECT from_economy, COUNT(*) AS count 
      FROM transfers 
      WHERE resource_type = 'asn' AND from_economy != ''
      GROUP BY from_economy 
      ORDER BY count DESC 
      LIMIT 1;
    `);
    if (topSrcRes.length > 0 && topSrcRes[0].values) {
      const [topEcon, topEconCount] = topSrcRes[0].values[0];
      document.getElementById('kpi-asn-top-source').textContent = `${topEcon} (${topEconCount.toLocaleString()} ASNs)`;
    }

    // Monthly ASN Trend
    const monthlyRes = state.db.exec(`
      SELECT 
        substr(transfer_date, 1, 4) || '-' || substr(transfer_date, 5, 2) AS month,
        COUNT(*) AS transfers
      FROM transfers
      WHERE resource_type = 'asn'
      GROUP BY month
      ORDER BY month ASC;
    `);

    if (monthlyRes.length > 0) {
      const mRows = monthlyRes[0].values;
      const ctx = document.getElementById('chart-monthly-asn').getContext('2d');
      if (state.charts.monthlyASN) state.charts.monthlyASN.destroy();

      state.charts.monthlyASN = new Chart(ctx, {
        type: 'line',
        data: {
          labels: mRows.map(r => r[0]),
          datasets: [{
            label: 'ASN Transfers',
            data: mRows.map(r => r[1]),
            borderColor: '#a855f7',
            backgroundColor: 'rgba(168, 85, 247, 0.15)',
            fill: true,
            tension: 0.2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { maxTicksLimit: 12 } },
            y: { title: { display: true, text: 'ASN Count' } }
          }
        }
      });
    }

    // ASN Policy Breakdown
    const policyRes = state.db.exec(`
      SELECT 
        COALESCE(NULLIF(transfer_type, ''), 'Unknown') AS policy,
        COUNT(*) AS count
      FROM transfers
      WHERE resource_type = 'asn'
      GROUP BY policy;
    `);

    if (policyRes.length > 0) {
      const pRows = policyRes[0].values;
      const ctx = document.getElementById('chart-type-asn').getContext('2d');
      if (state.charts.typeASN) state.charts.typeASN.destroy();

      state.charts.typeASN = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: pRows.map(r => r[0]),
          datasets: [{
            data: pRows.map(r => r[1]),
            backgroundColor: ['#38bdf8', '#a855f7', '#f59e0b', '#94a3b8']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'right' } }
        }
      });
    }

  } catch (e) {
    console.error('ASN analytics error:', e);
  }
}

// --------------------------------------------------------------------------
// Raw Records Explorer
// --------------------------------------------------------------------------
function setupRecordsExplorer() {
  document.getElementById('btn-records-search').addEventListener('click', () => {
    state.records.page = 1;
    queryRecords();
  });

  document.getElementById('records-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.records.page = 1;
      queryRecords();
    }
  });

  document.getElementById('records-limit').addEventListener('change', () => {
    state.records.page = 1;
    queryRecords();
  });

  document.getElementById('btn-records-prev').addEventListener('click', () => {
    if (state.records.page > 1) {
      state.records.page--;
      queryRecords();
    }
  });

  document.getElementById('btn-records-next').addEventListener('click', () => {
    const maxPage = Math.ceil(state.records.totalCount / state.records.pageSize);
    if (state.records.page < maxPage) {
      state.records.page++;
      queryRecords();
    }
  });

  document.getElementById('btn-export-records-csv').addEventListener('click', exportRecordsCsv);
}

function queryRecords() {
  if (!state.db) return;

  const keyword = document.getElementById('records-search').value.trim();
  const rType = document.getElementById('records-resource-type').value;
  const policy = document.getElementById('records-policy').value;
  const limit = parseInt(document.getElementById('records-limit').value, 10) || 50;
  state.records.pageSize = limit;

  const conditions = [];

  if (rType !== 'all') {
    conditions.push(`resource_type = '${rType}'`);
  }
  if (policy !== 'all') {
    conditions.push(`LOWER(transfer_type) = '${policy.toLowerCase()}'`);
  }
  if (keyword) {
    const escaped = keyword.replace(/'/g, "''");
    conditions.push(`(
      resource LIKE '%${escaped}%' OR 
      from_organisation LIKE '%${escaped}%' OR 
      to_organisation LIKE '%${escaped}%' OR 
      from_economy LIKE '%${escaped}%' OR 
      to_economy LIKE '%${escaped}%'
    )`);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (state.records.page - 1) * state.records.pageSize;

  try {
    // Count total
    const countRes = state.db.exec(`SELECT COUNT(*) FROM transfers ${whereSql};`);
    state.records.totalCount = countRes[0]?.values[0][0] || 0;

    // Fetch page rows
    const dataRes = state.db.exec(`
      SELECT 
        id, resource_type, resource, from_organisation, from_economy, from_rir,
        to_organisation, to_economy, to_rir, transfer_date, transfer_type
      FROM transfers
      ${whereSql}
      ORDER BY transfer_date DESC, id DESC
      LIMIT ${limit} OFFSET ${offset};
    `);

    state.records.currentRows = dataRes.length > 0 ? dataRes[0].values : [];
    renderRecordsTable();
  } catch (e) {
    console.error('Records query error:', e);
  }
}

function renderRecordsTable() {
  const tbody = document.querySelector('#table-records tbody');
  const countInfo = document.getElementById('records-count-info');
  const pageIndicator = document.getElementById('records-page-indicator');
  const prevBtn = document.getElementById('btn-records-prev');
  const nextBtn = document.getElementById('btn-records-next');

  countInfo.textContent = state.records.totalCount.toLocaleString();

  const maxPage = Math.max(1, Math.ceil(state.records.totalCount / state.records.pageSize));
  pageIndicator.textContent = `Page ${state.records.page} of ${maxPage}`;

  prevBtn.disabled = state.records.page <= 1;
  nextBtn.disabled = state.records.page >= maxPage;

  if (state.records.currentRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding:2rem; color:var(--text-muted);">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = state.records.currentRows.map(r => {
    const [id, rType, resource, fromOrg, fromEcon, fromRir, toOrg, toEcon, toRir, date, type] = r;
    const formattedDate = date && date.length === 8 ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}` : (date || '-');

    let typeTag = `<span class="tag">${esc(type || '-')}</span>`;
    const tLower = (type || '').toLowerCase();
    if (tLower === 'unused') typeTag = `<span class="tag tag-unused">Market</span>`;
    else if (tLower === 'm&a') typeTag = `<span class="tag tag-ma">M&A</span>`;
    else if (tLower === 'hrt') typeTag = `<span class="tag tag-hrt">HRT</span>`;

    return `
      <tr>
        <td style="color:var(--text-muted);">${esc(id)}</td>
        <td><strong>${esc(String(rType || '').toUpperCase())}</strong></td>
        <td><code>${esc(resource)}</code></td>
        <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis;" title="${esc(fromOrg)}">${esc(fromOrg || '-')}</td>
        <td class="text-center"><code>${esc(fromEcon || '-')}</code></td>
        <td class="text-center">${esc(fromRir || '-')}</td>
        <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis;" title="${esc(toOrg)}">${esc(toOrg || '-')}</td>
        <td class="text-center"><code>${esc(toEcon || '-')}</code></td>
        <td class="text-center">${esc(toRir || '-')}</td>
        <td>${esc(formattedDate)}</td>
        <td>${typeTag}</td>
      </tr>
    `;
  }).join('');
}

// --------------------------------------------------------------------------
// SQL Query Sandbox
// --------------------------------------------------------------------------
function setupSqlSandbox() {
  const editor = document.getElementById('sql-editor');
  const runBtn = document.getElementById('btn-run-sql');
  const formatBtn = document.getElementById('btn-format-sql');
  const clearBtn = document.getElementById('btn-clear-sql');
  const presetBtns = document.querySelectorAll('.sql-preset-btn');

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const key = btn.getAttribute('data-preset');
      loadPresetQuery(key);
    });
  });

  runBtn.addEventListener('click', executeSqlQuery);
  formatBtn.addEventListener('click', formatSqlQuery);
  clearBtn.addEventListener('click', () => {
    editor.value = '';
    editor.focus();
  });

  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      executeSqlQuery();
    }
  });

  document.getElementById('btn-export-sql-csv').addEventListener('click', exportSqlResultCsv);
  document.getElementById('btn-export-sql-json').addEventListener('click', exportSqlResultJson);
}

function loadPresetQuery(key) {
  const query = SQL_PRESETS[key];
  if (query) {
    document.getElementById('sql-editor').value = query;
    executeSqlQuery();
  }
}

function executeSqlQuery() {
  if (!state.db) {
    showSqlError('Database is not loaded yet.');
    return;
  }

  const query = document.getElementById('sql-editor').value.trim();
  if (!query) {
    showSqlError('Please enter an SQL query.');
    return;
  }

  hideSqlError();
  const timeMeta = document.getElementById('sql-time-meta');
  const rowCountMeta = document.getElementById('sql-row-count');

  const startTime = performance.now();
  try {
    const results = state.db.exec(query);
    const elapsed = (performance.now() - startTime).toFixed(2);

    if (results.length === 0) {
      state.lastSqlResult = null;
      timeMeta.textContent = `Executed in ${elapsed} ms`;
      rowCountMeta.textContent = '0 rows returned';
      renderSqlResultTable([], []);
      return;
    }

    const { columns, values } = results[0];
    state.lastSqlResult = { columns, values, query };

    timeMeta.textContent = `Executed in ${elapsed} ms`;
    rowCountMeta.textContent = `${values.length.toLocaleString()} rows returned`;

    renderSqlResultTable(columns, values);

  } catch (err) {
    const elapsed = (performance.now() - startTime).toFixed(2);
    timeMeta.textContent = `Failed after ${elapsed} ms`;
    showSqlError(err.message || String(err));
  }
}

function formatSqlQuery() {
  const editor = document.getElementById('sql-editor');
  let q = editor.value.trim();
  if (!q) return;

  const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'UNION', 'VALUES', 'INSERT INTO', 'CREATE TABLE', 'DROP TABLE'];
  keywords.forEach(kw => {
    const regex = new RegExp(`\\b${kw}\\b`, 'gi');
    q = q.replace(regex, kw);
  });
  editor.value = q;
}

function showSqlError(msg) {
  const box = document.getElementById('sql-error');
  box.textContent = msg;
  box.style.display = 'block';
}

function hideSqlError() {
  const box = document.getElementById('sql-error');
  box.textContent = '';
  box.style.display = 'none';
}

function renderSqlResultTable(columns, values) {
  const table = document.getElementById('table-sql-results');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  if (columns.length === 0) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td style="text-align:center; padding:2rem; color:var(--text-muted);">No results to display.</td></tr>';
    return;
  }

  thead.innerHTML = `<tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;

  const maxDisplayRows = 500;
  const displayValues = values.slice(0, maxDisplayRows);

  tbody.innerHTML = displayValues.map(row => `
    <tr>
      ${row.map(val => {
        if (val === null || val === undefined) return '<td style="color:var(--text-muted);">NULL</td>';
        if (typeof val === 'number') return `<td class="text-right">${val.toLocaleString()}</td>`;
        return `<td>${esc(val)}</td>`;
      }).join('')}
    </tr>
  `).join('');
}

// --------------------------------------------------------------------------
// Modal & File Upload / Drop Handling
// --------------------------------------------------------------------------
function setupModalAndDropZone() {
  const modal = document.getElementById('db-modal');
  const openBtn = document.getElementById('btn-db-manage');
  const closeBtn = document.getElementById('btn-modal-close');
  const doneBtn = document.getElementById('btn-modal-done');
  const reloadBtn = document.getElementById('btn-reload-default-db');
  const fileInput = document.getElementById('db-file-input');
  const browseBtn = document.getElementById('btn-browse-file');
  const dropZone = document.getElementById('file-drop-zone');

  openBtn.addEventListener('click', () => modal.classList.add('active'));
  closeBtn.addEventListener('click', () => modal.classList.remove('active'));
  doneBtn.addEventListener('click', () => modal.classList.remove('active'));

  reloadBtn.addEventListener('click', async () => {
    await loadDefaultDatabase();
    modal.classList.remove('active');
  });

  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleUserFile(e.target.files[0]);
      modal.classList.remove('active');
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUserFile(e.dataTransfer.files[0]);
      modal.classList.remove('active');
    }
  });
}

async function handleUserFile(file) {
  setDbStatus('loading', `Loading ${file.name}...`);

  try {
    if (file.name.endsWith('.db') || file.name.endsWith('.sqlite') || file.name.endsWith('.sqlite3')) {
      const buf = await file.arrayBuffer();
      state.db = new state.SQL.Database(new Uint8Array(buf));
      
      const countRes = state.db.exec("SELECT COUNT(*) FROM transfers;");
      const count = countRes[0]?.values[0][0] || 0;
      setDbStatus('ready', `${file.name} (${count.toLocaleString()} rows)`);
      
      populateEconomyDropdown();
      loadIPv4Analytics();
    } else {
      // Raw pipe-delimited APNIC log file
      setDbStatus('loading', 'Parsing transfer records...');
      const text = await file.text();
      await parseAndLoadRawText(text, file.name);
    }
  } catch (err) {
    console.error('Error handling user file:', err);
    setDbStatus('error', `Failed to load file: ${err.message}`);
  }
}

async function parseAndLoadRawText(text, fileName) {
  state.db = new state.SQL.Database();

  state.db.run(`
    CREATE TABLE transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_type TEXT NOT NULL,
      resource TEXT NOT NULL,
      from_organisation TEXT,
      from_economy TEXT,
      from_rir TEXT,
      previous_delegation_date TEXT,
      to_organisation TEXT,
      to_economy TEXT,
      to_rir TEXT,
      transfer_date TEXT,
      transfer_type TEXT
    );
  `);

  const lines = text.split(/\r?\n/);
  state.db.run("BEGIN TRANSACTION;");

  const stmt = state.db.prepare(`
    INSERT INTO transfers (
      resource_type, resource, from_organisation, from_economy, from_rir,
      previous_delegation_date, to_organisation, to_economy, to_rir, transfer_date, transfer_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  let count = 0;
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map(p => p.trim());
    if (parts[0].toLowerCase() === 'resource_type') continue; // Header
    while (parts.length < 11) parts.push('');
    stmt.run(parts.slice(0, 11));
    count++;
  }

  stmt.free();
  state.db.run("COMMIT;");

  // Create helpful indexes
  state.db.run("CREATE INDEX idx_transfers_type ON transfers(resource_type);");
  state.db.run("CREATE INDEX idx_transfers_date ON transfers(transfer_date);");

  setDbStatus('ready', `${fileName} (${count.toLocaleString()} rows ingested)`);
  populateEconomyDropdown();
  loadIPv4Analytics();
}

// --------------------------------------------------------------------------
// Export Helpers
// --------------------------------------------------------------------------
function downloadBlob(content, filename, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportIPv4Csv() {
  if (!state.ipv4Data || state.ipv4Data.length === 0) return;
  const headers = ['Month', 'Transfers', 'Total IPs', '/24 Equiv', 'Market IPs', 'M&A IPs', 'HRT IPs', 'Intra IPs', 'Inbound IPs', 'Outbound IPs', 'Cumul IPs'];
  const rows = state.ipv4Data.map(d => [
    d.month,
    d.transfers,
    d.total_ips,
    Math.round(d.slash24_equiv),
    d.unused_ips,
    d.ma_ips,
    d.hrt_ips,
    d.intra_ips,
    d.inbound_ips,
    d.outbound_ips,
    d.cumul_ips
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadBlob(csv, 'apnic_ipv4_monthly_transfers.csv', 'text/csv;charset=utf-8;');
}

function exportIPv4Json() {
  if (!state.ipv4Data || state.ipv4Data.length === 0) return;
  const json = JSON.stringify(state.ipv4Data, null, 2);
  downloadBlob(json, 'apnic_ipv4_monthly_transfers.json', 'application/json');
}

function exportRecordsCsv() {
  if (!state.records.currentRows || state.records.currentRows.length === 0) return;
  const headers = ['ID', 'Type', 'Resource', 'From Org', 'From Econ', 'From RIR', 'To Org', 'To Econ', 'To RIR', 'Date', 'Policy'];
  const rows = state.records.currentRows.map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  downloadBlob(csv, 'apnic_transfer_records.csv', 'text/csv;charset=utf-8;');
}

function exportSqlResultCsv() {
  if (!state.lastSqlResult) return;
  const { columns, values } = state.lastSqlResult;
  const csv = [
    columns.join(','),
    ...values.map(row => row.map(c => `"${String(c === null ? '' : c).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  downloadBlob(csv, 'sql_query_result.csv', 'text/csv;charset=utf-8;');
}

function exportSqlResultJson() {
  if (!state.lastSqlResult) return;
  const { columns, values } = state.lastSqlResult;
  const objects = values.map(row => {
    const obj = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  });
  downloadBlob(JSON.stringify(objects, null, 2), 'sql_query_result.json', 'application/json');
}
