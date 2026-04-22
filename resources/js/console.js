/**
 * Console tab — Remote Development Console.
 *
 * Connects via WebSocket to receive console:log() messages from XQuery code
 * running on the server. This is the same as monex's Remote Console.
 *
 * Use the console XQuery module to send messages:
 *   import module namespace console="http://exist-db.org/xquery/console";
 *   console:log("Hello world!")
 */

const MAX_MESSAGES = 200;
let connection = null;
let currentChannel = 'default';

function el(id) { return document.getElementById(id); }

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ── WebSocket connection ──────────────────────

function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = location.pathname.replace(/^(.*?)\/(apps\/)?dashboard\/.*$/, '$1');
    return `${proto}://${location.host}${base}/ws`;
}

function connect() {
    const statusEl = el('console-status');
    try {
        connection = new WebSocket(wsUrl());

        connection.onerror = () => {
            if (statusEl) { statusEl.textContent = 'Connection error'; statusEl.className = 'status-badge status-error'; }
        };

        connection.onclose = () => {
            if (statusEl) { statusEl.textContent = 'Disconnected'; statusEl.className = 'status-badge status-off'; }
            // Reconnect after 5 seconds
            setTimeout(connect, 5000);
        };

        connection.onopen = () => {
            if (statusEl) { statusEl.textContent = 'Connected.'; statusEl.className = 'status-badge status-on'; }
            connection.send(JSON.stringify({ channel: currentChannel }));
        };

        connection.onmessage = (e) => {
            if (e.data === 'ping') return;
            handleMessage(JSON.parse(e.data));
        };
    } catch (err) {
        if (statusEl) { statusEl.textContent = 'WebSocket not available'; statusEl.className = 'status-badge status-error'; }
    }
}

// ── Message handling ──────────────────────────

function handleMessage(data) {
    const tbody = el('console-body');
    if (!tbody) return;

    // Hide the "No messages" placeholder
    const placeholder = tbody.querySelector('.empty-state');
    if (placeholder) placeholder.closest('tr')?.remove();

    // Limit buffer size
    const rows = tbody.querySelectorAll('tr');
    if (rows.length >= MAX_MESSAGES) {
        rows[0].remove();
    }

    const time = data.timestamp
        ? data.timestamp.replace(/^.*T([^+.]+).*$/, '$1')
        : '--';
    const source = data.source
        ? data.source.replace(/^.*\/([^/]+)$/, '$1')
        : 'unknown';
    const lineCol = data.line
        ? `${data.line} / ${data.column}`
        : '- / -';

    let message;
    if (data.json) {
        try {
            const json = JSON.parse(data.message);
            message = Object.entries(json)
                .map(([k, v]) => `<strong>$${escapeHtml(k)}</strong>: ${escapeHtml(String(v))}`)
                .join('<br>');
        } catch {
            message = escapeHtml(data.message);
        }
    } else {
        message = escapeHtml(data.message || '');
    }

    const tr = document.createElement('tr');
    tr.className = 'console-message';
    tr.innerHTML =
        `<td class="console-time">${escapeHtml(time)}</td>` +
        `<td class="console-source" title="${escapeHtml(data.source || '')}">${escapeHtml(source)}</td>` +
        `<td class="console-linecol">${escapeHtml(lineCol)}</td>` +
        `<td class="console-msg">${message}</td>`;

    tbody.appendChild(tr);
    tr.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ── Channel switching ─────────────────────────

function setChannel(channel) {
    currentChannel = channel || 'default';
    if (connection && connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify({ channel: currentChannel }));
    }
    // Save preference
    try { localStorage.setItem('dashboard.console.channel', currentChannel); } catch {}
}

function restoreChannel() {
    try {
        currentChannel = localStorage.getItem('dashboard.console.channel') || 'default';
    } catch {
        currentChannel = 'default';
    }
    const input = el('channel-input');
    if (input) input.value = currentChannel;
}

// ── Clear ─────────────────────────────────────

function clearConsole() {
    const tbody = el('console-body');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No messages</td></tr>';
    }
}

// ── Init ───────────────────────────────────────

function init() {
    if (!document.querySelector('.console-page')) return;

    restoreChannel();
    connect();

    el('set-channel')?.addEventListener('click', () => {
        setChannel(el('channel-input')?.value);
    });

    el('channel-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            setChannel(el('channel-input')?.value);
        }
    });

    el('clear-console')?.addEventListener('click', clearConsole);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
