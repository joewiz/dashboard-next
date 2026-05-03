/**
 * Packages tab — list installed and available packages.
 * Tries exist-api first, falls back to direct XQuery endpoints.
 */

import { fetchJSON, probeApi, API_BASE, showToast } from './dashboard.js';

const BASE = location.pathname.replace(/\/[^/]*$/, '');
let useApi = false;
let packages = [];
let available = [];

// Current sort state per table
const sortState = {
    installed: { key: null, asc: true },
    available: { key: null, asc: true },
};

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function el(id) { return document.getElementById(id); }

/**
 * Semver comparison: returns -1, 0, or 1.
 */
function compareVersions(a, b) {
    if (!a || !b) return 0;
    const normalize = v => v.replace(/-.*$/, '');
    const pa = normalize(a).split('.').map(Number);
    const pb = normalize(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

/**
 * Sort an array of package objects by key, toggling direction.
 */
function sortPackages(arr, key, state) {
    if (state.key === key) {
        state.asc = !state.asc;
    } else {
        state.key = key;
        state.asc = true;
    }
    const dir = state.asc ? 1 : -1;
    return [...arr].sort((a, b) => {
        const av = (a[key] || '').toString().toLowerCase();
        const bv = (b[key] || '').toString().toLowerCase();
        if (key === 'version') return compareVersions(a.version, b.version) * dir;
        return av.localeCompare(bv) * dir;
    });
}

/**
 * Update sort indicator arrows on table headers.
 */
function updateSortHeaders(tableId, state) {
    const table = el(tableId);
    if (!table) return;
    table.querySelectorAll('th[data-sort]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === state.key) {
            th.classList.add(state.asc ? 'sort-asc' : 'sort-desc');
        }
    });
}

/**
 * Build data attributes for the Info button.
 */
function infoAttrs(p) {
    return `data-abbrev="${escapeHtml(p.abbrev || '')}"`;
}

// ── Installed packages ─────────────────────────

async function loadPackages() {
    const resp = await fetch(`${BASE}/packages/data`, { credentials: 'include' });
    if (resp.ok) {
        const data = await resp.json();
        packages = data.packages || [];
    }
}

/**
 * Load installed first (render immediately), then available in background.
 * When available arrives, re-render with update badges and animate reordering.
 */
async function loadAll() {
    const tbody = el('packages-body');
    if (tbody && packages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><span class="spinner"></span> Loading installed packages...</td></tr>';
    }
    await loadPackages();
    renderPackages();
    // Show a subtle "checking for updates" indicator
    const toolbar = el('packages-table')?.closest('.tab-panel')?.querySelector('.toolbar');
    let updateIndicator = el('update-indicator');
    if (!updateIndicator && toolbar) {
        updateIndicator = document.createElement('span');
        updateIndicator.id = 'update-indicator';
        updateIndicator.className = 'toolbar-detail';
        updateIndicator.innerHTML = '<span class="spinner"></span> Checking for updates...';
        toolbar.appendChild(updateIndicator);
    }
    await loadAvailable();
    // Remove indicator
    if (updateIndicator) updateIndicator.remove();
    // Re-render with update badges, animating rows that move
    renderPackagesAnimated();
}

function renderPackages() {
    const tbody = el('packages-body');
    if (!tbody) return;
    const filter = (el('pkg-filter')?.value || '').toLowerCase();

    const availMap = {};
    available.forEach(a => { if (a.abbrev) availMap[a.abbrev] = a; });

    let filtered = filter
        ? packages.filter(p => (p.title || '').toLowerCase().includes(filter) ||
              (p.abbrev || '').toLowerCase().includes(filter) ||
              (p.name || '').toLowerCase().includes(filter))
        : [...packages];

    // Apply user sort or default (updates first, then alpha)
    if (sortState.installed.key) {
        filtered = sortPackages(filtered, sortState.installed.key, { ...sortState.installed });
    } else {
        filtered.sort((a, b) => {
            const au = hasUpdate(a, availMap);
            const bu = hasUpdate(b, availMap);
            if (au && !bu) return -1;
            if (!au && bu) return 1;
            return (a.title || '').localeCompare(b.title || '');
        });
    }

    updateSortHeaders('packages-table', sortState.installed);

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No packages found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const avail = availMap[p.abbrev];
        const update = hasUpdate(p, availMap);
        const updateBadge = update
            ? ` <span class="status-badge status-on" title="Update available: ${escapeHtml(avail.version)}">${escapeHtml(avail.version)} available</span>`
            : '';

        return `<tr data-abbrev="${escapeHtml(p.abbrev || '')}"${update ? ' class="has-update"' : ''}>` +
            `<td>${escapeHtml(p.title || p.abbrev || p.name)}${updateBadge}</td>` +
            `<td>${escapeHtml(p.abbrev || '')}</td>` +
            `<td>${escapeHtml(p.version || '')}</td>` +
            `<td>${escapeHtml(p.type || 'application')}</td>` +
            `<td>` +
            `<button class="btn btn-sm pkg-info" ${infoAttrs(p)}>Info</button> ` +
            (update
                ? `<button class="btn btn-sm btn-primary install-pkg" data-name="${escapeHtml(p.name || '')}" data-abbrev="${escapeHtml(p.abbrev || '')}">Update</button> `
                : '') +
            `<button class="btn btn-sm btn-danger remove-pkg" data-uri="${escapeHtml(p.name || '')}" data-title="${escapeHtml(p.title || p.abbrev || '')}">Remove</button>` +
            `</td></tr>`;
    }).join('');
}

/**
 * Re-render installed packages with FLIP animation for rows that move.
 */
function renderPackagesAnimated() {
    const tbody = el('packages-body');
    if (!tbody) { renderPackages(); return; }

    // Capture old positions keyed by abbrev
    const oldPositions = {};
    tbody.querySelectorAll('tr[data-abbrev]').forEach(tr => {
        oldPositions[tr.dataset.abbrev] = tr.getBoundingClientRect().top;
    });

    // Re-render (this changes the DOM)
    renderPackages();

    // Animate rows that moved (FLIP technique)
    tbody.querySelectorAll('tr[data-abbrev]').forEach(tr => {
        const abbrev = tr.dataset.abbrev;
        const oldTop = oldPositions[abbrev];
        if (oldTop === undefined) return; // new row, no animation
        const newTop = tr.getBoundingClientRect().top;
        const delta = oldTop - newTop;
        if (Math.abs(delta) < 2) return; // didn't move
        tr.style.transform = `translateY(${delta}px)`;
        tr.style.transition = 'none';
        requestAnimationFrame(() => {
            tr.style.transition = 'transform 0.4s ease';
            tr.style.transform = '';
            tr.addEventListener('transitionend', () => {
                tr.style.transition = '';
            }, { once: true });
        });
    });
}

function hasUpdate(pkg, availMap) {
    const avail = availMap[pkg.abbrev];
    if (!avail || !avail.version || !pkg.version) return false;
    return compareVersions(avail.version, pkg.version) > 0;
}

// ── Available packages ─────────────────────────

async function loadAvailable() {
    const tbody = el('available-body');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><span class="spinner"></span> Loading available packages from public repository...</td></tr>';
    }
    try {
        const resp = await fetch(`${BASE}/packages/available`, { credentials: 'include' });
        if (resp.ok) {
            const data = await resp.json();
            available = data.available || [];
            renderAvailable();
            renderPackages();
        } else {
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load available packages.</td></tr>';
        }
    } catch {
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Failed to connect to public repository.</td></tr>';
    }
}

function renderAvailable() {
    const tbody = el('available-body');
    if (!tbody) return;
    const filter = (el('avail-filter')?.value || '').toLowerCase();

    let filtered = filter
        ? available.filter(p => (p.title || '').toLowerCase().includes(filter) ||
              (p.abbrev || '').toLowerCase().includes(filter))
        : [...available];

    if (sortState.available.key) {
        filtered = sortPackages(filtered, sortState.available.key, { ...sortState.available });
    }

    updateSortHeaders('available-table', sortState.available);

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No available packages found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const installed = p.installed;
        let actionHtml;
        if (!installed) {
            actionHtml = `<button class="btn btn-sm btn-primary install-pkg" data-name="${escapeHtml(p.name)}" data-abbrev="${escapeHtml(p.abbrev)}">Install</button>`;
        } else if (compareVersions(p.version, installed) > 0) {
            actionHtml = `<button class="btn btn-sm btn-primary install-pkg" data-name="${escapeHtml(p.name)}" data-abbrev="${escapeHtml(p.abbrev)}">Update</button>`;
        } else {
            actionHtml = `<span class="status-badge status-on">${escapeHtml(installed)}</span>`;
        }

        return `<tr>` +
            `<td>${escapeHtml(p.title || p.abbrev)}</td>` +
            `<td>${escapeHtml(p.abbrev || '')}</td>` +
            `<td>${escapeHtml(p.version || '')}</td>` +
            `<td>${escapeHtml(p.type || 'application')}</td>` +
            `<td>` +
            `<button class="btn btn-sm pkg-info" ${infoAttrs(p)}>Info</button> ` +
            `${actionHtml}` +
            `</td></tr>`;
    }).join('');
}

// ── Package Info Dialog ────────────────────────

function showPackageInfo(btn) {
    const abbrev = btn.dataset.abbrev;

    // Look up from both installed and available arrays
    const inst = packages.find(p => p.abbrev === abbrev);
    const avail = available.find(a => a.abbrev === abbrev);
    const p = inst || avail || {};

    const title = p.title || p.abbrev || abbrev;
    const version = p.version || '';

    let html = `<h2>${escapeHtml(title)}</h2>`;
    html += `<table class="info-table"><tbody>`;
    html += `<tr><th>Package URI</th><td>${escapeHtml(p.name || '')}</td></tr>`;
    html += `<tr><th>Abbreviation</th><td>${escapeHtml(abbrev)}</td></tr>`;
    html += `<tr><th>Version</th><td>${escapeHtml(version)}</td></tr>`;
    if (p.type) html += `<tr><th>Type</th><td>${escapeHtml(p.type)}</td></tr>`;
    if (p.author) html += `<tr><th>Author</th><td>${escapeHtml(p.author)}</td></tr>`;
    if (p.description) html += `<tr><th>Description</th><td>${escapeHtml(p.description)}</td></tr>`;
    if (p.license) html += `<tr><th>License</th><td>${escapeHtml(p.license)}</td></tr>`;
    if (p.website) html += `<tr><th>Website</th><td><a href="${escapeHtml(p.website)}" target="_blank">${escapeHtml(p.website)}</a></td></tr>`;
    if (avail && avail.version && compareVersions(avail.version, version) > 0) {
        html += `<tr><th>Available Update</th><td>${escapeHtml(avail.version)}</td></tr>`;
    }
    html += `</tbody></table>`;

    // Changelog (from installed package's repo.xml)
    const changelog = (inst || {}).changelog;
    if (changelog && changelog.length > 0) {
        html += `<h3 class="info-section-heading">Changelog</h3>`;
        changelog.forEach(entry => {
            html += `<div class="changelog-entry">`;
            html += `<strong>${escapeHtml(entry.version)}</strong>`;
            if (entry.items && entry.items.length > 0) {
                html += `<ul>`;
                entry.items.forEach(item => {
                    html += `<li>${escapeHtml(item)}</li>`;
                });
                html += `</ul>`;
            }
            html += `</div>`;
        });
    }

    el('info-dialog-content').innerHTML = html;
    el('info-dialog').hidden = false;
}

// ── Install / Upload / Remove ──────────────────

async function installFromUrl(url) {
    const resp = await fetch(`${BASE}/packages/action?action=install&url=${encodeURIComponent(url)}`, {
        method: 'POST', credentials: 'include'
    });
    const result = await resp.json().catch(() => ({}));
    if (resp.ok && !result.error) {
        showToast(`Installed package from ${url}`);
        loadAll();
    } else {
        showToast(`Installation failed${result.error ? ': ' + result.error : '. Check the URL and try again.'}`, 'error');
    }
}

async function installByName(name) {
    const label = available.find(a => a.name === name)?.title || name;
    const resp = await fetch(`${BASE}/packages/action?action=install&url=${encodeURIComponent(name)}`, {
        method: 'POST', credentials: 'include'
    });
    if (resp.ok) {
        showToast(`Installed "${label}"`);
        loadAll();
    } else {
        showToast(`Failed to install "${label}"`, 'error');
    }
}

async function uploadXar(file) {
    const resp = await fetch(`${BASE}/packages/upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
    });
    const result = await resp.json().catch(() => ({}));
    if (resp.ok && !result.error) {
        showToast(`Installed "${file.name}"`);
        loadAll();
    } else {
        showToast(`Upload failed${result.error ? ': ' + result.error : '.'}`, 'error');
    }
}

async function removePackage(uri, title) {
    if (!confirm(`Remove package "${title}"?`)) return;
    const resp = await fetch(`${BASE}/packages/action?action=remove&uri=${encodeURIComponent(uri)}`, {
        method: 'POST', credentials: 'include'
    });
    if (resp.ok) {
        showToast(`Removed "${title}"`);
        loadAll();
    } else {
        showToast(`Failed to remove "${title}"`, 'error');
    }
}

// ── Column sorting ─────────────────────────────

function initSorting() {
    el('packages-table')?.querySelectorAll('th[data-sort]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (sortState.installed.key === key) {
                sortState.installed.asc = !sortState.installed.asc;
            } else {
                sortState.installed.key = key;
                sortState.installed.asc = true;
            }
            renderPackages();
        });
    });

    el('available-table')?.querySelectorAll('th[data-sort]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (sortState.available.key === key) {
                sortState.available.asc = !sortState.available.asc;
            } else {
                sortState.available.key = key;
                sortState.available.asc = true;
            }
            renderAvailable();
        });
    });
}

// ── Init ───────────────────────────────────────

async function init() {
    if (!document.querySelector('.packages-page')) return;

    useApi = await probeApi();

    // Tab switching
    document.querySelectorAll('.packages-page .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.packages-page .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.packages-page .tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            el('panel-' + btn.dataset.tab)?.classList.add('active');
            if (btn.dataset.tab === 'available' && available.length === 0) loadAvailable();
        });
    });

    // Filters
    el('pkg-filter')?.addEventListener('input', renderPackages);
    el('avail-filter')?.addEventListener('input', renderAvailable);
    el('pkg-refresh')?.addEventListener('click', loadAll);
    el('avail-refresh')?.addEventListener('click', loadAvailable);

    // Install dialog
    el('pkg-install-btn')?.addEventListener('click', () => { el('install-dialog').hidden = false; });
    el('install-cancel')?.addEventListener('click', () => { el('install-dialog').hidden = true; });
    el('install-dialog')?.addEventListener('click', (e) => {
        if (e.target === el('install-dialog')) el('install-dialog').hidden = true;
    });
    el('install-confirm')?.addEventListener('click', () => {
        const url = el('install-url')?.value?.trim();
        if (url) { installFromUrl(url); el('install-dialog').hidden = true; }
    });

    // Info dialog
    // Info dialog: X button, and click outside to dismiss
    el('info-close-x')?.addEventListener('click', () => { el('info-dialog').hidden = true; });
    el('info-dialog')?.addEventListener('click', (e) => {
        if (e.target === el('info-dialog')) el('info-dialog').hidden = true;
    });

    // Upload
    el('pkg-upload')?.addEventListener('change', (e) => {
        if (e.target.files[0]) uploadXar(e.target.files[0]);
    });

    // Delegation: info, remove (installed tab)
    el('packages-body')?.addEventListener('click', (e) => {
        const info = e.target.closest('.pkg-info');
        if (info) { showPackageInfo(info); return; }
        const inst = e.target.closest('.install-pkg');
        if (inst) { installByName(inst.dataset.name); return; }
        const btn = e.target.closest('.remove-pkg');
        if (btn) removePackage(btn.dataset.uri, btn.dataset.title);
    });

    // Delegation: info, install (available tab)
    el('available-body')?.addEventListener('click', (e) => {
        const info = e.target.closest('.pkg-info');
        if (info) { showPackageInfo(info); return; }
        const btn = e.target.closest('.install-pkg');
        if (btn) installByName(btn.dataset.name);
    });

    initSorting();
    loadAll();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
