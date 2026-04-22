/**
 * Backup tab — list, trigger, and download database backups.
 */

const BASE = location.pathname.replace(/\/[^/]*$/, '');

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

async function loadBackups() {
    const tbody = document.getElementById('backups-body');
    if (!tbody) return;
    try {
        const resp = await fetch(`${BASE}/backup/data`, { credentials: 'include' });
        if (!resp.ok) { tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Failed to load backups</td></tr>'; return; }
        const backups = await resp.json();
        if (!backups || backups.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No backups found</td></tr>';
            return;
        }
        tbody.innerHTML = backups.map(b => {
            const downloadable = b.name && b.name.endsWith('.zip');
            const href = `${BASE}/backup/data?action=retrieve&archive=${encodeURIComponent(b.name)}`;
            return `<tr>` +
                `<td>${escapeHtml(b.name || '')}</td>` +
                `<td>${escapeHtml(b.created || '')}</td>` +
                `<td>${escapeHtml(b.incremental || '')}</td>` +
                `<td>${downloadable
                    ? `<a href="${href}" class="btn btn-sm" target="_blank" title="Download">Download</a>`
                    : ''}</td>` +
                `</tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Error loading backups</td></tr>';
    }
}

async function triggerBackup() {
    const zip = document.getElementById('zip-checkbox')?.checked;
    const inc = document.getElementById('inc-checkbox')?.checked;
    const statusEl = document.getElementById('backup-status');
    const btn = document.getElementById('trigger-backup-btn');

    const params = new URLSearchParams();
    params.set('action', 'trigger');
    if (zip) params.set('zip', 'on');
    if (inc) params.set('inc', 'on');

    if (btn) btn.disabled = true;
    if (statusEl) { statusEl.textContent = 'Backup triggered, please wait...'; statusEl.style.display = ''; }

    try {
        const resp = await fetch(`${BASE}/backup/data`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        if (resp.ok) {
            if (statusEl) statusEl.textContent = 'Backup triggered successfully. It may take a moment to appear.';
            // Wait a few seconds then reload the list
            setTimeout(loadBackups, 3000);
        } else {
            if (statusEl) statusEl.textContent = 'Backup trigger failed: ' + resp.statusText;
        }
    } catch (e) {
        if (statusEl) statusEl.textContent = 'Error: ' + e.message;
    } finally {
        if (btn) btn.disabled = false;
    }
}

function init() {
    if (!document.querySelector('.backup-page')) return;
    document.getElementById('trigger-backup-btn')?.addEventListener('click', triggerBackup);
    loadBackups();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
