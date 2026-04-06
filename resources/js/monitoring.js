/**
 * Monitoring tab — real-time JMX polling with charts.
 * Polls /status servlet directly; no exist-api dependency.
 */

import { formatBytes } from './dashboard.js';

// ── Rolling data buffers for charts ────────────

const MAX_POINTS = 60;
const memoryData = { used: [], committed: [], max: [] };
const cpuData = { process: [], system: [] };

let refreshInterval = null;
let jmxToken = '';

// ── Namespace-aware XML helpers ────────────────

const JMX_NS = 'http://exist-db.org/jmx';

/** Get first element by local name (namespace-aware). */
function jmxEl(parent, localName) {
    if (!parent) return null;
    // Try namespace-aware first, fall back to local name
    const els = parent.getElementsByTagNameNS(JMX_NS, localName);
    if (els.length > 0) return els[0];
    // Fallback for non-namespaced responses
    const els2 = parent.getElementsByTagName(localName);
    return els2.length > 0 ? els2[0] : null;
}

/** Get all elements by local name. */
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

// ── Canvas chart helpers ───────────────────────

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
    const pad = { top: 10, right: 10, bottom: 20, left: 50 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    let yMax = opts.yMax || 0;
    if (!yMax) {
        for (const ds of datasets) {
            for (const v of ds.data) { if (v > yMax) yMax = v; }
        }
    }
    if (yMax === 0) yMax = 1;

    // Grid lines
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + plotH - (plotH * i / 4);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();

        ctx.fillStyle = '#999';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'right';
        const label = opts.formatY ? opts.formatY(yMax * i / 4) : Math.round(yMax * i / 4);
        ctx.fillText(label, pad.left - 6, y + 4);
    }

    // Plot lines
    for (const ds of datasets) {
        if (ds.data.length < 2) continue;
        ctx.strokeStyle = ds.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < ds.data.length; i++) {
            const x = pad.left + (plotW * i / (MAX_POINTS - 1));
            const y = pad.top + plotH - (plotH * ds.data[i] / yMax);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // Legend
    let lx = pad.left;
    ctx.font = '11px system-ui, sans-serif';
    for (const ds of datasets) {
        ctx.fillStyle = ds.color;
        ctx.fillRect(lx, H - 12, 12, 3);
        ctx.fillStyle = '#666';
        ctx.textAlign = 'left';
        ctx.fillText(ds.label, lx + 16, H - 6);
        lx += ctx.measureText(ds.label).width + 32;
    }
}

function pushRolling(arr, value) {
    arr.push(value);
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
    if (!jmxToken) return;
    try {
        const resp = await fetch(statusUrl(), { credentials: 'include' });
        if (!resp.ok) return;
        const text = await resp.text();
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        updateMemory(xml);
        updateCpu(xml);
        updateBrokers(xml);
        updateQueries(xml);
        updateCaches(xml);
        updateThreads(xml);
        updateHistory(xml);
    } catch { /* polling failure not fatal */ }
}

// ── Update functions ───────────────────────────

function updateMemory(xml) {
    const heap = jmxEl(xml, 'HeapMemoryUsage');
    if (!heap) return;
    const used = jmxInt(heap, 'used');
    const committed = jmxInt(heap, 'committed');
    const max = jmxInt(heap, 'max');

    pushRolling(memoryData.used, used / 1048576);
    pushRolling(memoryData.committed, committed / 1048576);
    pushRolling(memoryData.max, max / 1048576);

    setText('mem-used', formatBytes(used));
    setText('mem-committed', formatBytes(committed));
    setText('mem-max', formatBytes(max));

    drawLineChart('memory-chart', [
        { label: 'Used', data: memoryData.used, color: '#1565c0' },
        { label: 'Committed', data: memoryData.committed, color: '#90caf9' },
    ], {
        yMax: max / 1048576,
        formatY: v => Math.round(v) + ' MB',
    });
}

function updateCpu(xml) {
    // CPU load may be under OperatingSystemImpl or UnixOperatingSystem
    const os = jmxEl(xml, 'OperatingSystemImpl') || jmxEl(xml, 'UnixOperatingSystem');
    const processCpu = os ? jmxFloat(os, 'ProcessCpuLoad') : 0;
    const systemCpu = os ? jmxFloat(os, 'SystemCpuLoad') : 0;

    pushRolling(cpuData.process, processCpu * 100);
    pushRolling(cpuData.system, systemCpu * 100);

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

function updateBrokers(xml) {
    const db = jmxEl(xml, 'Database');
    if (!db) return;
    setText('brokers-active', jmxText(db, 'ActiveBrokers') || '0');
    setText('brokers-total', jmxText(db, 'TotalBrokers') || '0');
}

function updateQueries(xml) {
    const rows = jmxEls(xml, 'RunningQueries').flatMap(rq => jmxEls(rq, 'row'));
    const tbody = document.getElementById('queries-body');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No running queries</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    rows.forEach(row => {
        const source = jmxText(row, 'sourceKey') || jmxText(row, 'sourceType') || '(unknown)';
        const elapsed = jmxText(row, 'elapsed') || '--';
        const id = jmxText(row, 'id') || jmxText(row, 'thread') || '';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="truncate" title="${escapeHtml(source)}">${escapeHtml(shortSource(source))}</td>` +
            `<td>${elapsed} ms</td>` +
            `<td>${id ? '<button class="btn btn-sm btn-danger kill-query" data-id="' + escapeHtml(id) + '">Kill</button>' : ''}</td>`;
        tbody.appendChild(tr);
    });
}

function updateCaches(xml) {
    const cacheManager = jmxEl(xml, 'CacheManager');
    const rows = cacheManager ? jmxEls(cacheManager, 'row') : [];
    const tbody = document.getElementById('caches-body');
    if (!tbody) return;
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No cache data</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    rows.forEach(row => {
        const name = row.getAttribute('name') || jmxText(row, 'FileName') || '(unknown)';
        const shortName = name.replace(/org\.exist\.management\.exist:type=/, '').replace(/,.*/, '');
        const size = jmxInt(row, 'Size') || jmxInt(row, 'CurrentSize') || 0;
        const max = jmxInt(row, 'MaxTotal') || jmxInt(row, 'MaxSize') || 0;
        const hits = jmxInt(row, 'Hits');
        const fails = jmxInt(row, 'Fails');
        const pct = max > 0 ? Math.round(size / max * 100) : 0;
        const cls = pct > 90 ? 'critical' : pct > 75 ? 'warning' : '';

        const tr = document.createElement('tr');
        tr.innerHTML =
            `<td>${escapeHtml(shortName)}</td>` +
            `<td>${size.toLocaleString()}</td>` +
            `<td>${max.toLocaleString()}</td>` +
            `<td>${hits.toLocaleString()}</td>` +
            `<td>${fails.toLocaleString()}</td>` +
            `<td><div class="progress-bar-container"><div class="progress-bar ${cls}" style="width:${pct}%"></div></div> ${pct}%</td>`;
        tbody.appendChild(tr);
    });
}

function updateThreads(xml) {
    const brokerMap = jmxEl(xml, 'ActiveBrokersMap');
    const rows = brokerMap ? jmxEls(brokerMap, 'row') : [];
    const tbody = document.getElementById('threads-body');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="empty-state">No active threads</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    rows.forEach(row => {
        const owner = jmxText(row, 'owner') || '(unknown)';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="truncate">${escapeHtml(owner)}</td><td>Active</td>`;
        tbody.appendChild(tr);
    });
}

function updateHistory(xml) {
    const historyEl = jmxEl(xml, 'RecentQueryHistory');
    const rows = historyEl ? jmxEls(historyEl, 'row') : [];
    const tbody = document.getElementById('history-body');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No recent queries</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    const sorted = rows.sort((a, b) =>
        jmxInt(b, 'mostRecentExecutionDuration') - jmxInt(a, 'mostRecentExecutionDuration')
    );
    sorted.forEach(row => {
        const source = jmxText(row, 'sourceKey') || '(unknown)';
        const duration = jmxText(row, 'mostRecentExecutionDuration') || '--';
        const uri = jmxText(row, 'requestURI') || '';
        const tr = document.createElement('tr');
        tr.innerHTML =
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

    pollJmx();
    refreshInterval = setInterval(pollJmx, 3000);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(refreshInterval);
        } else {
            pollJmx();
            refreshInterval = setInterval(pollJmx, 3000);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
