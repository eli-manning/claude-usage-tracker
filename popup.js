// popup.js

const HISTORY_KEY = 'usageHistory';
const LATEST_KEY = 'latestUsage';
const BADGE_PREF_KEY = 'badgePreference'; // 'weekly' or 'session'

let chartType = 'weekly';
let chartInstance = null;
let badgePref = 'weekly'; // default

function getColor(pct) {
  if (pct === null) return 'var(--accent)';
  if (pct >= 90) return 'var(--red)';
  if (pct >= 70) return 'var(--yellow)';
  return 'var(--accent)';
}

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function resolveColor(pct) {
  if (pct === null) return getCssVar('--accent') || '#CC785C';
  if (pct >= 90) return getCssVar('--red') || '#c85c5c';
  if (pct >= 70) return getCssVar('--yellow') || '#d4a843';
  return getCssVar('--accent') || '#CC785C';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function updateBadgeToggleUI() {
  document.querySelectorAll('.badge-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pref === badgePref);
  });
  // Highlight the active card
  document.getElementById('sessionCard')?.classList.toggle('badge-active', badgePref === 'session');
  document.getElementById('weeklyCard')?.classList.toggle('badge-active', badgePref === 'weekly');
}

async function setBadgePref(pref) {
  badgePref = pref;
  await chrome.storage.local.set({ [BADGE_PREF_KEY]: pref });
  updateBadgeToggleUI();

  // Tell background to update the badge immediately
  const result = await chrome.storage.local.get([LATEST_KEY]);
  const latest = result[LATEST_KEY];
  if (latest) {
    const val = pref === 'session' ? latest.session : latest.weekly;
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', value: val });
  }
}

function renderUsage(latest) {
  const sVal = latest.session;
  const wVal = latest.weekly;

  // Session card
  document.getElementById('sessionVal').textContent = sVal !== null ? sVal : '—';
  const sBar = document.getElementById('sessionBar');
  sBar.style.setProperty('--pct', (sVal || 0) + '%');
  const sCard = document.getElementById('sessionCard');
  sCard.style.setProperty('--bar-color', getColor(sVal));
  if (latest.sessionReset) document.getElementById('sessionReset').textContent = latest.sessionReset;

  // Weekly card
  document.getElementById('weeklyVal').textContent = wVal !== null ? wVal : '—';
  const wBar = document.getElementById('weeklyBar');
  wBar.style.setProperty('--pct', (wVal || 0) + '%');
  const wCard = document.getElementById('weeklyCard');
  wCard.style.setProperty('--bar-color', getColor(wVal));
  if (latest.weeklyReset) document.getElementById('weeklyReset').textContent = latest.weeklyReset;

  document.getElementById('lastUpdated').textContent = 'updated ' + timeAgo(latest.timestamp);
}

function renderChart(history) {
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');

  const points = history.slice(-24);
  const labels = points.map(p => {
    const d = new Date(p.timestamp);
    return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  });
  const values = points.map(p => chartType === 'weekly' ? p.weekly : p.session);
  const latestVal = values[values.length - 1];
  const color = resolveColor(latestVal);

  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = values;
    chartInstance.data.datasets[0].borderColor = color;
    chartInstance.update();
    return;
  }

  drawChart(canvas, ctx, labels, values, color);
}

function drawChart(canvas, ctx, labels, values, color) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 300;
  const H = 80;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const padL = 8, padR = 8, padT = 6, padB = 18;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  ctx.clearRect(0, 0, W, H);

  const filtered = values.filter(v => v !== null);
  if (filtered.length < 2) {
    ctx.fillStyle = '#6b6560';
    ctx.font = '11px DM Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Not enough data yet', W / 2, H / 2);
    return;
  }

  const max = Math.max(100, ...filtered);
  const min = 0;
  const range = max - min || 1;
  const xStep = chartW / (values.length - 1 || 1);

  function xAt(i) { return padL + i * xStep; }
  function yAt(v) { return padT + chartH - ((v - min) / range) * chartH; }

  [25, 50, 75, 100].forEach(g => {
    const y = yAt(g);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  const gradient = ctx.createLinearGradient(0, padT, 0, padT + chartH);
  gradient.addColorStop(0, color + '44');
  gradient.addColorStop(1, color + '00');

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = xAt(i);
    const y = v !== null ? yAt(v) : yAt(0);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xAt(values.length - 1), padT + chartH);
  ctx.lineTo(xAt(0), padT + chartH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  values.forEach((v, i) => {
    const x = xAt(i);
    const y = v !== null ? yAt(v) : null;
    if (y === null) return;
    if (i === 0 || values[i - 1] === null) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  [0, values.length - 1].forEach(i => {
    const v = values[i];
    if (v === null) return;
    ctx.beginPath();
    ctx.arc(xAt(i), yAt(v), 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  ctx.fillStyle = '#6b6560';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  if (labels[0]) ctx.fillText(labels[0], padL, H - 2);
  if (labels[labels.length - 1]) {
    ctx.textAlign = 'right';
    ctx.fillText(labels[labels.length - 1], padL + chartW, H - 2);
  }

  chartInstance = { data: { labels, datasets: [{ data: values, borderColor: color }] }, update: () => { chartInstance = null; } };
}

async function loadData() {
  const result = await chrome.storage.local.get([HISTORY_KEY, LATEST_KEY, BADGE_PREF_KEY]);
  const latest = result[LATEST_KEY];
  const history = result[HISTORY_KEY] || [];

  // Load saved badge preference
  if (result[BADGE_PREF_KEY]) {
    badgePref = result[BADGE_PREF_KEY];
  }
  updateBadgeToggleUI();

  if (!latest) {
    document.getElementById('noData').style.display = 'block';
    document.getElementById('mainContent').style.display = 'none';
    return;
  }

  document.getElementById('noData').style.display = 'none';
  document.getElementById('mainContent').style.display = 'block';

  renderUsage(latest);
  renderChart(history.length > 0 ? history : [latest]);
}

// Badge toggle buttons
document.querySelectorAll('.badge-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => setBadgePref(btn.dataset.pref));
});

// Chart tab switching
document.querySelectorAll('.chart-tab').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chartType = btn.dataset.type;
    chartInstance = null;

    const result = await chrome.storage.local.get([HISTORY_KEY, LATEST_KEY]);
    const history = result[HISTORY_KEY] || [];
    const latest = result[LATEST_KEY];
    renderChart(history.length > 0 ? history : (latest ? [latest] : []));
  });
});

// Refresh button
document.getElementById('refreshBtn').addEventListener('click', async () => {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');

  chrome.tabs.create({ url: 'https://claude.ai/settings/usage', active: false }, (tab) => {
    setTimeout(() => {
      chrome.tabs.remove(tab.id).catch(() => {});
      setTimeout(async () => {
        btn.classList.remove('spinning');
        await loadData();
      }, 2000);
    }, 8000);
  });
});

// Initial load
loadData();
