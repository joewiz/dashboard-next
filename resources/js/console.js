/**
 * Console tab — XQuery execution via WebSocket /ws/eval with HTTP fallback.
 */

import { fetchJSON, API_BASE } from './dashboard.js';

let ws = null;
let queryId = null;
let resultChunks = [];

const HISTORY_KEY = 'dashboard.queryHistory';
const MAX_HISTORY = 30;

// ── Elements ───────────────────────────────────

function el(id) { return document.getElementById(id); }

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ── WebSocket connection ───────────────────────

function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = location.pathname.replace(/^(.*?)\/(apps\/)?dashboard\/.*$/, '$1');
    return `${proto}://${location.host}${base}/ws/eval`;
}

function connectWebSocket() {
    return new Promise((resolve) => {
        try {
            const socket = new WebSocket(wsUrl());
            socket.onopen = () => resolve(socket);
            socket.onerror = () => resolve(null);
            // If connection fails within 2s, fall back
            setTimeout(() => { if (socket.readyState !== WebSocket.OPEN) resolve(null); }, 2000);
        } catch {
            resolve(null);
        }
    });
}

// ── Execute via WebSocket ──────────────────────

async function execWebSocket(query, serialization) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        ws = await connectWebSocket();
    }
    if (!ws) return execHttpFallback(query, serialization);

    return new Promise((resolve, reject) => {
        queryId = 'q-' + Date.now();
        resultChunks = [];

        ws.onmessage = (evt) => {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'progress') {
                setStatus(`Evaluating... ${msg.items || 0} items, ${msg.elapsed || 0} ms`);
            } else if (msg.type === 'result') {
                if (msg.data) resultChunks.push(msg.data);
                if (!msg.more) {
                    queryId = null;
                    resolve({
                        result: resultChunks.join(''),
                        items: msg.items || 0,
                        timing: msg.timing || {}
                    });
                }
            } else if (msg.type === 'error') {
                queryId = null;
                reject(msg);
            } else if (msg.type === 'cancelled') {
                queryId = null;
                reject({ message: 'Query cancelled' });
            }
        };

        ws.send(JSON.stringify({
            action: 'eval',
            id: queryId,
            query: query,
            serialization: { method: serialization },
            streaming: true,
            'chunk-size': 100
        }));
    });
}

// ── Execute via HTTP fallback ──────────────────

async function execHttpFallback(query, serialization) {
    // Try exist-api cursor endpoint first
    const execResp = await fetch(`${API_BASE}/query`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
    });

    if (execResp.ok) {
        const exec = await execResp.json();
        if (exec.error) throw exec;
        // Fetch all results
        const resultsResp = await fetch(
            `${API_BASE}/query/${exec.cursor}/results?start=1&count=${exec.items || 100}&method=${serialization}&indent=yes`,
            { credentials: 'include' }
        );
        const resultText = await resultsResp.text();
        // Close cursor
        fetch(`${API_BASE}/query/${exec.cursor}`, { method: 'DELETE', credentials: 'include' });
        return {
            result: resultText,
            items: exec.items || 0,
            timing: exec.timing || {}
        };
    }

    // Last resort: direct POST to REST API
    const base = location.pathname.replace(/^(.*?)\/(apps\/)?dashboard\/.*$/, '$1');
    const restResp = await fetch(`${base}/rest/db?_howmany=200&_wrap=no&_method=POST`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/xml' },
        body: `<query xmlns="http://exist.sourceforge.net/NS/exist"><text><![CDATA[${query}]]></text><properties><property name="method" value="${serialization}"/><property name="indent" value="yes"/></properties></query>`
    });

    if (!restResp.ok) throw { message: `HTTP ${restResp.status}: ${restResp.statusText}` };
    return { result: await restResp.text(), items: 0, timing: {} };
}

// ── Cancel ─────────────────────────────────────

function cancelQuery() {
    if (ws && queryId) {
        ws.send(JSON.stringify({ action: 'cancel', id: queryId }));
    }
}

// ── UI helpers ─────────────────────────────────

function setStatus(text, cls) {
    const badge = el('console-status');
    if (!badge) return;
    badge.textContent = text;
    badge.className = 'status-badge ' + (cls || '');
}

function showResult(text) {
    const panel = el('result-panel');
    const error = el('error-panel');
    if (panel) { panel.textContent = text; panel.hidden = false; }
    if (error) error.hidden = true;
}

function showError(err) {
    const panel = el('error-panel');
    const result = el('result-panel');
    if (result) result.hidden = true;
    if (!panel) return;
    let msg = err.message || String(err);
    if (err.line) msg += ` [line ${err.line}`;
    if (err.column) msg += `, col ${err.column}`;
    if (err.line) msg += ']';
    if (err.code) msg = `${err.code}: ${msg}`;
    panel.textContent = msg;
    panel.hidden = false;
}

// ── History ────────────────────────────────────

function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
}

function saveHistory(query, items, elapsed) {
    const history = loadHistory();
    history.unshift({
        query: query.substring(0, 200),
        items, elapsed,
        time: new Date().toLocaleTimeString()
    });
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    const ul = el('history-list');
    if (!ul) return;
    const history = loadHistory();
    if (history.length === 0) {
        ul.innerHTML = '<li class="empty-state">No query history</li>';
        return;
    }
    ul.innerHTML = history.map((h, i) =>
        `<li class="history-item" data-idx="${i}">` +
        `<span class="history-time">${escapeHtml(h.time)}</span> ` +
        `<span class="history-query">${escapeHtml(h.query)}</span> ` +
        `<span class="history-meta">${h.items} items, ${h.elapsed} ms</span>` +
        `</li>`
    ).join('');
}

// ── Main run ───────────────────────────────────

async function runQuery() {
    const input = el('query-input');
    const serialization = el('serialization')?.value || 'adaptive';
    const query = input?.value?.trim();
    if (!query) return;

    el('run-btn').disabled = true;
    el('cancel-btn').disabled = false;
    setStatus('Executing...', 'status-on');
    el('result-info').textContent = '';

    try {
        const result = await execWebSocket(query, serialization);
        showResult(result.result);

        const elapsed = result.timing?.total || result.timing?.eval || 0;
        el('result-info').textContent = `${result.items} items in ${elapsed} ms`;
        setStatus('Done', 'status-off');
        saveHistory(query, result.items, elapsed);
    } catch (err) {
        showError(err);
        setStatus('Error', 'status-off');
    } finally {
        el('run-btn').disabled = false;
        el('cancel-btn').disabled = true;
    }
}

// ── Init ───────────────────────────────────────

function init() {
    if (!document.querySelector('.console-page')) return;

    el('run-btn')?.addEventListener('click', runQuery);
    el('cancel-btn')?.addEventListener('click', cancelQuery);
    el('clear-output')?.addEventListener('click', () => {
        const p = el('result-panel');
        const e = el('error-panel');
        if (p) { p.textContent = ''; p.hidden = false; }
        if (e) e.hidden = true;
        el('result-info').textContent = '';
    });

    // Ctrl+Enter to run
    el('query-input')?.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            runQuery();
        }
    });

    // History click to load
    el('history-list')?.addEventListener('click', (e) => {
        const item = e.target.closest('.history-item');
        if (!item) return;
        const history = loadHistory();
        const entry = history[parseInt(item.dataset.idx)];
        if (entry) el('query-input').value = entry.query;
    });

    renderHistory();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
