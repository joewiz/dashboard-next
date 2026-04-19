/**
 * Collections browser — browse, manage, and upload resources in eXist-db.
 */

import { formatBytes, showToast } from './dashboard.js';
import * as api from './collections-api.js';

function el(id) { return document.getElementById(id); }

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ── State ─────────────────────────────────────

let currentPath = '/db';
let resources = [];           // current listing (collections + resources)
let selectedPaths = new Set();
let lastClickedIndex = -1;    // for Shift+Click range select
let clipboard = null;         // { paths: [], mode: 'copy'|'move' }
let currentUser = null;       // { user: string, groups: string[] }
let canWrite = false;          // whether current user can write to currentPath
const expandedNodes = new Set(['/db']);
const sortState = { key: 'name', asc: true };
let filterText = '';

// ── Context path ──────────────────────────────

const contextPath = location.pathname.replace(/^(.*?)\/(apps\/)?dashboard\/.*$/, '$1');

// ── Helpers ───────────────────────────────────

function parentPath(path) {
    if (path === '/db') return null;
    const i = path.lastIndexOf('/');
    return i <= 0 ? '/db' : path.substring(0, i);
}

function basename(path) {
    return path.substring(path.lastIndexOf('/') + 1);
}

function isCollection(item) {
    return item.type === 'collection';
}

function isTextMime(mime) {
    if (!mime) return false;
    if (mime.startsWith('text/')) return true;
    if (mime === 'application/xml' || mime.endsWith('+xml')) return true;
    if (mime === 'application/json' || mime.endsWith('+json')) return true;
    if (mime === 'application/xquery' || mime === 'application/javascript') return true;
    if (mime === 'image/svg+xml') return true;
    return false;
}

function isBinary(item) {
    const mime = item.mime || '';
    if (isTextMime(mime)) return false;
    if (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')) return true;
    if (mime === 'application/octet-stream' || mime === 'application/pdf' || mime === 'application/zip') return true;
    return false;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const now = new Date();
    const opts = d.getFullYear() === now.getFullYear()
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'short', day: 'numeric' };
    return d.toLocaleDateString(undefined, opts);
}

function modeString(mode) {
    if (typeof mode === 'string' && mode.length >= 9) return mode;
    if (typeof mode !== 'number') return '';
    const chars = 'rwxrwxrwx';
    let s = '';
    for (let i = 8; i >= 0; i--) {
        s += (mode & (1 << i)) ? chars[8 - i] : '-';
    }
    return s;
}

/**
 * Parse a mode string like "rwxr-xr-x" into a numeric mode value.
 */
function parseMode(mode) {
    if (typeof mode === 'number') return mode;
    if (typeof mode !== 'string' || mode.length < 9) return 0;
    // Handle optional leading character (e.g., "d" for directory) or special bits
    const str = mode.length > 9 ? mode.slice(-9) : mode;
    let val = 0;
    const map = { r: 4, w: 2, x: 1, s: 1, S: 0, t: 1, T: 0 };
    for (let i = 0; i < 9; i++) {
        const c = str[i];
        const shift = 8 - i;
        if (map[c] !== undefined) {
            val |= (map[c] << shift);
        }
        // Handle setUID/setGID/sticky from s/S/t/T
        if (i === 2 && (c === 's' || c === 'S')) val |= (1 << 11); // setUID
        if (i === 5 && (c === 's' || c === 'S')) val |= (1 << 10); // setGID
        if (i === 8 && (c === 't' || c === 'T')) val |= (1 << 9);  // sticky
    }
    return val;
}

/**
 * Check if the current user has write permission on a collection.
 * Parses the mode string (e.g., "rwxr-xr-x") against user/group ownership.
 */
function checkWriteAccess(collectionData) {
    if (!currentUser || !collectionData) return false;
    const groups = currentUser.groups || [];
    // DBA group members always have full access
    if (groups.includes('dba')) return true;
    const mode = collectionData.mode || '';
    if (mode.length < 9) return false;
    const user = currentUser.user;
    // Owner
    if (user === collectionData.owner) return mode[1] === 'w';
    // Group
    if (groups.includes(collectionData.group)) return mode[4] === 'w';
    // Other
    return mode[7] === 'w';
}

function updateWriteControls() {
    el('coll-new-btn').disabled = !canWrite;
    el('coll-upload').disabled = !canWrite;
    // Toggle the upload label styling
    const uploadLabel = el('coll-upload')?.closest('.btn-file');
    if (uploadLabel) {
        uploadLabel.classList.toggle('disabled', !canWrite);
    }
}

// ── Syntax highlighting ───────────────────────

function highlightSyntax(text, mime) {
    if (mime === 'application/xml' || mime.endsWith('+xml') || mime === 'text/xml') {
        return highlightXml(text);
    }
    if (mime === 'application/json' || mime.endsWith('+json')) {
        return highlightJson(text);
    }
    if (mime === 'application/xquery') {
        return highlightXquery(text);
    }
    if (mime === 'text/css') {
        return highlightCss(text);
    }
    // Default: escape only
    return escapeHtml(text);
}

function highlightXml(text) {
    return escapeHtml(text)
        .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="hl-tag">$2</span>')
        .replace(/(\s)([\w:.-]+)(=)(&quot;[^&]*?&quot;)/g, '$1<span class="hl-attr">$2</span>$3<span class="hl-string">$4</span>')
        .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="hl-comment">$1</span>')
        .replace(/(&lt;\?[\s\S]*?\?&gt;)/g, '<span class="hl-comment">$1</span>')
        .replace(/(&lt;!\[CDATA\[[\s\S]*?\]\]&gt;)/g, '<span class="hl-comment">$1</span>');
}

function highlightJson(text) {
    return escapeHtml(text)
        .replace(/(&quot;[^&]*?&quot;)\s*:/g, '<span class="hl-attr">$1</span>:')
        .replace(/:\s*(&quot;[^&]*?&quot;)/g, ': <span class="hl-string">$1</span>')
        .replace(/:\s*(true|false|null)\b/g, ': <span class="hl-keyword">$1</span>')
        .replace(/:\s*(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, ': <span class="hl-number">$1</span>');
}

function highlightXquery(text) {
    const keywords = 'xquery|version|module|namespace|import|declare|variable|function|as|let|return|for|in|where|order|by|at|if|then|else|typeswitch|switch|case|default|try|catch|some|every|satisfies|instance|of|cast|castable|treat|element|attribute|document|text|comment|node|item|map|array|empty-sequence|xs|fn|local|external';
    let escaped = escapeHtml(text);
    // Comments
    escaped = escaped.replace(/(\(:[\s\S]*?:\))/g, '<span class="hl-comment">$1</span>');
    // Strings
    escaped = escaped.replace(/(&quot;[^&]*?&quot;)/g, '<span class="hl-string">$1</span>');
    escaped = escaped.replace(/(&#x27;[^&]*?&#x27;|'[^']*?')/g, '<span class="hl-string">$1</span>');
    // Keywords
    const kwRe = new RegExp(`\\b(${keywords})\\b`, 'g');
    escaped = escaped.replace(kwRe, '<span class="hl-keyword">$1</span>');
    // Variables
    escaped = escaped.replace(/(\$[\w:.-]+)/g, '<span class="hl-variable">$1</span>');
    // Function calls
    escaped = escaped.replace(/([\w:.-]+)\s*\(/g, '<span class="hl-function">$1</span>(');
    return escaped;
}

function highlightCss(text) {
    let escaped = escapeHtml(text);
    // Comments
    escaped = escaped.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-comment">$1</span>');
    // Strings
    escaped = escaped.replace(/(&quot;[^&]*?&quot;)/g, '<span class="hl-string">$1</span>');
    // Properties
    escaped = escaped.replace(/([\w-]+)\s*:/g, '<span class="hl-attr">$1</span>:');
    // Selectors (lines that end with {)
    escaped = escaped.replace(/^([^{}]+?)(\s*\{)/gm, '<span class="hl-tag">$1</span>$2');
    return escaped;
}

// ── Collection tree ───────────────────────────

async function loadTreeNode(path) {
    const result = await api.listCollectionsOnly(path);
    if (!result.ok) return [];
    // API returns { children: [...], ... } — extract the children array
    const data = result.data || {};
    const items = data.children || data || [];
    if (!Array.isArray(items)) return [];
    return items.map(item => {
        if (typeof item === 'string') return { name: item, path: path + '/' + item };
        return { name: item.name || basename(item.path), path: item.path };
    }).sort((a, b) => a.name.localeCompare(b.name));
}

async function renderTree() {
    const root = document.querySelector('.collections-tree-root');
    if (!root) return;
    root.innerHTML = '<span class="spinner"></span> Loading...';
    const children = await loadTreeNode('/db');
    root.innerHTML = '';
    const rootNode = createTreeNode('/db', 'db', 0, true);
    root.appendChild(rootNode.el);
    const childContainer = rootNode.el.querySelector('.tree-children');
    for (const child of children) {
        const node = createTreeNode(child.path, child.name, 1, false);
        childContainer.appendChild(node.el);
    }
    highlightTreeNode(currentPath);
}

function createTreeNode(path, name, depth, expanded) {
    const div = document.createElement('div');
    div.className = 'tree-node';
    div.dataset.path = path;

    const row = document.createElement('div');
    row.className = 'tree-node-row' + (path === currentPath ? ' active' : '');
    row.style.paddingLeft = (depth * 16 + 4) + 'px';

    const icon = document.createElement('span');
    icon.className = 'tree-icon' + (expanded ? ' expanded' : '');
    icon.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTreeNode(div, path, depth);
    });

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = name;

    row.appendChild(icon);
    row.appendChild(label);
    row.addEventListener('click', () => navigateTo(path));

    const childContainer = document.createElement('div');
    childContainer.className = 'tree-children';
    if (!expanded) childContainer.hidden = true;

    div.appendChild(row);
    div.appendChild(childContainer);

    if (expanded) expandedNodes.add(path);

    return { el: div };
}

async function toggleTreeNode(nodeEl, path, depth) {
    const childContainer = nodeEl.querySelector(':scope > .tree-children');
    const icon = nodeEl.querySelector(':scope > .tree-node-row > .tree-icon');

    if (expandedNodes.has(path)) {
        expandedNodes.delete(path);
        childContainer.hidden = true;
        icon.classList.remove('expanded');
    } else {
        expandedNodes.add(path);
        childContainer.hidden = false;
        icon.classList.add('expanded');
        // Lazy-load if empty
        if (childContainer.children.length === 0) {
            childContainer.innerHTML = '<div style="padding-left:' + ((depth + 1) * 16 + 4) + 'px;color:#999;font-size:0.8rem"><span class="spinner"></span></div>';
            const children = await loadTreeNode(path);
            childContainer.innerHTML = '';
            for (const child of children) {
                const node = createTreeNode(child.path, child.name, depth + 1, false);
                childContainer.appendChild(node.el);
            }
            if (children.length === 0) {
                childContainer.innerHTML = '<div style="padding-left:' + ((depth + 1) * 16 + 4) + 'px;color:#999;font-size:0.75rem;font-style:italic">no child collections</div>';
            }
        }
    }
}

function highlightTreeNode(path) {
    document.querySelectorAll('.tree-node-row.active').forEach(r => r.classList.remove('active'));
    const node = document.querySelector(`.tree-node[data-path="${CSS.escape(path)}"] > .tree-node-row`);
    if (node) node.classList.add('active');
}

async function expandTreeToPath(path) {
    // Ensure all ancestors are expanded in the tree
    const parts = path.split('/').filter(Boolean);
    let accumulated = '';
    for (let i = 0; i < parts.length; i++) {
        accumulated += '/' + parts[i];
        if (!expandedNodes.has(accumulated)) {
            const nodeEl = document.querySelector(`.tree-node[data-path="${CSS.escape(accumulated)}"]`);
            if (nodeEl) {
                const depth = i;
                await toggleTreeNode(nodeEl, accumulated, depth);
            }
        }
    }
}

// ── Breadcrumb ────────────────────────────────

function renderBreadcrumb(path) {
    const container = el('collections-breadcrumb');
    if (!container) return;
    const parts = path.split('/').filter(Boolean);
    let html = '';
    let accumulated = '';
    for (let i = 0; i < parts.length; i++) {
        accumulated += '/' + parts[i];
        const p = accumulated;
        if (i > 0) html += ' <span class="breadcrumb-sep">/</span> ';
        if (i === parts.length - 1) {
            html += `<span class="breadcrumb-current">${escapeHtml(parts[i])}</span>`;
        } else {
            html += `<a class="breadcrumb-link" href="#" data-path="${escapeHtml(p)}">${escapeHtml(parts[i])}</a>`;
        }
    }
    container.innerHTML = html;
    container.querySelectorAll('.breadcrumb-link').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(a.dataset.path);
        });
    });
}

// ── Resource list ─────────────────────────────

async function loadResources(path) {
    const result = await api.listCollection(path);
    if (!result.ok) {
        if (result.status === 403) {
            resources = [];
            renderResources();
            showToast('Permission denied: ' + path, 'error');
        } else {
            showToast('Failed to load collection', 'error');
        }
        return;
    }
    // API returns { children: [...], owner, group, mode, ... }
    const data = result.data || {};
    resources = data.children || (Array.isArray(data) ? data : []);
    canWrite = checkWriteAccess(data);
    selectedPaths.clear();
    lastClickedIndex = -1;
    renderResources();
    updateActionBar();
    updateWriteControls();
    hideInfoBar();
}

function sortedResources() {
    // Split into collections and resources
    const colls = resources.filter(isCollection);
    const res = resources.filter(r => !isCollection(r));

    const sorter = (a, b) => {
        let av, bv;
        switch (sortState.key) {
            case 'name':
                av = (a.name || '').toLowerCase();
                bv = (b.name || '').toLowerCase();
                return sortState.asc ? av.localeCompare(bv) : bv.localeCompare(av);
            case 'type':
                av = (a.mime || a.type || '').toLowerCase();
                bv = (b.mime || b.type || '').toLowerCase();
                return sortState.asc ? av.localeCompare(bv) : bv.localeCompare(av);
            case 'size':
                av = a.size || 0;
                bv = b.size || 0;
                return sortState.asc ? av - bv : bv - av;
            case 'modified':
                av = a.modified || '';
                bv = b.modified || '';
                return sortState.asc ? av.localeCompare(bv) : bv.localeCompare(av);
            default:
                return 0;
        }
    };

    colls.sort(sorter);
    res.sort(sorter);
    return [...colls, ...res];
}

function filteredResources() {
    const sorted = sortedResources();
    if (!filterText) return sorted;
    const lower = filterText.toLowerCase();
    return sorted.filter(r => (r.name || '').toLowerCase().includes(lower));
}

function renderResources() {
    const tbody = el('resource-body');
    if (!tbody) return;

    const items = filteredResources();
    updateSortHeaders();

    if (items.length === 0) {
        const msg = resources.length === 0
            ? 'This collection is empty'
            : 'No items match the filter';
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">${msg}</td></tr>`;
        el('coll-select-all').checked = false;
        return;
    }

    tbody.innerHTML = items.map((item, idx) => {
        const path = item.path;
        const checked = selectedPaths.has(path) ? ' checked' : '';
        const cut = clipboard?.mode === 'move' && clipboard.paths.includes(path) ? ' class="cut-item"' : '';
        const icon = isCollection(item) ? 'folder' : 'file';
        const typeStr = isCollection(item) ? 'collection' : (item.mime || '');
        const sizeStr = isCollection(item) ? '' : formatBytes(item.size || 0);
        const dateStr = formatDate(item.modified);

        return `<tr data-path="${escapeHtml(path)}" data-index="${idx}"${cut}>` +
            `<td class="col-checkbox"><input type="checkbox" class="row-check" data-path="${escapeHtml(path)}"${checked}/></td>` +
            `<td class="col-name"><span class="resource-icon ${icon}"></span>${escapeHtml(item.name)}</td>` +
            `<td class="col-type">${escapeHtml(typeStr)}</td>` +
            `<td class="col-size">${sizeStr}</td>` +
            `<td class="col-modified">${dateStr}</td>` +
            `</tr>`;
    }).join('');

    // Update select-all checkbox
    const allChecked = items.length > 0 && items.every(r => selectedPaths.has(r.path));
    el('coll-select-all').checked = allChecked;
}

/**
 * Update checkbox states and row styling without rebuilding the table DOM.
 * This preserves elements so dblclick events fire correctly.
 */
function updateRowCheckboxes() {
    const tbody = el('resource-body');
    if (!tbody) return;
    tbody.querySelectorAll('tr[data-path]').forEach(tr => {
        const path = tr.dataset.path;
        const cb = tr.querySelector('.row-check');
        if (cb) cb.checked = selectedPaths.has(path);
        // Update cut styling
        if (clipboard?.mode === 'move' && clipboard.paths.includes(path)) {
            tr.classList.add('cut-item');
        } else {
            tr.classList.remove('cut-item');
        }
    });
    // Update select-all
    const items = filteredResources();
    const allChecked = items.length > 0 && items.every(r => selectedPaths.has(r.path));
    el('coll-select-all').checked = allChecked;
}

function updateSortHeaders() {
    const table = el('resource-table');
    if (!table) return;
    table.querySelectorAll('th[data-sort]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === sortState.key) {
            th.classList.add(sortState.asc ? 'sort-asc' : 'sort-desc');
        }
    });
}

// ── Navigation ────────────────────────────────

async function navigateTo(path) {
    currentPath = path;
    renderBreadcrumb(path);
    await loadResources(path);
    highlightTreeNode(path);
    await expandTreeToPath(path);
    el('coll-up-btn').disabled = path === '/db';
}

// ── Selection ─────────────────────────────────

function handleRowClick(e) {
    const tr = e.target.closest('tr[data-path]');
    if (!tr) return;
    const path = tr.dataset.path;
    const index = parseInt(tr.dataset.index);

    // Checkbox click
    if (e.target.classList.contains('row-check')) {
        if (e.target.checked) {
            selectedPaths.add(path);
        } else {
            selectedPaths.delete(path);
        }
        lastClickedIndex = index;
        updateActionBar();
        updateInfoBar();
        return;
    }

    const items = filteredResources();
    const item = items[index];

    // Shift+Click: range select
    if (e.shiftKey && lastClickedIndex >= 0) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        for (let i = start; i <= end; i++) {
            selectedPaths.add(items[i].path);
        }
        updateRowCheckboxes();
        updateActionBar();
        updateInfoBar();
        return;
    }

    // Ctrl/Cmd+Click: toggle
    if (e.ctrlKey || e.metaKey) {
        if (selectedPaths.has(path)) {
            selectedPaths.delete(path);
        } else {
            selectedPaths.add(path);
        }
        lastClickedIndex = index;
        updateRowCheckboxes();
        updateActionBar();
        updateInfoBar();
        return;
    }

    // Single click: select only this item
    selectedPaths.clear();
    selectedPaths.add(path);
    lastClickedIndex = index;
    updateRowCheckboxes();
    updateActionBar();
    updateInfoBar();
}

function handleRowDblClick(e) {
    const tr = e.target.closest('tr[data-path]');
    if (!tr) return;
    // Don't trigger on checkbox double-click
    if (e.target.classList.contains('row-check')) return;
    const path = tr.dataset.path;
    const items = filteredResources();
    const item = items.find(r => r.path === path);
    if (!item) return;

    if (isCollection(item)) {
        navigateTo(path);
    } else {
        showPreview(item);
    }
}

function handleSelectAll(e) {
    const items = filteredResources();
    if (e.target.checked) {
        items.forEach(r => selectedPaths.add(r.path));
    } else {
        selectedPaths.clear();
    }
    renderResources();
    updateActionBar();
}

// ── Info bar ──────────────────────────────────

function updateInfoBar() {
    if (selectedPaths.size !== 1) {
        hideInfoBar();
        return;
    }
    const path = [...selectedPaths][0];
    const item = resources.find(r => r.path === path);
    if (!item) { hideInfoBar(); return; }

    const details = el('info-details');
    const actions = el('info-actions');
    const infoBar = el('collections-info');

    const typeStr = isCollection(item) ? 'collection' : (item.mime || 'unknown');
    const sizeStr = isCollection(item) ? '' : ` | ${formatBytes(item.size || 0)}`;
    const modeStr = item.mode ? ` | ${modeString(item.mode)}` : '';
    const ownerStr = item.owner ? ` | ${item.owner}` : '';
    const groupStr = item.group ? `:${item.group}` : '';

    details.textContent = `${item.name} | ${typeStr}${sizeStr}${modeStr}${ownerStr}${groupStr}`;

    let actionsHtml = '';
    if (!isCollection(item) && !isBinary(item)) {
        actionsHtml += `<a class="btn btn-sm" href="${escapeHtml(exideUrl(path))}" target="eXide">Open in eXide</a> `;
    }
    actionsHtml += `<button class="btn btn-sm info-download" data-path="${escapeHtml(path)}" data-type="${isCollection(item) ? 'collection' : 'resource'}">Download</button>`;
    actions.innerHTML = actionsHtml;
    infoBar.hidden = false;
}

function hideInfoBar() {
    const infoBar = el('collections-info');
    if (infoBar) infoBar.hidden = true;
}

// ── Action bar ────────────────────────────────

function updateActionBar() {
    const bar = el('collections-actions');
    const count = selectedPaths.size;
    bar.hidden = count === 0;
    el('action-count').textContent = `${count} selected`;
    el('action-paste').disabled = !clipboard;
    el('action-permissions').disabled = count !== 1;
}

// ── eXide integration ─────────────────────────

function exideUrl(dbPath) {
    return `${contextPath}/apps/eXide/?open=${encodeURIComponent(dbPath)}`;
}

function openInExide(dbPath) {
    // Always append a timestamp to force eXide to re-read the open parameter
    const url = exideUrl(dbPath) + '&t=' + Date.now();
    window.open(url, 'eXide');
}

// ── Preview dialog ────────────────────────────

async function showPreview(item) {
    const path = item.path;
    const dialog = el('preview-dialog');
    const title = el('preview-title');
    const body = el('preview-body');
    const exideBtn = el('preview-exide');
    const downloadBtn = el('preview-download');

    title.textContent = item.name;
    body.innerHTML = '<div style="text-align:center;padding:2rem"><span class="spinner"></span> Loading...</div>';
    dialog.hidden = false;

    // Show/hide eXide button based on file type
    if (isBinary(item)) {
        exideBtn.hidden = true;
    } else {
        exideBtn.hidden = false;
        exideBtn.onclick = () => { openInExide(path); };
    }
    downloadBtn.onclick = () => { api.downloadResource(path); };

    const result = await api.getResource(path);
    if (!result.ok || !result.data) {
        body.innerHTML = '<div class="empty-state">Failed to load resource</div>';
        return;
    }

    const data = result.data;
    const mime = data['mime-type'] || item.mime || '';

    const content = data.content || '';
    const isBinaryContent = data.binary && !isTextMime(mime);

    if (isBinaryContent && mime.startsWith('image/')) {
        // Image preview — create blob from raw bytes
        const bytes = new Uint8Array(content.length);
        for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xFF;
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        body.innerHTML = `<div class="preview-image"><img src="${url}" alt="${escapeHtml(item.name)}"/></div>`;
    } else if (isBinaryContent && mime === 'application/pdf') {
        const bytes = new Uint8Array(content.length);
        for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xFF;
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        body.innerHTML = `<iframe class="preview-pdf" src="${url}"></iframe>`;
    } else if (isBinaryContent) {
        const size = formatBytes(content.length);
        body.innerHTML = `<div class="preview-binary">
            <div class="preview-binary-icon">&#128462;</div>
            <div class="preview-binary-info">
                <strong>${escapeHtml(item.name)}</strong><br/>
                ${escapeHtml(mime)} &middot; ${size}
            </div>
            <p>Binary file — download to view</p>
        </div>`;
    } else {
        // Text preview with syntax highlighting
        const highlighted = highlightSyntax(content, mime);
        body.innerHTML = `<pre class="preview-text">${highlighted}</pre>`;
    }
}

// ── CRUD operations ───────────────────────────

async function doCreateCollection() {
    const name = el('new-collection-name').value.trim();
    if (!name) return;
    if (!canWrite) {
        showToast('You do not have write access to this collection', 'error');
        return;
    }
    const path = currentPath + '/' + name;
    const result = await api.createCollection(path);
    if (result.ok) {
        showToast(`Created collection "${name}"`);
        el('create-collection-dialog').hidden = true;
        el('new-collection-name').value = '';
        await refreshCurrentView();
    } else {
        showToast(`Failed to create collection: ${result.status}`, 'error');
    }
}

async function doUploadFiles(files) {
    if (!files || files.length === 0) return;
    if (!canWrite) {
        showToast('You do not have write access to this collection', 'error');
        return;
    }
    let success = 0;
    let failed = 0;
    for (const file of files) {
        const result = await api.storeResource(currentPath, file);
        if (result.ok) {
            success++;
        } else {
            failed++;
        }
    }
    if (success > 0) showToast(`Uploaded ${success} file${success > 1 ? 's' : ''}`);
    if (failed > 0) showToast(`${failed} upload${failed > 1 ? 's' : ''} failed`, 'error');
    await refreshCurrentView();
}

async function doDelete() {
    if (selectedPaths.size === 0) return;
    const paths = [...selectedPaths];
    const names = paths.map(basename);
    const msg = names.length === 1
        ? `Delete "${names[0]}"?`
        : `Delete ${names.length} items?\n\n${names.join(', ')}`;

    el('delete-confirm-message').textContent = msg;
    el('delete-confirm-dialog').hidden = false;

    return new Promise(resolve => {
        const cleanup = () => {
            el('delete-confirm-yes').removeEventListener('click', onYes);
            el('delete-confirm-no').removeEventListener('click', onNo);
            el('delete-confirm-dialog').hidden = true;
        };
        const onYes = async () => {
            cleanup();
            let success = 0;
            let failed = 0;
            for (const path of paths) {
                const item = resources.find(r => r.path === path);
                const result = item && isCollection(item)
                    ? await api.deleteCollection(path)
                    : await api.deleteResource(path);
                if (result.ok) success++; else failed++;
            }
            if (success > 0) showToast(`Deleted ${success} item${success > 1 ? 's' : ''}`);
            if (failed > 0) showToast(`${failed} deletion${failed > 1 ? 's' : ''} failed`, 'error');
            selectedPaths.clear();
            await refreshCurrentView();
            resolve();
        };
        const onNo = () => { cleanup(); resolve(); };
        el('delete-confirm-yes').addEventListener('click', onYes);
        el('delete-confirm-no').addEventListener('click', onNo);
    });
}

async function doRename() {
    if (selectedPaths.size !== 1) return;
    const path = [...selectedPaths][0];
    const oldName = basename(path);
    el('rename-input').value = oldName;
    el('rename-dialog').hidden = false;
    el('rename-input').focus();
    el('rename-input').select();

    return new Promise(resolve => {
        const cleanup = () => {
            el('rename-confirm').removeEventListener('click', onConfirm);
            el('rename-cancel').removeEventListener('click', onCancel);
            el('rename-dialog').hidden = true;
        };
        const onConfirm = async () => {
            const newName = el('rename-input').value.trim();
            if (!newName || newName === oldName) { cleanup(); resolve(); return; }
            const result = await api.renameItem(path, newName);
            if (result.ok) {
                showToast(`Renamed to "${newName}"`);
                selectedPaths.clear();
                await refreshCurrentView();
            } else {
                showToast('Rename failed', 'error');
            }
            cleanup();
            resolve();
        };
        const onCancel = () => { cleanup(); resolve(); };
        el('rename-confirm').addEventListener('click', onConfirm);
        el('rename-cancel').addEventListener('click', onCancel);
    });
}

// ── Clipboard operations ──────────────────────

function doCut() {
    if (selectedPaths.size === 0) return;
    clipboard = { paths: [...selectedPaths], mode: 'move' };
    showToast(`Cut ${clipboard.paths.length} item${clipboard.paths.length > 1 ? 's' : ''}`);
    renderResources();
    updateActionBar();
}

function doCopy() {
    if (selectedPaths.size === 0) return;
    clipboard = { paths: [...selectedPaths], mode: 'copy' };
    showToast(`Copied ${clipboard.paths.length} item${clipboard.paths.length > 1 ? 's' : ''}`);
    updateActionBar();
}

async function doPaste() {
    if (!clipboard) return;
    let success = 0;
    let failed = 0;
    const fn = clipboard.mode === 'move' ? api.moveItem : api.copyItem;
    for (const sourcePath of clipboard.paths) {
        const result = await fn(sourcePath, currentPath);
        if (result.ok) success++; else failed++;
    }
    const action = clipboard.mode === 'move' ? 'Moved' : 'Copied';
    if (success > 0) showToast(`${action} ${success} item${success > 1 ? 's' : ''}`);
    if (failed > 0) showToast(`${failed} operation${failed > 1 ? 's' : ''} failed`, 'error');
    if (clipboard.mode === 'move') clipboard = null;
    selectedPaths.clear();
    await refreshCurrentView();
}

// ── Permissions dialog ────────────────────────

async function showPermissionsDialog() {
    if (selectedPaths.size !== 1) return;
    const path = [...selectedPaths][0];
    const propsResult = await api.getProperties(path);
    if (!propsResult.ok) {
        showToast('Failed to load properties', 'error');
        return;
    }
    const props = propsResult.data;

    // Load users and groups
    const [usersResult, groupsResult] = await Promise.all([api.listUsers(), api.listGroups()]);
    const users = usersResult.ok ? (usersResult.data || []) : [];
    const groups = groupsResult.ok ? (groupsResult.data || []) : [];

    const mode = parseMode(props.mode);

    let html = `<div class="form-field">
        <label>Resource</label>
        <div style="font-size:0.85rem;color:#333">${escapeHtml(path)}</div>
    </div>`;

    // Owner
    html += `<div class="form-field"><label for="perm-owner">Owner</label>
        <select id="perm-owner" class="full-width">`;
    const userList = Array.isArray(users) ? users : (users.users || []);
    for (const u of userList) {
        const name = typeof u === 'string' ? u : u.name;
        const sel = name === props.owner ? ' selected' : '';
        html += `<option value="${escapeHtml(name)}"${sel}>${escapeHtml(name)}</option>`;
    }
    html += `</select></div>`;

    // Group
    html += `<div class="form-field"><label for="perm-group">Group</label>
        <select id="perm-group" class="full-width">`;
    const groupList = Array.isArray(groups) ? groups : (groups.groups || []);
    for (const g of groupList) {
        const name = typeof g === 'string' ? g : g.name;
        const sel = name === props.group ? ' selected' : '';
        html += `<option value="${escapeHtml(name)}"${sel}>${escapeHtml(name)}</option>`;
    }
    html += `</select></div>`;

    // Permission matrix
    const labels = ['User', 'Group', 'Other'];
    const perms = ['Read', 'Write', 'Execute'];
    const specialLabels = ['setUID', 'setGID', 'Sticky'];

    html += `<div class="form-field"><label>Permissions</label>
        <div class="perm-display" id="perm-display">${modeString(mode)}</div>
        <table class="perm-matrix">
        <thead><tr><th></th><th>Read</th><th>Write</th><th>Execute</th><th>Special</th></tr></thead>
        <tbody>`;

    for (let row = 0; row < 3; row++) {
        html += `<tr><td class="perm-label">${labels[row]}</td>`;
        for (let col = 0; col < 3; col++) {
            const bit = 8 - (row * 3 + col);
            const checked = (mode & (1 << bit)) ? ' checked' : '';
            html += `<td><input type="checkbox" class="perm-bit" data-bit="${bit}"${checked}/></td>`;
        }
        // Special bit (setUID=11, setGID=10, sticky=9)
        const specialBit = 11 - row;
        const specialChecked = (mode & (1 << specialBit)) ? ' checked' : '';
        html += `<td><input type="checkbox" class="perm-bit" data-bit="${specialBit}"${specialChecked}/> ${specialLabels[row]}</td>`;
        html += `</tr>`;
    }
    html += `</tbody></table></div>`;

    el('permissions-content').innerHTML = html;
    el('permissions-dialog').hidden = false;

    // Update display string when checkboxes change
    el('permissions-content').querySelectorAll('.perm-bit').forEach(cb => {
        cb.addEventListener('change', () => {
            el('perm-display').textContent = modeString(readModeFromCheckboxes());
        });
    });
}

function readModeFromCheckboxes() {
    let mode = 0;
    el('permissions-content').querySelectorAll('.perm-bit').forEach(cb => {
        if (cb.checked) {
            mode |= (1 << parseInt(cb.dataset.bit));
        }
    });
    return mode;
}

async function savePermissions() {
    if (selectedPaths.size !== 1) return;
    const path = [...selectedPaths][0];
    const owner = el('perm-owner')?.value;
    const group = el('perm-group')?.value;
    const mode = readModeFromCheckboxes();
    // Convert to octal string for the API
    const modeStr = mode.toString(8).padStart(4, '0');
    const result = await api.setPermissions(path, owner, group, modeStr);
    if (result.ok) {
        showToast('Permissions updated');
        el('permissions-dialog').hidden = true;
        await refreshCurrentView();
    } else {
        showToast('Failed to update permissions', 'error');
    }
}

// ── Drag and drop upload ──────────────────────

function initDragDrop() {
    const container = el('resource-list');
    if (!container) return;

    // Prevent the browser's default file-open behavior on the entire page
    // so a missed drop doesn't navigate away or trigger auth dialogs
    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('drop', (e) => { e.preventDefault(); });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (canWrite) {
            container.classList.add('drag-over');
        }
    });

    container.addEventListener('dragleave', (e) => {
        if (!container.contains(e.relatedTarget)) {
            container.classList.remove('drag-over');
        }
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.remove('drag-over');
        if (!canWrite) {
            showToast('You do not have write access to this collection. Please log in.', 'error');
            return;
        }
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            doUploadFiles(files);
        }
    });
}

// ── Context menu ──────────────────────────────

let contextMenu = null;

function showContextMenu(e) {
    const tr = e.target.closest('tr[data-path]');
    if (!tr) return;
    e.preventDefault();

    const path = tr.dataset.path;
    const item = resources.find(r => r.path === path);
    if (!item) return;

    // Select the right-clicked item if not already selected
    if (!selectedPaths.has(path)) {
        selectedPaths.clear();
        selectedPaths.add(path);
        renderResources();
        updateActionBar();
        updateInfoBar();
    }

    removeContextMenu();
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';

    const menuItems = [];
    if (!isCollection(item)) {
        menuItems.push({ label: 'Preview...', action: () => showPreview(item) });
        if (!isBinary(item)) {
            menuItems.push({ label: 'Open in eXide', action: () => openInExide(path) });
        }
        menuItems.push({ label: 'Download', action: () => api.downloadResource(path) });
        menuItems.push({ type: 'separator' });
    } else {
        menuItems.push({ label: 'Download as ZIP', action: () => api.downloadCollection(path) });
        menuItems.push({ type: 'separator' });
    }
    menuItems.push({ label: 'Rename...', action: () => doRename() });
    menuItems.push({ label: 'Cut', action: () => doCut() });
    menuItems.push({ label: 'Copy', action: () => doCopy() });
    if (clipboard) {
        menuItems.push({ label: 'Paste', action: () => doPaste() });
    }
    menuItems.push({ type: 'separator' });
    menuItems.push({ label: 'Delete', action: () => doDelete(), danger: true });
    menuItems.push({ type: 'separator' });
    menuItems.push({ label: 'Properties...', action: () => showPermissionsDialog() });

    for (const mi of menuItems) {
        if (mi.type === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'context-menu-separator';
            contextMenu.appendChild(sep);
            continue;
        }
        const div = document.createElement('div');
        div.className = 'context-menu-item' + (mi.danger ? ' danger' : '');
        div.textContent = mi.label;
        div.addEventListener('click', () => {
            removeContextMenu();
            mi.action();
        });
        contextMenu.appendChild(div);
    }

    // Position
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    document.body.appendChild(contextMenu);

    // Adjust if off-screen
    requestAnimationFrame(() => {
        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            contextMenu.style.left = (e.pageX - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            contextMenu.style.top = (e.pageY - rect.height) + 'px';
        }
    });
}

function removeContextMenu() {
    if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
    }
}

// ── Keyboard shortcuts ────────────────────────

function handleKeydown(e) {
    // Only on the collections page
    if (!document.querySelector('.collections-page')) return;
    // Don't intercept when typing in inputs
    if (e.target.matches?.('input, textarea, select')) return;

    const items = filteredResources();
    const currentIndex = items.findIndex(r => selectedPaths.has(r.path));

    switch (e.key) {
        case 'ArrowDown': {
            e.preventDefault();
            const next = Math.min(currentIndex + 1, items.length - 1);
            if (next >= 0) {
                selectedPaths.clear();
                selectedPaths.add(items[next].path);
                lastClickedIndex = next;
                renderResources();
                updateActionBar();
                updateInfoBar();
                scrollRowIntoView(next);
            }
            break;
        }
        case 'ArrowUp': {
            e.preventDefault();
            const prev = Math.max(currentIndex - 1, 0);
            if (prev >= 0 && items.length > 0) {
                selectedPaths.clear();
                selectedPaths.add(items[prev].path);
                lastClickedIndex = prev;
                renderResources();
                updateActionBar();
                updateInfoBar();
                scrollRowIntoView(prev);
            }
            break;
        }
        case 'Enter': {
            if (selectedPaths.size !== 1) break;
            const path = [...selectedPaths][0];
            const item = items.find(r => r.path === path);
            if (item && isCollection(item)) navigateTo(path);
            else if (item) openInExide(path);
            break;
        }
        case 'Backspace':
        case 'Delete':
            if (selectedPaths.size > 0) doDelete();
            break;
        case 'F2':
            if (selectedPaths.size === 1) doRename();
            break;
        case 'Escape':
            // Close open dialogs first, then clear selection
            if (!el('preview-dialog')?.hidden) {
                el('preview-dialog').hidden = true;
            } else if (contextMenu) {
                removeContextMenu();
            } else {
                selectedPaths.clear();
                renderResources();
                updateActionBar();
                hideInfoBar();
            }
            break;
        case 'a':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                items.forEach(r => selectedPaths.add(r.path));
                renderResources();
                updateActionBar();
            }
            break;
        case 'c':
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); doCopy(); }
            break;
        case 'x':
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); doCut(); }
            break;
        case 'v':
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); doPaste(); }
            break;
    }
}

function scrollRowIntoView(index) {
    const row = document.querySelector(`tr[data-index="${index}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
}

// ── Refresh ───────────────────────────────────

async function refreshCurrentView() {
    await loadResources(currentPath);
    // Refresh the tree node for the current path
    const nodeEl = document.querySelector(`.tree-node[data-path="${CSS.escape(currentPath)}"]`);
    if (nodeEl && expandedNodes.has(currentPath)) {
        const childContainer = nodeEl.querySelector(':scope > .tree-children');
        if (childContainer) {
            childContainer.innerHTML = '';
            expandedNodes.delete(currentPath);
            await toggleTreeNode(nodeEl, currentPath, currentPath.split('/').filter(Boolean).length - 1);
        }
    }
}

// ── Dialog helpers ────────────────────────────

function closeOnOverlayClick(dialogId) {
    el(dialogId)?.addEventListener('click', (e) => {
        if (e.target === el(dialogId)) el(dialogId).hidden = true;
    });
}

// ── Init ──────────────────────────────────────

async function init() {
    if (!document.querySelector('.collections-page')) return;

    // Check current user
    const whoamiResult = await api.whoami();
    if (whoamiResult.ok && whoamiResult.data) {
        const w = whoamiResult.data;
        currentUser = {
            user: w.effective?.user || w.user || 'guest',
            groups: w.effective?.groups || w.groups || [],
        };
    } else {
        currentUser = { user: 'guest', groups: ['guest'] };
    }

    // Tree
    await renderTree();

    // Sorting
    el('resource-table')?.querySelectorAll('th[data-sort]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (sortState.key === key) {
                sortState.asc = !sortState.asc;
            } else {
                sortState.key = key;
                sortState.asc = true;
            }
            renderResources();
        });
    });

    // Filter
    el('coll-filter')?.addEventListener('input', (e) => {
        filterText = e.target.value;
        renderResources();
    });

    // Up button
    el('coll-up-btn')?.addEventListener('click', () => {
        const parent = parentPath(currentPath);
        if (parent) navigateTo(parent);
    });

    // Select all
    el('coll-select-all')?.addEventListener('change', handleSelectAll);

    // Row clicks and double-clicks
    el('resource-body')?.addEventListener('click', handleRowClick);
    el('resource-body')?.addEventListener('dblclick', handleRowDblClick);

    // Context menu
    el('resource-body')?.addEventListener('contextmenu', showContextMenu);
    document.addEventListener('click', removeContextMenu);

    // Action bar buttons
    el('action-cut')?.addEventListener('click', doCut);
    el('action-copy')?.addEventListener('click', doCopy);
    el('action-paste')?.addEventListener('click', doPaste);
    el('action-delete')?.addEventListener('click', doDelete);
    el('action-permissions')?.addEventListener('click', showPermissionsDialog);

    // Create collection dialog
    el('coll-new-btn')?.addEventListener('click', () => {
        el('new-collection-name').value = '';
        el('create-collection-dialog').hidden = false;
        el('new-collection-name').focus();
    });
    el('create-collection-confirm')?.addEventListener('click', doCreateCollection);
    el('create-collection-cancel')?.addEventListener('click', () => {
        el('create-collection-dialog').hidden = true;
    });
    el('new-collection-name')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doCreateCollection();
    });

    // Upload
    el('coll-upload')?.addEventListener('change', (e) => {
        doUploadFiles(e.target.files);
        e.target.value = '';
    });

    // Drag and drop
    initDragDrop();

    // Info bar download button (delegated)
    el('info-actions')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.info-download');
        if (!btn) return;
        if (btn.dataset.type === 'collection') {
            api.downloadCollection(btn.dataset.path);
        } else {
            api.downloadResource(btn.dataset.path);
        }
    });

    // Preview dialog
    el('preview-close')?.addEventListener('click', () => { el('preview-dialog').hidden = true; });
    el('preview-close-x')?.addEventListener('click', () => { el('preview-dialog').hidden = true; });

    // Permissions dialog
    el('permissions-save')?.addEventListener('click', savePermissions);
    el('permissions-cancel')?.addEventListener('click', () => { el('permissions-dialog').hidden = true; });
    el('permissions-close-x')?.addEventListener('click', () => { el('permissions-dialog').hidden = true; });

    // Rename dialog Enter key
    el('rename-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') el('rename-confirm')?.click();
    });

    // Close dialogs on overlay click
    closeOnOverlayClick('create-collection-dialog');
    closeOnOverlayClick('delete-confirm-dialog');
    closeOnOverlayClick('rename-dialog');
    closeOnOverlayClick('preview-dialog');
    closeOnOverlayClick('permissions-dialog');

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeydown);

    // Navigate to /db on load
    navigateTo('/db');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
