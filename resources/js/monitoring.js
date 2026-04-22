/**
 * Monitoring tab — real-time JMX polling with charts.
 * Polls /status servlet directly; no exist-api dependency.
 *
 * Layout and data match monex's monitoring page (Wolfgang Meier's design).
 */

import { formatBytes } from './dashboard.js';

// ── Rolling data buffers for charts ────────────

const MAX_POINTS = 100;
const memoryData = { used: [], committed: [] };
const brokerData = { active: [], total: [] };
const cpuData = { process: [], system: [] };

let refreshInterval = null;
let jmxToken = '';
let paused = false;
let pollPeriodMs = 3000;

// ── Namespace-aware XML helpers ────────────────

const JMX_NS = 'http://exist-db.org/jmx';

function jmxEl(parent, localName) {
    if (!parent) return null;
    const els = parent.getElementsByTagNameNS(JMX_NS, localName);
    if (els.length > 0) return els[0];
    const els2 = parent.getElementsByTagName(localName);
    return els2.length > 0 ? els2[0] : null;
}

function jmxEls(parent, localName) {
    if (!parent) return [];
    const els = parent.getElementsByTagNameNS(JMX_NS, localName);
    if (els.length > 0) return Array.from(els);
    return Array.from(parent.getElementsByTagName(localName));
}

function jmxText(parent, tag) {
    const el = jmxEl(parent, tag);
    return el ? el.textContent.trim() : '';
}

function jmxInt(parent, tag) {
    return parseInt(jmxText(parent, tag)) || 0;
}

function jmxFloat(parent, tag) {
    return parseFloat(jmxText(parent, tag)) || 0;
}

// ── Canvas chart ──────────────────────────────
//
// Flot-style time-series chart matching monex's Java Memory chart:
// - Solid border frame around plot area
// - Vertical + horizontal grid lines
// - Legend inside chart at top-right with colored squares
// - Timestamp x-axis that scrolls forward (oldest data falls off left)
// - Filled area under lines
// - Y-axis with nice round numbers

function niceYTicks(max, targetTicks) {
    if (max <= 0) return { step: 1, count: 1, max: 1 };
    const rough = max / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const residual = rough / mag;
    let nice;
    if (residual <= 1.5) nice = 1;
    else if (residual <= 3.5) nice = 2.5;
    else if (residual <= 7.5) nice = 5;
    else nice = 10;
    const step = nice * mag;
    const count = Math.ceil(max / step);
    return { step, count, max: step * count };
}

function drawLineChart(canvasId, datasets, opts = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;
    const pad = { top: 6, right: 6, bottom: 22, left: 46 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    // ── Time range ──
    // Use actual timestamps; the x-axis shows real wall-clock time.
    // As data accumulates, older points scroll off the left.
    let tMin = Infinity, tMax = -Infinity;
    for (const ds of datasets) {
        for (const [t] of ds.data) {
            if (t < tMin) tMin = t;
            if (t > tMax) tMax = t;
        }
    }
    if (tMin === Infinity) return;
    const tRange = Math.max(tMax - tMin, 10000);

    // ── Y range with nice ticks ──
    let rawMax = opts.yMax || 0;
    if (!rawMax) {
        for (const ds of datasets) {
            for (const [, v] of ds.data) { if (v > rawMax) rawMax = v; }
        }
    }
    if (rawMax === 0) rawMax = 1;
    const yTicks = niceYTicks(rawMax, 5);
    const yMax = yTicks.max;

    // ── Plot border frame ──
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);

    // ── Horizontal grid lines + Y labels ──
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= yTicks.count; i++) {
        const val = i * yTicks.step;
        if (val > yMax) break;
        const y = pad.top + plotH - (plotH * val / yMax);
        // Grid line
        ctx.strokeStyle = '#e8e8e8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left + 1, y);
        ctx.lineTo(pad.left + plotW - 1, y);
        ctx.stroke();
        // Label
        ctx.fillStyle = '#666';
        const label = opts.formatY ? opts.formatY(val) : Math.round(val);
        ctx.fillText(label, pad.left - 4, y + 4);
    }

    // ── Vertical grid lines + X time labels ──
    // Place ticks at round 20-second intervals (like monex)
    const tickIntervalMs = 20000;
    const firstTick = Math.ceil(tMin / tickIntervalMs) * tickIntervalMs;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let t = firstTick; t <= tMax; t += tickIntervalMs) {
        const x = pad.left + plotW * ((t - tMin) / tRange);
        if (x < pad.left + 20 || x > pad.left + plotW - 10) continue;
        // Vertical grid line
        ctx.strokeStyle = '#e8e8e8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, pad.top + 1);
        ctx.lineTo(x, pad.top + plotH - 1);
        ctx.stroke();
        // Time label
        const d = new Date(t);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        ctx.fillStyle = '#666';
        ctx.fillText(`${hh}:${mm}:${ss}`, x, H - 4);
    }

    // ── Plot filled areas + lines ──
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, plotW, plotH);
    ctx.clip();

    for (const ds of datasets) {
        if (ds.data.length < 1) continue;

        // Filled area
        ctx.beginPath();
        let started = false;
        for (const [t, v] of ds.data) {
            const x = pad.left + plotW * ((t - tMin) / tRange);
            const y = pad.top + plotH - (plotH * Math.min(v, yMax) / yMax);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        const lastT = ds.data[ds.data.length - 1][0];
        const firstT = ds.data[0][0];
        ctx.lineTo(pad.left + plotW * ((lastT - tMin) / tRange), pad.top + plotH);
        ctx.lineTo(pad.left + plotW * ((firstT - tMin) / tRange), pad.top + plotH);
        ctx.closePath();
        ctx.fillStyle = ds.fillColor || (ds.color + '40');
        ctx.fill();

        // Line
        ctx.beginPath();
        started = false;
        for (const [t, v] of ds.data) {
            const x = pad.left + plotW * ((t - tMin) / tRange);
            const y = pad.top + plotH - (plotH * Math.min(v, yMax) / yMax);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = ds.color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }

    ctx.restore();

    // ── Legend (inside plot, top-right, matching monex) ──
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    // Measure widest label to position the legend block
    let maxLabelW = 0;
    for (const ds of datasets) {
        const w = ctx.measureText(ds.label).width;
        if (w > maxLabelW) maxLabelW = w;
    }
    const legendBlockW = 12 + 6 + maxLabelW; // square + gap + text
    const legendRight = pad.left + plotW - 6;
    const legendLeft = legendRight - legendBlockW;
    let legendY = pad.top + 14;
    for (const ds of datasets) {
        // Colored square (filled, matching the area color)
        ctx.fillStyle = ds.fillColor || (ds.color + '80');
        ctx.fillRect(legendLeft, legendY - 8, 10, 10);
        ctx.strokeStyle = ds.color;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(legendLeft, legendY - 8, 10, 10);
        // Label text
        ctx.fillStyle = '#444';
        ctx.fillText(ds.label, legendLeft + 14, legendY);
        legendY += 16;
    }
}

function pushRolling(arr, time, value) {
    arr.push([time, value]);
    if (arr.length > MAX_POINTS) arr.shift();
}

// ── JMX status polling ─────────────────────────

function statusUrl() {
    const base = location.pathname.replace(/^(.*?)\/(apps\/)?dashboard\/.*$/, '$1');
    const cats = ['instances', 'processes', 'locking', 'memory', 'caches', 'system', 'operatingsystem'];
    return `${base}/status?${cats.map(c => 'c=' + c).join('&')}&token=${encodeURIComponent(jmxToken)}`;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

async function pollJmx() {
    if (!jmxToken || paused) return;
    try {
        const resp = await fetch(statusUrl(), { credentials: 'include' });
        if (!resp.ok) return;
        const text = await resp.text();
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        updateStatCards(xml);
        updateSystemInfo(xml);
        updateMemory(xml);
        updateCpu(xml);
        updateBrokers(xml);
        updateQueries(xml);
        updateJobs(xml);
        updateCaches(xml);
        updateThreads(xml);
        updateWaitingThreads(xml);
        updateHistory(xml);
        updateScheduledJobs(xml);
    } catch { /* polling failure not fatal */ }
}

// ── Stat cards (top row) ──────────────────────

function updateStatCards(xml) {
    const db = jmxEl(xml, 'Database');
    if (!db) return;
    setText('stat-brokers', jmxText(db, 'ActiveBrokers') + ' of ' + jmxText(db, 'TotalBrokers'));

    const uptimeMs = jmxInt(db, 'Uptime');
    if (uptimeMs > 0) {
        const s = Math.floor(uptimeMs / 1000);
        const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
        const parts = [];
        if (d > 0) parts.push(d + 'd');
        parts.push(String(h).padStart(2, '0') + 'h');
        parts.push(String(m).padStart(2, '0') + 'm');
        setText('stat-uptime', parts.join(' '));
    }

    const rq = jmxEl(xml, 'RunningQueries');
    const queryRows = rq ? jmxEls(rq, 'row') : [];
    setText('stat-queries', String(queryRows.length));

    const lockTable = jmxEl(xml, 'LockTable');
    const attempting = lockTable ? jmxEls(lockTable, 'Attempting') : [];
    const waitingRows = attempting.length > 0 ? jmxEls(attempting[0], 'row') : [];
    setText('stat-waiting', String(waitingRows.length));
}

// ── System Information ────────────────────────

function updateSystemInfo(xml) {
    const sys = jmxEl(xml, 'SystemInfo');
    const db = jmxEl(xml, 'Database');
    const os = jmxEl(xml, 'OperatingSystemImpl') || jmxEl(xml, 'UnixOperatingSystem');
    const tbody = document.getElementById('sysinfo-body');
    if (!tbody) return;

    const rows = [];
    if (sys) {
        const name = jmxText(sys, 'ProductName') || 'eXist';
        rows.push(infoRow(name + ' Version:', jmxText(sys, 'ProductVersion')));
        rows.push(infoRow(name + ' Build:', jmxText(sys, 'ProductBuild')));
        rows.push(infoRow('Operating System:', jmxText(sys, 'OperatingSystem')));
    }
    // Java version from system properties if available
    const javaVer = jmxText(xml, 'JavaVersion');
    if (javaVer) {
        rows.push(infoRow('Java Version:', javaVer));
    }
    if (sys) {
        rows.push(infoRow('Default Encoding:', jmxText(sys, 'DefaultEncoding')));
    }
    if (db) {
        rows.push(infoRow('Instance ID:', jmxText(db, 'InstanceId')));
    }
    if (os) {
        const sysCpu = jmxFloat(os, 'SystemCpuLoad');
        const procCpu = jmxFloat(os, 'ProcessCpuLoad');
        rows.push(infoRow('System CPU Load:', sysCpu.toPrecision(6)));
        rows.push(infoRow('Process CPU Load:', procCpu.toPrecision(6)));
        const freeMem = jmxText(os, 'FreePhysicalMemorySize');
        const totalMem = jmxText(os, 'TotalPhysicalMemorySize');
        if (totalMem) {
            rows.push(infoRow('Free Physical Memory:', freeMem));
            rows.push(infoRow('Total Physical Memory:', totalMem));
        }
    }
    tbody.innerHTML = rows.join('');
}

function infoRow(label, value) {
    return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value || '--')}</td></tr>`;
}

// ── Memory ────────────────────────────────────

function updateMemory(xml) {
    const heap = jmxEl(xml, 'HeapMemoryUsage');
    if (!heap) return;
    const used = jmxInt(heap, 'used');
    const committed = jmxInt(heap, 'committed');
    const max = jmxInt(heap, 'max');
    const now = Date.now();

    pushRolling(memoryData.used, now, used / 1048576);
    pushRolling(memoryData.committed, now, committed / 1048576);

    // Text values
    setText('mem-used-val', formatBytes(used));
    setText('mem-committed-val', formatBytes(committed));
    setText('mem-max-val', formatBytes(max));

    // Progress bars (like monex)
    const usedPct = max > 0 ? Math.round(used / max * 100) : 0;
    const committedPct = max > 0 ? Math.round(committed / max * 100) : 0;
    const usedBar = document.getElementById('mem-used-bar');
    const committedBar = document.getElementById('mem-committed-bar');
    if (usedBar) usedBar.style.width = usedPct + '%';
    if (committedBar) committedBar.style.width = committedPct + '%';
    const usedMB = Math.floor(used / 1048576);
    const committedMB = Math.floor(committed / 1048576);
    const maxMB = Math.floor(max / 1048576);
    setText('mem-used-pct', `${usedMB} / ${maxMB} M`);
    setText('mem-committed-pct', `${committedMB} / ${maxMB} M`);

    // Chart
    drawLineChart('memory-chart', [
        { label: 'Used memory (mb)', data: memoryData.used, color: '#c4a839', fillColor: 'rgba(196,168,57,0.35)' },
        { label: 'Committed memory (mb)', data: memoryData.committed, color: '#7fb8d8', fillColor: 'rgba(127,184,216,0.35)' },
    ], {
        yMax: max / 1048576,
        formatY: v => Math.round(v),
    });
}

// ── CPU ───────────────────────────────────────

function updateCpu(xml) {
    const os = jmxEl(xml, 'OperatingSystemImpl') || jmxEl(xml, 'UnixOperatingSystem');
    const processCpu = os ? jmxFloat(os, 'ProcessCpuLoad') : 0;
    const systemCpu = os ? jmxFloat(os, 'SystemCpuLoad') : 0;
    const now = Date.now();

    pushRolling(cpuData.process, now, processCpu * 100);
    pushRolling(cpuData.system, now, systemCpu * 100);

    setText('cpu-process', (processCpu * 100).toFixed(1) + '%');
    setText('cpu-system', (systemCpu * 100).toFixed(1) + '%');

    drawLineChart('cpu-chart', [
        { label: 'Process', data: cpuData.process, color: '#2e7d32' },
        { label: 'System', data: cpuData.system, color: '#a5d6a7' },
    ], {
        yMax: 100,
        formatY: v => Math.round(v) + '%',
    });
}

// ── Brokers (time-series chart like monex) ────

function updateBrokers(xml) {
    const db = jmxEl(xml, 'Database');
    if (!db) return;
    const active = jmxInt(db, 'ActiveBrokers');
    const total = jmxInt(db, 'TotalBrokers');
    const maxBrokers = jmxInt(db, 'MaxBrokers') || 20;
    const now = Date.now();

    pushRolling(brokerData.active, now, active);
    pushRolling(brokerData.total, now, total);

    drawLineChart('brokers-chart', [
        { label: 'Active Brokers', data: brokerData.active, color: '#c4a839', fillColor: 'rgba(196,168,57,0.35)' },
        { label: 'Total Brokers', data: brokerData.total, color: '#7fb8d8', fillColor: 'rgba(127,184,216,0.35)' },
    ], {
        yMax: maxBrokers,
        formatY: v => Math.round(v),
    });
}

// ── Running Queries ───────────────────────────

function updateQueries(xml) {
    const rows = jmxEls(xml, 'RunningQueries').flatMap(rq => jmxEls(rq, 'row'));
    const tbody = document.getElementById('queries-body');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No running queries</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    rows.forEach(row => {
        const source = jmxText(row, 'sourceKey') || jmxText(row, 'sourceType') || '(unknown)';
        const id = jmxText(row, 'id') || jmxText(row, 'thread') || '';
        const uri = jmxText(row, 'requestURI') || '';
        const terminating = jmxText(row, 'terminating');
        const statusLabel = terminating === 'true' ? 'terminating' : 'running';
        const statusCls = terminating === 'true' ? 'badge-warning' : 'badge-success';
        const tr = document.createElement('tr');
        tr.innerHTML =
            `<td>${escapeHtml(id)}</td>` +
            `<td class="truncate" title="${escapeHtml(source)}">${escapeHtml(shortSource(source))}</td>` +
            `<td class="truncate" title="${escapeHtml(uri)}">${escapeHtml(uri)}</td>` +
            `<td><span class="badge ${statusCls}">${statusLabel}</span></td>` +
            `<td>${id ? '<button class="btn btn-sm btn-danger kill-query" data-id="' + escapeHtml(id) + '">Kill</button>' : ''}</td>`;
        tbody.appendChild(tr);
    });
}

// ── Running Jobs ──────────────────────────────

function updateJobs(xml) {
    const jobsEl = jmxEl(xml, 'RunningJobs');
    const rows = jobsEl ? jmxEls(jobsEl, 'row') : [];
    const tbody = document.getElementById('jobs-body');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No running jobs</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    rows.forEach(row => {
        const action = jmxText(row, 'action') || '(unknown)';
        const id = jmxText(row, 'id') || '';
        const info = jmxText(row, 'info') || '';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(action)}</td><td>${escapeHtml(id)}</td><td>${escapeHtml(info)}</td>`;
        tbody.appendChild(tr);
    });
}

// ── Caches (monex-style progress bars) ────────
// Individual Cache elements are siblings of CacheManager, not children.
// Monex shows: name on left, "Size: X / Used: Y / Fails: Z / Hits: W" on right,
// progress bar below.

function updateCaches(xml) {
    const caches = jmxEls(xml, 'Cache');
    const container = document.getElementById('caches-container');
    if (!container) return;

    // Also get CacheManager for overall stats
    const cm = jmxEl(xml, 'CacheManager');

    if (caches.length === 0 && !cm) {
        container.innerHTML = '<div class="empty-state">No cache data</div>';
        return;
    }

    container.innerHTML = '';

    // Overall cache manager
    if (cm) {
        const current = jmxInt(cm, 'CurrentSize');
        const maxTotal = jmxInt(cm, 'MaxTotal');
        const pct = maxTotal > 0 ? Math.min(Math.round(current / maxTotal * 100), 100) : 0;
        container.innerHTML +=
            `<div class="cache-item">` +
            `<div class="cache-header"><span class="cache-name">Cache Manager</span>` +
            `<span class="cache-stats">Using ${current.toLocaleString()} of ${maxTotal.toLocaleString()} pages</span></div>` +
            `<div class="progress-bar-container"><div class="progress-bar cache-bar" style="width:${pct}%"></div></div>` +
            `</div>`;
    }

    // Individual caches — monex shows BTree caches in a fixed order
    const btreeCaches = caches.filter(c => jmxText(c, 'Type') === 'BTREE');
    const cacheOrder = ['dom.dbx', 'structure.dbx', 'collections.dbx', 'values.dbx'];
    const sorted = (btreeCaches.length > 0 ? btreeCaches : caches).sort((a, b) => {
        const nameA = (a.getAttribute('name') || '').match(/name=([^,]+)/)?.[1] || '';
        const nameB = (b.getAttribute('name') || '').match(/name=([^,]+)/)?.[1] || '';
        const idxA = cacheOrder.indexOf(nameA);
        const idxB = cacheOrder.indexOf(nameB);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });
    sorted.forEach(cache => {
        const name = cache.getAttribute('name') || '';
        const match = name.match(/name=([^,]+)/);
        const shortName = match ? match[1] : name;
        const type = jmxText(cache, 'Type');
        const label = shortName + (type ? ' (' + type + ')' : '');

        const size = jmxInt(cache, 'Size');
        const used = jmxInt(cache, 'Used');
        const hits = jmxInt(cache, 'Hits');
        const fails = jmxInt(cache, 'Fails');
        const pct = size > 0 ? Math.round(used / size * 100) : 0;

        container.innerHTML +=
            `<div class="cache-item">` +
            `<div class="cache-header"><span class="cache-name">${escapeHtml(label)}</span>` +
            `<span class="cache-stats">Size: ${size} / Used: ${used} / Fails: ${fails} / Hits: ${hits.toLocaleString()}</span></div>` +
            `<div class="progress-bar-container"><div class="progress-bar cache-bar" style="width:${pct}%"></div></div>` +
            `</div>`;
    });
}

// ── Active Threads ────────────────────────────

function updateThreads(xml) {
    const brokerMap = jmxEl(xml, 'ActiveBrokersMap');
    const rows = brokerMap ? jmxEls(brokerMap, 'row') : [];
    const tbody = document.getElementById('threads-body');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td class="empty-state">No active threads</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    rows.forEach(row => {
        const owner = jmxText(row, 'owner') || '(unknown)';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="truncate">${escapeHtml(owner)}</td>`;
        tbody.appendChild(tr);
    });
}

// ── Waiting Threads ───────────────────────────

function updateWaitingThreads(xml) {
    const lockTable = jmxEl(xml, 'LockTable');
    const acquired = lockTable ? jmxEls(lockTable, 'Acquired') : [];
    const rows = acquired.length > 0 ? jmxEls(acquired[0], 'row') : [];
    const tbody = document.getElementById('waiting-body');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="empty-state">No waiting threads</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    rows.forEach(row => {
        const key = jmxText(row, 'key') || '(unknown)';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="truncate">${escapeHtml(key)}</td><td>Waiting</td>`;
        tbody.appendChild(tr);
    });
}

// ── Recent Query History ──────────────────────

function updateHistory(xml) {
    const historyEl = jmxEl(xml, 'RecentQueryHistory');
    const rows = historyEl ? jmxEls(historyEl, 'row') : [];
    const tbody = document.getElementById('history-body');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No recent queries</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    const sorted = rows.sort((a, b) =>
        jmxInt(b, 'mostRecentExecutionTime') - jmxInt(a, 'mostRecentExecutionTime')
    );
    sorted.forEach(row => {
        const timeMs = jmxText(row, 'mostRecentExecutionTime');
        const timeStr = timeMs ? new Date(parseInt(timeMs)).toISOString() : '--';
        const source = jmxText(row, 'sourceKey') || '(unknown)';
        const duration = jmxText(row, 'mostRecentExecutionDuration') || '--';
        const uri = jmxText(row, 'requestURI') || '';
        const tr = document.createElement('tr');
        tr.innerHTML =
            `<td style="white-space:nowrap">${escapeHtml(timeStr)}</td>` +
            `<td class="truncate" title="${escapeHtml(source)}">${escapeHtml(shortSource(source))}</td>` +
            `<td>${duration}</td>` +
            `<td class="truncate" title="${escapeHtml(uri)}">${escapeHtml(uri)}</td>`;
        tbody.appendChild(tr);
    });
}

// ── Kill query via JMX invoke ──────────────────

function killQuery(queryId) {
    const base = location.pathname.replace(/^(.*?)\/(apps\/)?dashboard\/.*$/, '$1');
    const url = `${base}/status?operation=killQuery&mbean=org.exist.management.exist:type=ProcessReport&id=${queryId}&token=${encodeURIComponent(jmxToken)}`;
    fetch(url, { credentials: 'include' }).then(() => pollJmx());
}

// ── GC via JMX invoke ──────────────────────────

function runGC() {
    const base = location.pathname.replace(/^(.*?)\/(apps\/)?dashboard\/.*$/, '$1');
    const url = `${base}/status?operation=gc&mbean=java.lang:type=Memory&token=${encodeURIComponent(jmxToken)}`;
    fetch(url, { credentials: 'include' }).then(() => pollJmx());
}

// ── Utilities ──────────────────────────────────

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function shortSource(path) {
    if (!path) return '';
    const parts = path.split('/');
    return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : path;
}

// ── Scheduled Jobs (from JMX ScheduledJobs) ──

function updateScheduledJobs(xml) {
    const scheduledEl = jmxEl(xml, 'ScheduledJobs');
    const rows = scheduledEl ? jmxEls(scheduledEl, 'row') : [];
    const tbody = document.getElementById('scheduled-jobs-body');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No scheduled jobs</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    rows.forEach(row => {
        const name = jmxText(row, 'id') || jmxText(row, 'key') || '(unknown)';
        const action = jmxText(row, 'action') || '';
        const info = jmxText(row, 'info') || '';
        const tr = document.createElement('tr');
        tr.innerHTML =
            `<td>${escapeHtml(name)}</td>` +
            `<td>${escapeHtml(action)}</td>` +
            `<td>${escapeHtml(info)}</td>`;
        tbody.appendChild(tr);
    });
}

// ── Init ───────────────────────────────────────

function init() {
    if (!document.querySelector('.monitoring-page')) return;

    const tokenEl = document.getElementById('jmx-token');
    jmxToken = tokenEl ? tokenEl.value : '';
    if (!jmxToken) return;

    // GC button
    document.getElementById('gc-btn')?.addEventListener('click', runGC);

    // Kill query delegation
    document.getElementById('queries-body')?.addEventListener('click', e => {
        const btn = e.target.closest('.kill-query');
        if (btn) killQuery(btn.dataset.id);
    });

    // Pause / resume
    const pauseBtn = document.getElementById('pause-btn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            paused = !paused;
            pauseBtn.textContent = paused ? 'Resume' : 'Pause';
            pauseBtn.classList.toggle('btn-active', paused);
        });
    }

    // Poll interval control (range slider)
    const intervalInput = document.getElementById('poll-interval');
    const intervalLabel = document.getElementById('poll-interval-val');
    if (intervalInput) {
        intervalInput.addEventListener('input', () => {
            if (intervalLabel) intervalLabel.textContent = intervalInput.value + ' sec';
        });
        intervalInput.addEventListener('change', () => {
            const val = parseInt(intervalInput.value);
            if (val >= 1 && val <= 60) {
                pollPeriodMs = val * 1000;
                clearInterval(refreshInterval);
                refreshInterval = setInterval(pollJmx, pollPeriodMs);
            }
        });
    }

    // History configuration (min query time, history timespan, track URI)
    document.getElementById('configure-history-btn')?.addEventListener('click', () => {
        const threshold = document.getElementById('threshold')?.value || '';
        const timespan = document.getElementById('history-timespan')?.value || '';
        const trackUri = document.getElementById('track-uri')?.checked || false;
        const base = location.pathname.replace(/^(.*?)\/(apps\/)?dashboard\/.*$/, '$1');
        const params = new URLSearchParams();
        params.set('token', jmxToken);
        if (threshold) {
            params.set('operation', 'setMinTime');
            params.set('mbean', 'org.exist.management.exist:type=ProcessReport');
            params.set('time', threshold);
            fetch(`${base}/status?${params}`, { credentials: 'include' });
        }
        if (timespan) {
            const params2 = new URLSearchParams();
            params2.set('token', jmxToken);
            params2.set('operation', 'setHistoryTimespan');
            params2.set('mbean', 'org.exist.management.exist:type=ProcessReport');
            params2.set('time', timespan);
            fetch(`${base}/status?${params2}`, { credentials: 'include' });
        }
        if (trackUri) {
            const params3 = new URLSearchParams();
            params3.set('token', jmxToken);
            params3.set('operation', 'setTraceRequestURI');
            params3.set('mbean', 'org.exist.management.exist:type=ProcessReport');
            fetch(`${base}/status?${params3}`, { credentials: 'include' });
        }
    });

    pollJmx();
    refreshInterval = setInterval(pollJmx, pollPeriodMs);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(refreshInterval);
        } else {
            pollJmx();
            refreshInterval = setInterval(pollJmx, pollPeriodMs);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
