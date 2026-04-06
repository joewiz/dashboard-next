/**
 * Dashboard client-side module.
 *
 * Home tab uses direct JMX polling via /status servlet — no exist-api needed.
 * Packages/Users tabs will try exist-api first, fall back to direct XQuery.
 */

const API_BASE = '/exist/apps/exist-api/api';

let refreshInterval = null;

/**
 * Fetch JSON from a URL with credentials included.
 * Returns null on network or HTTP errors.
 */
async function fetchJSON(url) {
    try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    }
}

/**
 * Probe whether exist-api is installed.
 * Used by Packages/Users tabs — not needed for Home or Monitoring.
 */
async function probeApi() {
    const data = await fetchJSON(`${API_BASE}/users/whoami`);
    return data !== null;
}

// ── Utility functions ──────────────────────────

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(days + 'd');
    if (hours > 0) parts.push(hours + 'h');
    parts.push(minutes + 'm');
    return parts.join(' ');
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ── JMX status polling ─────────────────────────

/**
 * Get the JMX token from the hidden input rendered server-side.
 */
function getJmxToken() {
    const el = document.getElementById('jmx-token');
    return el ? el.value : '';
}

/**
 * Build the /status URL for local JMX polling.
 * Categories: instances, processes, memory, caches, system, operatingsystem, locking
 */
function statusUrl(token) {
    const base = location.pathname.replace(/^(.*?)\/(apps\/)?dashboard\/.*$/, '$1');
    const cats = ['instances', 'processes', 'locking', 'memory', 'caches', 'system', 'operatingsystem'];
    const params = cats.map(c => 'c=' + c).join('&');
    return `${base}/status?${params}&token=${encodeURIComponent(token)}`;
}

/**
 * Get first element by local name (handles JMX namespace).
 */
const JMX_NS = 'http://exist-db.org/jmx';
function jmxEl(parent, localName) {
    if (!parent) return null;
    const els = parent.getElementsByTagNameNS(JMX_NS, localName);
    if (els.length > 0) return els[0];
    const els2 = parent.getElementsByTagName(localName);
    return els2.length > 0 ? els2[0] : null;
}

/**
 * Parse JMX XML response and extract key metrics.
 */
function parseJmxResponse(xml) {
    const result = {};

    // Memory
    const heap = jmxEl(xml, 'HeapMemoryUsage');
    if (heap) {
        result.memoryUsed = parseInt(jmxEl(heap, 'used')?.textContent || '0');
        result.memoryMax = parseInt(jmxEl(heap, 'max')?.textContent || '0');
        result.memoryCommitted = parseInt(jmxEl(heap, 'committed')?.textContent || '0');
    }

    // Database instances (brokers)
    const db = jmxEl(xml, 'Database');
    if (db) {
        const active = jmxEl(db, 'ActiveBrokers');
        result.activeBrokers = active ? parseInt(active.textContent) : 0;
    }

    // Running queries
    const rq = jmxEl(xml, 'RunningQueries');
    const rows = rq ? rq.getElementsByTagNameNS(JMX_NS, 'row') : [];
    result.runningQueries = rows.length;

    // Uptime
    if (db) {
        const uptime = jmxEl(db, 'Uptime');
        if (uptime) result.uptimeMs = parseInt(uptime.textContent);
    }

    return result;
}

/**
 * Fetch JMX data from /status servlet and update Home tab cards.
 */
async function refreshJmx() {
    const token = getJmxToken();
    if (!token) return;

    try {
        const resp = await fetch(statusUrl(token), { credentials: 'include' });
        if (!resp.ok) return;

        const text = await resp.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const data = parseJmxResponse(xml);

        // Memory
        if (data.memoryMax > 0) {
            const pct = Math.round(data.memoryUsed / data.memoryMax * 100);
            const bar = document.getElementById('memory-bar');
            if (bar) {
                bar.style.width = pct + '%';
                bar.className = 'progress-bar' +
                    (pct > 90 ? ' critical' : pct > 75 ? ' warning' : '');
            }
            setText('memory-detail',
                `${formatBytes(data.memoryUsed)} / ${formatBytes(data.memoryMax)} (${pct}%)`);
        }

        // Brokers
        if (data.activeBrokers !== undefined) {
            setText('brokers-value', String(data.activeBrokers));
            setText('brokers-detail', 'active database brokers');
        }

        // Running queries
        if (data.runningQueries !== undefined) {
            setText('queries-value', String(data.runningQueries));
            setText('queries-detail', 'currently executing');
        }

        // Uptime (update from JMX — more accurate than server-rendered snapshot)
        if (data.uptimeMs) {
            setText('uptime-value', formatUptime(data.uptimeMs));
        }
    } catch {
        // JMX polling failure is not fatal — server-rendered values remain
    }
}

// ── Lifecycle ──────────────────────────────────

function startAutoRefresh(intervalMs = 10000) {
    stopAutoRefresh();
    refreshInterval = setInterval(refreshJmx, intervalMs);
}

function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

/**
 * Initialize the Home tab.
 */
async function initHome() {
    const homePage = document.querySelector('.home-page');
    if (!homePage) return;

    // Immediately poll JMX for live stats (brokers, queries, memory)
    await refreshJmx();
    startAutoRefresh();

    // Pause when tab is hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAutoRefresh();
        } else {
            refreshJmx();
            startAutoRefresh();
        }
    });
}

// Run on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHome);
} else {
    initHome();
}

// Export for use by tab-specific modules
/**
 * Show a toast notification.
 * @param {string} message - text to display
 * @param {'success'|'error'|'info'} type - toast style
 */
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    // Trigger enter animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3500);
}

export { fetchJSON, probeApi, API_BASE, formatBytes, formatUptime, showToast };
