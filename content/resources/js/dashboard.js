/**
 * Dashboard client-side module.
 *
 * Detects exist-api availability and populates dashboard cards with live data.
 * Provides shared utilities for all tab pages.
 */

const API_BASE = '/exist/apps/exist-api/api';

/** State */
let apiAvailable = false;
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
 * Probe whether exist-api is installed by hitting the whoami endpoint.
 */
async function probeApi() {
    const data = await fetchJSON(`${API_BASE}/users/whoami`);
    apiAvailable = data !== null;
    return apiAvailable;
}

/**
 * Format bytes as a human-readable string.
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

/**
 * Format a duration in milliseconds as a human-readable uptime string.
 */
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

/**
 * Update the API status banner.
 */
function showApiStatus(available) {
    const el = document.getElementById('api-status');
    const msg = document.getElementById('api-status-message');
    if (!el || !msg) return;

    el.hidden = false;
    if (available) {
        el.className = 'api-status connected';
        msg.textContent = 'Connected to exist-api — live data active.';
    } else {
        el.className = 'api-status unavailable';
        msg.textContent = 'exist-api not detected — showing server-rendered data only.';
    }
}

/**
 * Set the text content of an element by ID, if it exists.
 */
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

/**
 * Fetch system info from exist-api and update the Home tab cards.
 */
async function refreshSystemInfo() {
    const info = await fetchJSON(`${API_BASE}/system/info`);
    if (!info) return;

    // Version card — only update if exist-api has richer data
    if (info.db) {
        const versionEl = document.querySelector('#card-version .stat-value');
        if (versionEl) {
            versionEl.textContent = (info.db.name || 'eXist') + ' ' + (info.db.version || '');
        }
        const detailEl = document.querySelector('#card-version .stat-detail');
        if (detailEl && info.db.git) {
            detailEl.textContent = 'Revision ' + info.db.git;
        }
    }

    // Java card
    if (info.java) {
        const javaVal = document.querySelector('#card-java .stat-value');
        if (javaVal) javaVal.textContent = info.java.version || '';
        const javaDetail = document.querySelector('#card-java .stat-detail');
        if (javaDetail) javaDetail.textContent = info.java.vendor || '';
    }

    // OS card
    if (info.os) {
        const osVal = document.querySelector('#card-os .stat-value');
        if (osVal) osVal.textContent = info.os.name || '';
        const osDetail = document.querySelector('#card-os .stat-detail');
        if (osDetail) osDetail.textContent = info.os.arch || '';
    }
}

/**
 * Fetch JMX data from the status servlet and update live cards.
 */
async function refreshJmxData() {
    // JMX data requires the /status servlet which uses a token.
    // For now, we show placeholder data — Phase 4 will add full JMX integration.
    // This function is a hook for future implementation.
}

/**
 * Fetch package count from exist-api.
 */
async function refreshPackageCount() {
    const packages = await fetchJSON(`${API_BASE}/packages`);
    if (!packages || !Array.isArray(packages)) return;

    setText('packages-value', String(packages.length));
    setText('packages-detail', 'installed');
}

/**
 * Start periodic refresh of live data.
 */
function startAutoRefresh(intervalMs = 30000) {
    stopAutoRefresh();
    refreshInterval = setInterval(() => {
        if (apiAvailable) {
            refreshSystemInfo();
            refreshPackageCount();
        }
        refreshJmxData();
    }, intervalMs);
}

/**
 * Stop periodic refresh.
 */
function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

/**
 * Initialize the dashboard.
 */
async function init() {
    // Only run live-data logic on the Home tab
    const homePage = document.querySelector('.home-page');
    if (!homePage) return;

    const available = await probeApi();
    showApiStatus(available);

    if (available) {
        // Fetch live data in parallel
        await Promise.all([
            refreshSystemInfo(),
            refreshPackageCount()
        ]);
        startAutoRefresh();
    }

    // Pause refresh when tab is hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAutoRefresh();
        } else if (apiAvailable) {
            refreshSystemInfo();
            refreshPackageCount();
            startAutoRefresh();
        }
    });
}

// Run on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for use by tab-specific modules
export { fetchJSON, apiAvailable, API_BASE, formatBytes, formatUptime };
