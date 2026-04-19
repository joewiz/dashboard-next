/**
 * Collections API client — fetch wrappers for exist-api endpoints.
 */

import { API_BASE } from './dashboard.js';

const FETCH_OPTS = { credentials: 'include' };

async function request(url, opts = {}) {
    try {
        const resp = await fetch(url, { ...FETCH_OPTS, ...opts });
        if (!resp.ok) return { ok: false, status: resp.status, data: null };
        const text = await resp.text();
        const data = text ? JSON.parse(text) : null;
        return { ok: true, status: resp.status, data };
    } catch {
        return { ok: false, status: 0, data: null };
    }
}

function jsonBody(body) {
    return {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    };
}

// ── Collection listing ────────────────────────

export async function listCollection(path) {
    return request(`${API_BASE}/db?path=${encodeURIComponent(path)}`);
}

export async function listCollectionsOnly(path) {
    return request(`${API_BASE}/db?path=${encodeURIComponent(path)}&collections-only=true`);
}

// ── Resources ─────────────────────────────────

/**
 * Get resource metadata and content via exist-api.
 * Returns { ok, data: { content, "mime-type", path, binary } }
 */
export async function getResource(path) {
    return request(`${API_BASE}/db/resource?path=${encodeURIComponent(path)}`);
}

/**
 * Download a resource by fetching its raw content and triggering a browser download.
 * Fetches the raw content directly from the exist-api endpoint using a blob response.
 */
export async function downloadResource(path) {
    const filename = path.substring(path.lastIndexOf('/') + 1);
    try {
        // Fetch raw content using the REST API (accept any content type)
        const resp = await fetch(`${API_BASE}/db/resource?path=${encodeURIComponent(path)}`, FETCH_OPTS);
        if (!resp.ok) return;
        // The exist-api returns JSON with content — extract and create a blob
        const data = await resp.json();
        const mime = data['mime-type'] || 'application/octet-stream';
        const content = data.content || '';
        let blob;
        if (data.binary) {
            // Raw binary bytes in the string — encode to blob via charCodes
            const bytes = new Uint8Array(content.length);
            for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xFF;
            blob = new Blob([bytes], { type: mime });
        } else {
            blob = new Blob([content], { type: mime });
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch { /* silent */ }
}

/**
 * Upload a file to a collection via exist-api PUT /api/db/resource.
 * All files are read as text and sent via the JSON body, which uses
 * cookie auth and avoids triggering the browser's native auth dialog.
 */
export async function storeResource(collectionPath, file) {
    const targetPath = collectionPath + '/' + file.name;
    const mime = file.type || 'application/octet-stream';
    try {
        const content = await file.text();
        return request(`${API_BASE}/db/resource`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: targetPath, content, 'mime-type': mime }),
        });
    } catch {
        return { ok: false, status: 0, data: null };
    }
}

export async function deleteResource(path) {
    return request(`${API_BASE}/db/resource?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
    });
}

// ── Collections ───────────────────────────────

export async function createCollection(path) {
    return request(`${API_BASE}/db/collection`, jsonBody({ path }));
}

export async function deleteCollection(path) {
    return request(`${API_BASE}/db/collection?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
    });
}

// ── Copy / Move ───────────────────────────────

/**
 * Copy a resource or collection to a target collection.
 * @param {string} source - full db path of the source
 * @param {string} targetCollection - destination collection path
 */
export async function copyItem(source, targetCollection) {
    return request(`${API_BASE}/db/copy`, jsonBody({ source, target: targetCollection }));
}

/**
 * Move a resource or collection to a target collection.
 * @param {string} source - full db path of the source
 * @param {string} targetCollection - destination collection path
 */
export async function moveItem(source, targetCollection) {
    return request(`${API_BASE}/db/move`, jsonBody({ source, target: targetCollection }));
}

/**
 * Rename a resource or collection.
 * @param {string} path - full db path of the item
 * @param {string} newName - new name (not a path)
 */
export async function renameItem(path, newName) {
    return request(`${API_BASE}/db/move`, jsonBody({ source: path, newName }));
}

/**
 * Download a collection as a ZIP archive.
 * Uses the exist-api GET /api/db/collection endpoint which streams
 * the ZIP directly with proper Content-Disposition headers.
 */
export async function downloadCollection(path) {
    const collName = path.substring(path.lastIndexOf('/') + 1);
    try {
        const resp = await fetch(
            `${API_BASE}/db/collection?path=${encodeURIComponent(path)}`,
            FETCH_OPTS
        );
        if (!resp.ok) return;
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = collName + '.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch { /* silent */ }
}

// ── Properties & Permissions ──────────────────

export async function getProperties(path) {
    return request(`${API_BASE}/db/properties?path=${encodeURIComponent(path)}`);
}

export async function setPermissions(path, owner, group, mode) {
    return request(`${API_BASE}/db/permissions`, jsonBody({ path, owner, group, mode }));
}

// ── Users & Groups ────────────────────────────

export async function whoami() {
    return request(`${API_BASE}/users/whoami`);
}

export async function listUsers() {
    return request(`${API_BASE}/users`);
}

export async function listGroups() {
    return request(`${API_BASE}/groups`);
}
