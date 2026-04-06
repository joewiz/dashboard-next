/**
 * System tab — detailed system information.
 */

import { formatBytes } from './dashboard.js';

const BASE = location.pathname.replace(/\/[^/]*$/, '');

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function infoRow(label, value) {
    return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(String(value || '--'))}</td></tr>`;
}

function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(d + ' days');
    if (h > 0) parts.push(h + ' hours');
    parts.push(m + ' minutes');
    return parts.join(', ');
}

async function loadSystemInfo() {
    const resp = await fetch(`${BASE}/system/data`, { credentials: 'include' });
    if (!resp.ok) return;
    const info = await resp.json();

    // Database section
    const db = info.db || {};
    document.querySelector('#sys-db tbody').innerHTML =
        infoRow('Product', db.name + ' ' + db.version) +
        infoRow('Build', db.build) +
        infoRow('Revision', db.revision) +
        infoRow('Home', db['exist-home']) +
        infoRow('Data Directory', db['data-dir']) +
        infoRow('Uptime', formatUptime(info.uptime || 0));

    // Java section
    const java = info.java || {};
    document.querySelector('#sys-java tbody').innerHTML =
        infoRow('Version', java.version) +
        infoRow('Vendor', java.vendor) +
        infoRow('VM', java['vm-name'] + ' ' + java['vm-version']) +
        infoRow('Java Home', java['java-home']) +
        infoRow('Max Memory', formatBytes(java['max-memory'] || 0)) +
        infoRow('Free Memory', formatBytes(java['free-memory'] || 0));

    // OS section
    const os = info.os || {};
    document.querySelector('#sys-os tbody').innerHTML =
        infoRow('Name', os.name) +
        infoRow('Version', os.version) +
        infoRow('Architecture', os.arch);

    // Scheduler jobs
    const jobs = info['scheduler-jobs'] || [];
    const tbody = document.getElementById('jobs-body');
    if (jobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No scheduled jobs</td></tr>';
    } else {
        tbody.innerHTML = jobs.map(j =>
            `<tr><td>${escapeHtml(j.name)}</td>` +
            `<td>${escapeHtml(j.group)}</td>` +
            `<td>${escapeHtml(j.state)}</td>` +
            `<td>${escapeHtml(j.expression || j.trigger || '')}</td></tr>`
        ).join('');
    }
}

function init() {
    if (!document.querySelector('.system-page')) return;
    loadSystemInfo();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
