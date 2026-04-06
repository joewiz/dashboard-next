/**
 * Indexes tab — browse collection.xconf index configurations.
 * URL reflects selected collection for bookmarking.
 * Each index row is expandable to show index keys.
 */

const BASE = location.pathname.replace(/\/[^/]*$/, '');
let currentIndexes = [];
let currentCollection = '';

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function el(id) { return document.getElementById(id); }

// ── URL state ──────────────────────────────────

function getCollectionFromUrl() {
    const params = new URLSearchParams(location.search);
    return params.get('collection') || '';
}

function updateUrl(collection) {
    const url = new URL(location.href);
    if (collection) {
        url.searchParams.set('collection', collection);
    } else {
        url.searchParams.delete('collection');
    }
    history.replaceState(null, '', url.toString());
}

// ── Data fetching ──────────────────────────────

async function loadCollections() {
    const resp = await fetch(`${BASE}/indexes/collections`, { credentials: 'include' });
    if (!resp.ok) return;
    const data = await resp.json();
    const select = el('idx-collection');
    if (!select) return;

    select.innerHTML = '<option value="">— Select collection —</option>';
    (data.collections || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.collection;
        const types = [c.lucene ? 'Lucene' : '', c.range ? 'Range' : '', c.ngram ? 'NGram' : ''].filter(Boolean).join(', ');
        opt.textContent = `${c.collection} (${types})`;
        select.appendChild(opt);
    });

    // Restore from URL
    const urlCollection = getCollectionFromUrl();
    if (urlCollection) {
        select.value = urlCollection;
        loadIndexes(urlCollection);
    }
}

async function loadIndexes(collection) {
    currentCollection = collection;
    updateUrl(collection);

    if (!collection) {
        el('idx-body').innerHTML = '<tr><td colspan="4" class="empty-state">Select a collection to view its index configuration</td></tr>';
        el('idx-summary').hidden = true;
        el('idx-detail').hidden = true;
        return;
    }

    el('idx-body').innerHTML = '<tr><td colspan="4" class="empty-state"><span class="spinner"></span> Loading indexes...</td></tr>';

    const resp = await fetch(`${BASE}/indexes/data?collection=${encodeURIComponent(collection)}`, { credentials: 'include' });
    if (!resp.ok) return;
    const data = await resp.json();
    currentIndexes = data.indexes || [];
    renderIndexes();
}

async function loadKeys(collection, item, type) {
    const resp = await fetch(
        `${BASE}/indexes/keys?collection=${encodeURIComponent(collection)}&item=${encodeURIComponent(item)}&type=${encodeURIComponent(type)}&max=100`,
        { credentials: 'include' }
    );
    if (!resp.ok) return null;
    return resp.json();
}

// ── Render ─────────────────────────────────────

function renderIndexes() {
    const tbody = el('idx-body');
    if (!tbody) return;

    if (currentIndexes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No indexes configured</td></tr>';
        el('idx-summary').hidden = true;
        return;
    }

    // Summary counts
    const counts = { Lucene: 0, Range: 0, 'New Range': 0, 'Range Field': 0, NGram: 0 };
    currentIndexes.forEach(ix => { counts[ix.type] = (counts[ix.type] || 0) + 1; });
    el('idx-lucene-count').textContent = counts['Lucene'] || 0;
    el('idx-range-count').textContent = (counts['Range'] || 0) + (counts['New Range'] || 0) + (counts['Range Field'] || 0);
    el('idx-ngram-count').textContent = counts['NGram'] || 0;
    el('idx-summary').hidden = false;

    tbody.innerHTML = currentIndexes.map((ix, i) => {
        const hasFacets = ix.facets && ix.facets.length > 0;
        const hasFields = ix.fields && ix.fields.length > 0;
        const details = [];
        if (ix.analyzer && ix.analyzer !== 'default') details.push(ix.analyzer);
        if (ix.boost) details.push('boost: ' + ix.boost);
        if (hasFacets) details.push(ix.facets.length + ' facet(s)');
        if (hasFields) details.push(ix.fields.length + ' field(s)');

        return `<tr class="idx-row" data-idx="${i}" title="Click to view index keys">` +
            `<td>${escapeHtml(ix.item)}</td>` +
            `<td><span class="type-badge type-${ix.type.toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(ix.type)}</span></td>` +
            `<td>${escapeHtml(details.join(' | '))}</td>` +
            `<td><button class="btn btn-sm view-keys" data-idx="${i}">View Keys</button></td>` +
            `</tr>` +
            `<tr class="idx-keys-row" id="keys-row-${i}" hidden="">` +
            `<td colspan="4"><div class="idx-keys-container" id="keys-container-${i}"></div></td>` +
            `</tr>`;
    }).join('');
}

// ── Index keys expansion ───────────────────────

async function toggleKeys(idx) {
    const keysRow = el(`keys-row-${idx}`);
    const container = el(`keys-container-${idx}`);
    if (!keysRow || !container) return;

    if (!keysRow.hidden) {
        keysRow.hidden = true;
        return;
    }

    const ix = currentIndexes[idx];
    if (!ix) return;

    container.innerHTML = '<span class="spinner"></span> Loading index keys...';
    keysRow.hidden = false;

    const data = await loadKeys(currentCollection, ix.item, ix.type);

    if (!data || !data.keys || data.keys.length === 0) {
        container.innerHTML = '<p class="empty-state" style="padding: 0.5rem;">No index keys found (the collection may be empty or the index type may not support key browsing)</p>';
        return;
    }

    let html = `<table class="data-table idx-keys-table">`;
    html += `<thead><tr><th>Term</th><th>Frequency</th><th>Documents</th></tr></thead>`;
    html += `<tbody>`;
    data.keys.forEach(k => {
        html += `<tr><td>${escapeHtml(String(k.term))}</td>` +
            `<td>${k.frequency}</td>` +
            `<td>${k.documents}</td></tr>`;
    });
    html += `</tbody></table>`;
    if (data.keys.length >= 100) {
        html += `<p class="idx-keys-note">Showing first 100 keys</p>`;
    }
    container.innerHTML = html;
}

// ── Detail panel (facets/fields) ───────────────

function showDetail(ix) {
    const panel = el('idx-detail');
    const tbody = el('idx-detail-body');
    if (!panel || !tbody) return;

    const hasFacets = ix.facets && ix.facets.length > 0;
    const hasFields = ix.fields && ix.fields.length > 0;

    if (!hasFacets && !hasFields) {
        panel.hidden = true;
        return;
    }

    el('idx-detail-title').textContent = `${ix.item} — Facets & Fields`;

    const rows = [];
    if (hasFacets) {
        ix.facets.forEach(f => {
            rows.push(`<tr><td>${escapeHtml(f.dimension)}</td><td>Facet</td>` +
                `<td>${escapeHtml(f.expression || '')}</td>` +
                `<td>hierarchical: ${f.hierarchical}</td></tr>`);
        });
    }
    if (hasFields) {
        ix.fields.forEach(f => {
            rows.push(`<tr><td>${escapeHtml(f.name)}</td><td>Field (${escapeHtml(f.type)})</td>` +
                `<td>${escapeHtml(f.expression || '')}</td>` +
                `<td>store: ${f.store}</td></tr>`);
        });
    }

    tbody.innerHTML = rows.join('');
    panel.hidden = false;
}

// ── Init ───────────────────────────────────────

function init() {
    if (!document.querySelector('.indexes-page')) return;

    el('idx-collection')?.addEventListener('change', (e) => loadIndexes(e.target.value));
    el('idx-refresh')?.addEventListener('click', () => {
        loadCollections();
        if (currentCollection) loadIndexes(currentCollection);
    });

    // Delegation for View Keys buttons and row clicks
    el('idx-body')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.view-keys');
        if (btn) {
            toggleKeys(parseInt(btn.dataset.idx));
            return;
        }
        const row = e.target.closest('.idx-row');
        if (row) {
            const ix = currentIndexes[parseInt(row.dataset.idx)];
            if (ix) showDetail(ix);
        }
    });

    loadCollections();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
