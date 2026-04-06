/**
 * Profiling tab — enable/disable tracing, display query/function/index stats.
 */

const BASE = location.pathname.replace(/\/[^/]*$/, '');

async function postAction(action) {
    const resp = await fetch(`${BASE}/profiling/action?action=${action}`, {
        method: 'POST', credentials: 'include'
    });
    return resp.ok ? resp.json() : null;
}

async function fetchTrace() {
    const resp = await fetch(`${BASE}/profiling/data`, { credentials: 'include' });
    return resp.ok ? resp.json() : null;
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function shortSource(path) {
    if (!path) return '';
    const parts = path.split('/');
    return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : path;
}

function renderQueries(queries) {
    const tbody = document.getElementById('queries-data');
    if (!tbody) return;
    if (!queries || queries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No traced queries</td></tr>';
        return;
    }
    tbody.innerHTML = queries.map(q =>
        `<tr><td class="truncate" title="${escapeHtml(q.source)}">${escapeHtml(shortSource(q.source))}</td>` +
        `<td>${q.calls}</td><td>${q.elapsed}</td></tr>`
    ).join('');
}

function renderFunctions(functions) {
    const tbody = document.getElementById('functions-data');
    if (!tbody) return;
    if (!functions || functions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No traced functions</td></tr>';
        return;
    }
    tbody.innerHTML = functions.map(f =>
        `<tr><td>${escapeHtml(f.name)}</td>` +
        `<td class="truncate" title="${escapeHtml(f.source)}">${escapeHtml(shortSource(f.source))}</td>` +
        `<td>${f.calls}</td><td>${f.elapsed}</td></tr>`
    ).join('');
}

function renderIndexes(indexes) {
    const tbody = document.getElementById('indexes-data');
    if (!tbody) return;
    if (!indexes || indexes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No index usage data</td></tr>';
        return;
    }
    const optLabels = ['None', 'Basic', 'Full'];
    const optClasses = ['opt-none', 'opt-basic', 'opt-full'];
    tbody.innerHTML = indexes.map(ix =>
        `<tr><td class="truncate" title="${escapeHtml(ix.source)}">${escapeHtml(shortSource(ix.source))}</td>` +
        `<td>${escapeHtml(ix.type)}</td>` +
        `<td>${ix.calls}</td><td>${ix.elapsed}</td>` +
        `<td><span class="opt-badge ${optClasses[ix.optimization] || 'opt-none'}">${optLabels[ix.optimization] || 'Unknown'}</span></td></tr>`
    ).join('');
}

async function refresh() {
    const data = await fetchTrace();
    if (!data) return;

    const status = document.getElementById('prof-status');
    if (status) {
        status.textContent = data.enabled ? 'Tracing ON' : 'Tracing OFF';
        status.className = 'status-badge ' + (data.enabled ? 'status-on' : 'status-off');
    }

    const clearTareBtn = document.getElementById('prof-clear-tare');
    if (clearTareBtn) clearTareBtn.hidden = !data.hasTare;

    renderQueries(data.queries);
    renderFunctions(data.functions);
    renderIndexes(data.indexes);
}

// ── Sub-tab switching ──────────────────────────

function initTabs() {
    document.querySelectorAll('.profiling-page .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.profiling-page .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.profiling-page .tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('panel-' + btn.dataset.tab)?.classList.add('active');
        });
    });
}

// ── Column sorting ─────────────────────────────

function initSorting() {
    document.querySelectorAll('.profiling-page th[data-sort]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const tbody = th.closest('table').querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr:not(.empty-state)'));
            if (rows.length === 0) return;
            const idx = Array.from(th.parentElement.children).indexOf(th);
            const asc = th.classList.toggle('sort-asc');
            rows.sort((a, b) => {
                const av = a.children[idx]?.textContent || '';
                const bv = b.children[idx]?.textContent || '';
                const an = parseFloat(av), bn = parseFloat(bv);
                if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
                return asc ? av.localeCompare(bv) : bv.localeCompare(av);
            });
            rows.forEach(r => tbody.appendChild(r));
        });
    });
}

// ── Init ───────────────────────────────────────

function init() {
    if (!document.querySelector('.profiling-page')) return;

    document.getElementById('prof-enable')?.addEventListener('click', async () => { await postAction('enable'); refresh(); });
    document.getElementById('prof-disable')?.addEventListener('click', async () => { await postAction('disable'); refresh(); });
    document.getElementById('prof-clear')?.addEventListener('click', async () => { await postAction('clear'); refresh(); });
    document.getElementById('prof-tare')?.addEventListener('click', async () => { await postAction('tare'); refresh(); });
    document.getElementById('prof-clear-tare')?.addEventListener('click', async () => { await postAction('clear-tare'); refresh(); });
    document.getElementById('prof-refresh')?.addEventListener('click', refresh);

    initTabs();
    initSorting();
    refresh();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
