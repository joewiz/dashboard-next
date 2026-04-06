/**
 * Users tab — user and group management.
 * Uses dashboard's own XQuery endpoints (sm:* functions).
 */

const BASE = location.pathname.replace(/\/[^/]*$/, '');
let users = [];
let groups = [];

let activeDialog = null;

function showDialog(id) {
    el(id).hidden = false;
    activeDialog = id;
}

function hideDialog(id) {
    el(id).hidden = true;
    if (activeDialog === id) activeDialog = null;
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function el(id) { return document.getElementById(id); }

// ── Data fetching ──────────────────────────────

async function loadUsers() {
    const resp = await fetch(`${BASE}/users/data`, { credentials: 'include' });
    if (resp.ok) { const data = await resp.json(); users = data.users || []; renderUsers(); }
}

async function loadGroups() {
    const resp = await fetch(`${BASE}/users/groups-data`, { credentials: 'include' });
    if (resp.ok) { const data = await resp.json(); groups = data.groups || []; renderGroups(); }
}

// ── Render ─────────────────────────────────────

function renderUsers() {
    const tbody = el('users-body');
    if (!tbody) return;
    const filter = (el('user-filter')?.value || '').toLowerCase();
    const filtered = filter ? users.filter(u => u.name.toLowerCase().includes(filter)) : users;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No users found</td></tr>';
        return;
    }
    tbody.innerHTML = filtered.map(u =>
        `<tr><td>${escapeHtml(u.name)}</td>` +
        `<td>${escapeHtml((u.groups || []).join(', '))}</td>` +
        `<td>${u.enabled !== false ? 'Yes' : 'No'}</td>` +
        `<td>` +
        `<button class="btn btn-sm edit-user" data-name="${escapeHtml(u.name)}" data-groups="${escapeHtml((u.groups || []).join(', '))}">Edit</button> ` +
        `<button class="btn btn-sm btn-danger delete-user" data-name="${escapeHtml(u.name)}">Delete</button>` +
        `</td></tr>`
    ).join('');
}

function renderGroups() {
    const tbody = el('groups-body');
    if (!tbody) return;
    const filter = (el('group-filter')?.value || '').toLowerCase();
    const filtered = filter ? groups.filter(g => g.name.toLowerCase().includes(filter)) : groups;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No groups found</td></tr>';
        return;
    }
    tbody.innerHTML = filtered.map(g =>
        `<tr><td>${escapeHtml(g.name)}</td>` +
        `<td>${(g.members || []).length}</td>` +
        `<td>${escapeHtml((g.managers || []).join(', '))}</td>` +
        `<td><button class="btn btn-sm btn-danger delete-group" data-name="${escapeHtml(g.name)}">Delete</button></td></tr>`
    ).join('');
}

// ── Create/Update User ─────────────────────────

/**
 * Populate the group checkbox list in the user dialog.
 * @param {string[]} checked - group names to pre-check
 */
function renderGroupCheckboxes(checked = []) {
    const container = el('user-groups-list');
    if (!container) return;
    const allGroups = groups.map(g => g.name).sort();
    // Add any checked groups not in the list (edge case)
    checked.forEach(g => { if (!allGroups.includes(g)) allGroups.push(g); });
    container.innerHTML = allGroups.map(g => {
        const isChecked = checked.includes(g) ? ' checked' : '';
        return `<label class="checkbox-item">` +
            `<input type="checkbox" name="user-group" value="${escapeHtml(g)}"${isChecked}/><span>${escapeHtml(g)}</span>` +
            `</label>`;
    }).join('');
}

function getCheckedGroups() {
    return Array.from(document.querySelectorAll('input[name="user-group"]:checked'))
        .map(cb => cb.value);
}

async function saveUser() {
    const mode = el('user-edit-mode')?.value;
    const name = el('user-name')?.value?.trim();
    const password = el('user-password')?.value;
    const groupsList = getCheckedGroups();

    if (!name) { alert('Username required'); return; }
    if (mode === 'create' && !password) { alert('Password required'); return; }

    const action = mode === 'create' ? 'create' : 'update';
    const params = new URLSearchParams({ action, name, groups: groupsList.join(',') });
    if (password) params.set('password', password);
    const resp = await fetch(`${BASE}/users/action?${params}`, {
        method: 'POST', credentials: 'include'
    });
    if (resp.ok) { hideDialog('user-dialog'); loadUsers(); }
    else alert('Operation failed.');
}

// ── Delete User ────────────────────────────────

async function deleteUser(name) {
    if (!confirm(`Delete user "${name}"?`)) return;
    const resp = await fetch(`${BASE}/users/action?action=delete&name=${encodeURIComponent(name)}`, {
        method: 'POST', credentials: 'include'
    });
    if (resp.ok) loadUsers();
}

// ── Create/Delete Group ────────────────────────

async function saveGroup() {
    const name = el('group-name')?.value?.trim();
    if (!name) { alert('Group name required'); return; }
    const resp = await fetch(`${BASE}/users/action?action=create-group&name=${encodeURIComponent(name)}`, {
        method: 'POST', credentials: 'include'
    });
    if (resp.ok) { hideDialog('group-dialog'); loadGroups(); }
}

async function deleteGroup(name) {
    if (!confirm(`Delete group "${name}"?`)) return;
    const resp = await fetch(`${BASE}/users/action?action=delete-group&name=${encodeURIComponent(name)}`, {
        method: 'POST', credentials: 'include'
    });
    if (resp.ok) loadGroups();
}

// ── Init ───────────────────────────────────────

async function init() {
    if (!document.querySelector('.users-page')) return;

    // Escape key dismisses active dialog
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && activeDialog) {
            hideDialog(activeDialog);
        }
    });

    // Click outside dialog dismisses it
    ['user-dialog', 'group-dialog'].forEach(id => {
        el(id)?.addEventListener('click', (e) => {
            if (e.target === el(id)) hideDialog(id);
        });
    });

    // Tab switching
    document.querySelectorAll('.users-page .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.users-page .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.users-page .tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            el('panel-' + btn.dataset.tab)?.classList.add('active');
        });
    });

    // Filters
    el('user-filter')?.addEventListener('input', renderUsers);
    el('group-filter')?.addEventListener('input', renderGroups);

    // User dialog
    el('create-user-btn')?.addEventListener('click', () => {
        el('user-dialog-title').textContent = 'Create User';
        el('user-edit-mode').value = 'create';
        el('user-name').value = '';
        el('user-name').disabled = false;
        el('user-password').value = '';
        renderGroupCheckboxes([]);
        showDialog('user-dialog');
        el('user-name').focus();
    });
    el('user-save')?.addEventListener('click', saveUser);
    el('user-cancel')?.addEventListener('click', () => { hideDialog('user-dialog'); });

    // Add new group inline
    el('user-add-group')?.addEventListener('click', () => {
        const input = el('user-new-group');
        const name = input?.value?.trim();
        if (!name) return;
        const container = el('user-groups-list');
        if (container.querySelector(`input[value="${CSS.escape(name)}"]`)) {
            input.value = '';
            return;
        }
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        label.innerHTML = `<input type="checkbox" name="user-group" value="${escapeHtml(name)}" checked/><span>${escapeHtml(name)}</span>`;
        container.appendChild(label);
        input.value = '';
    });

    // Group dialog
    el('create-group-btn')?.addEventListener('click', () => {
        el('group-name').value = '';
        showDialog('group-dialog');
        el('group-name').focus();
    });
    el('group-save')?.addEventListener('click', saveGroup);
    el('group-cancel')?.addEventListener('click', () => { hideDialog('group-dialog'); });

    // Delegation: edit/delete user, delete group
    el('users-body')?.addEventListener('click', e => {
        const edit = e.target.closest('.edit-user');
        if (edit) {
            el('user-dialog-title').textContent = 'Edit User';
            el('user-edit-mode').value = 'update';
            el('user-name').value = edit.dataset.name;
            el('user-name').disabled = true;
            el('user-password').value = '';
            const userGroups = edit.dataset.groups ? edit.dataset.groups.split(',').map(g => g.trim()) : [];
            renderGroupCheckboxes(userGroups);
            showDialog('user-dialog');
            el('user-password').focus();
            return;
        }
        const del = e.target.closest('.delete-user');
        if (del) deleteUser(del.dataset.name);
    });
    el('groups-body')?.addEventListener('click', e => {
        const del = e.target.closest('.delete-group');
        if (del) deleteGroup(del.dataset.name);
    });

    loadUsers();
    loadGroups();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
