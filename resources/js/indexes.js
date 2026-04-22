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

    // eXide link for collection.xconf
    const exideLink = el('idx-exide-link');
    if (exideLink) {
        if (collection) {
            const xconfPath = `/db/system/config${collection}/collection.xconf`;
            const existBase = BASE.replace(/\/apps\/dashboard.*$/, '');
            exideLink.href = `${existBase}/apps/eXide/index.html?open=${encodeURIComponent(xconfPath)}`;
            exideLink.hidden = false;
        } else {
            exideLink.hidden = true;
        }
    }

    if (!collection) {
        el('idx-body').innerHTML = '<tr><td colspan="3" class="empty-state">Select a collection to view its index configuration</td></tr>';
        el('idx-summary').hidden = true;
        el('idx-detail').hidden = true;
        return;
    }

    el('idx-body').innerHTML = '<tr><td colspan="3" class="empty-state"><span class="spinner"></span> Loading indexes...</td></tr>';

    const resp = await fetch(`${BASE}/indexes/data?collection=${encodeURIComponent(collection)}`, { credentials: 'include' });
    if (!resp.ok) return;
    const data = await resp.json();
    currentIndexes = data.indexes || [];
    renderIndexes();
}

async function loadKeys(collection, item, type, showKeysBy, max, startValue) {
    const params = new URLSearchParams({
        collection, item, type,
        'show-keys-by': showKeysBy || 'qname',
        max: String(max || 100)
    });
    if (startValue) params.set('start-value', startValue);
    const resp = await fetch(
        `${BASE}/indexes/keys?${params}`,
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

        // Determine which "Show Index Keys By" links to show (matching monex)
        const isLuceneOrNgram = ix.type === 'Lucene' || ix.type === 'NGram';
        const isRangeField = ix.type === 'Range Field';
        let keysLinks = '';
        if (isLuceneOrNgram && ix['has-qname']) {
            keysLinks =
                `<a href="#" class="view-keys-link" data-idx="${i}" data-by="qname">QName</a>, ` +
                `<a href="#" class="view-keys-link" data-idx="${i}" data-by="node">Node</a>`;
        } else if (isLuceneOrNgram) {
            // Match-based Lucene — can only browse by node
            keysLinks = `<a href="#" class="view-keys-link" data-idx="${i}" data-by="node">Node</a>`;
        } else if (isRangeField) {
            keysLinks = `<a href="#" class="view-keys-link" data-idx="${i}" data-by="field">Field</a>`;
        } else {
            // Standard range — browse by QName and Node
            keysLinks =
                `<a href="#" class="view-keys-link" data-idx="${i}" data-by="qname">QName</a>, ` +
                `<a href="#" class="view-keys-link" data-idx="${i}" data-by="node">Node</a>`;
        }

        const typeLabel = `${escapeHtml(ix.type)}` +
            (ix['has-qname'] ? ' QName' : ' Match') +
            (ix.analyzer ? ` (${escapeHtml(ix.analyzer === 'default' ? 'default analyzer' : ix.analyzer)})` : '');

        return `<tr class="idx-row" data-idx="${i}">` +
            `<td>${escapeHtml(ix.item)}` +
            (ix.boost ? ` <small>(boost: ${escapeHtml(ix.boost)})</small>` : '') +
            `</td>` +
            `<td>${typeLabel}</td>` +
            `<td class="idx-keys-col">${keysLinks}</td>` +
            `</tr>` +
            `<tr class="idx-keys-row" id="keys-row-${i}" hidden="">` +
            `<td colspan="3"><div class="idx-keys-container" id="keys-container-${i}"></div></td>` +
            `</tr>`;
    }).join('');
}

// ── Index keys expansion ───────────────────────

async function toggleKeys(idx, showKeysBy) {
    const keysRow = el(`keys-row-${idx}`);
    const container = el(`keys-container-${idx}`);
    if (!keysRow || !container) return;

    // If already showing same mode, toggle off
    if (!keysRow.hidden && container.dataset.mode === showKeysBy) {
        keysRow.hidden = true;
        return;
    }

    const ix = currentIndexes[idx];
    if (!ix) return;

    container.dataset.mode = showKeysBy;
    container.dataset.idx = idx;
    keysRow.hidden = false;

    await fetchAndRenderKeys(container, ix, showKeysBy, 10, '');
}

async function fetchAndRenderKeys(container, ix, showKeysBy, max, startValue) {
    // Keep the controls visible while loading — only replace the results area
    const existingControls = container.querySelector('.idx-keys-controls');
    const existingHeader = container.querySelector('.idx-keys-header');
    if (!existingControls) {
        container.innerHTML = '<span class="spinner"></span> Loading index keys...';
    } else {
        // Just show a loading indicator in the results area
        const resultsArea = container.querySelector('.idx-keys-results');
        if (resultsArea) resultsArea.innerHTML = '<span class="spinner"></span> Loading...';
    }

    const data = await loadKeys(currentCollection, ix.item, ix.type, showKeysBy, max, startValue);

    const indexLabel = `${ix.type} Index on ${ix.item}`;
    const keyCount = data?.keys?.length || 0;
    const elapsed = data?.elapsed || '';

    // Build the full content
    let html = `<div class="idx-keys-header">` +
        `<strong>${escapeHtml(indexLabel)}</strong>` +
        `<div class="idx-keys-meta">${keyCount} keys returned in ${elapsed}</div>` +
        `<div class="idx-keys-desc">Keys for the ${escapeHtml(ix.type)} index defined on "${escapeHtml(ix.item)}" in the ` +
        `<a href="${BASE}/collections?collection=${encodeURIComponent(currentCollection)}">${escapeHtml(currentCollection)}</a> collection, by ${escapeHtml(showKeysBy)}.</div>` +
        `</div>`;

    // Controls
    html += `<div class="idx-keys-controls">` +
        `<label><strong>Max number returned:</strong> ` +
        `<select class="idx-max-select">` +
        [10, 25, 50, 100].map(n =>
            `<option value="${n}"${n === max ? ' selected' : ''}>${n}</option>`
        ).join('') +
        `</select></label>` +
        `<label><strong>Find terms starting with:</strong> ` +
        `<input type="text" class="idx-start-input input-md" value="${escapeHtml(startValue)}"/>` +
        `<button type="button" class="btn btn-sm btn-primary idx-search-btn">&#128269;</button>` +
        `</label>` +
        `</div>`;

    // Results area
    html += `<div class="idx-keys-results">`;
    if (keyCount === 0) {
        html += '<p class="empty-state" style="padding: 0.5rem;">No index keys found</p>';
    } else {
        html += `<table class="data-table idx-keys-table">`;
        html += `<thead><tr><th>term</th><th>frequency</th><th>documents</th><th>position</th></tr></thead>`;
        html += `<tbody>`;
        data.keys.forEach(k => {
            html += `<tr><td>${escapeHtml(String(k.term))}</td>` +
                `<td>${k.frequency}</td>` +
                `<td>${k.documents}</td>` +
                `<td>${k.position}</td></tr>`;
        });
        html += `</tbody></table>`;
    }
    html += `</div>`;

    container.innerHTML = html;

    // Bind controls — use event delegation to avoid rebinding issues
    const maxSelect = container.querySelector('.idx-max-select');
    const startInput = container.querySelector('.idx-start-input');
    const searchBtn = container.querySelector('.idx-search-btn');

    const doSearch = (e) => {
        if (e) e.preventDefault();
        const newMax = parseInt(maxSelect?.value) || 10;
        const newStart = startInput?.value?.trim() || '';
        fetchAndRenderKeys(container, ix, showKeysBy, newMax, newStart);
    };

    if (searchBtn) searchBtn.addEventListener('click', doSearch);
    if (startInput) startInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch(e);
    });
    if (maxSelect) maxSelect.addEventListener('change', doSearch);
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

    // Delegation for QName/Node/Field links
    el('idx-body')?.addEventListener('click', (e) => {
        const link = e.target.closest('.view-keys-link');
        if (link) {
            e.preventDefault();
            toggleKeys(parseInt(link.dataset.idx), link.dataset.by);
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
