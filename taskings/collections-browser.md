# Tasking: Collections Manager for Dashboard

**Closes**: https://github.com/eXist-db/dashboard/issues/257

## Objective

Add a "Collections" section to the Dashboard as a full-featured database collection manager. Users can browse, upload, download, rename, move, copy, delete resources and collections, and manage permissions — everything eXide's DB Manager does, but with more screen space and a better UX. The only thing it does **not** do is inline editing — all editing is delegated to eXide via "Open in eXide" links.

## Scope

### In scope
- Browse collection tree with lazy-loading
- Resource list with full metadata (permissions, owner, group, MIME, size, last modified)
- Create collections
- Upload files (drag-and-drop + file picker)
- Download resources
- Rename resources and collections
- Cut/copy/paste to move/duplicate resources and collections
- Delete resources and collections
- Manage permissions: owner, group, mode (rwx), setUID, setGID, sticky bit
- "Open in eXide" on any editable resource
- Breadcrumb navigation
- Sort and filter resource listings
- Responsive layout that takes full advantage of Dashboard's screen space

### Out of scope
- Inline document editing (delegate to eXide)
- File previews (delegate to eXide; may add lightweight preview later)
- XQuery execution

## Design Decisions

### 1. Placement: Public launcher with auth-aware UI

The Collections manager lives in the **public launcher** (index.html), accessible as a tab alongside the app grid. No DBA login required to browse — the UI respects the logged-in user's permissions:

- **Guest/unauthenticated**: can browse collections they have read access to (typically `/db/apps/*/`)
- **Logged-in users**: see collections per their permissions; can upload/modify where permitted
- **DBA**: full access including permission management, system collections

The UI adapts based on the user's access level — write operations (upload, rename, delete, permissions) are shown only when the user has the relevant permissions on the selected collection/resource.

### 2. Backend: exist-api storage endpoints

No new XQuery backend. The `exist-api` app provides all needed endpoints:

| Operation | Method | Endpoint |
|-----------|--------|----------|
| List collection | GET | `/api/db?path={path}` |
| List collections only | GET | `/api/db?path={path}&collections-only=true` |
| Get resource content | GET | `/api/db/resource?path={path}` |
| Store resource | POST | `/api/db/resource` (body: content, params: path, mime) |
| Delete resource | DELETE | `/api/db/resource?path={path}` |
| Create collection | POST | `/api/db/collection` (body: path) |
| Delete collection | DELETE | `/api/db/collection?path={path}` |

For operations not yet in exist-api (rename, copy, move, permissions), extend exist-api with new endpoints following the existing patterns.

### 3. eXide integration: always available

Assume eXide is installed. Every editable resource gets an "Open in eXide" link:
```
{contextPath}/apps/eXide/?open={encodedDbPath}
```

Binary resources (images, PDFs, archives) get a "Download" button instead.

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Dashboard > Collections                            [user ▾] │
├──────────────┬──────────────────────────────────────────────┤
│              │  /db / apps / docs / data        [↑] [+ ▾]  │
│  /db         │──────────────────────────────────────────────│
│  ├── apps    │  □  Name          Type      Size   Modified  │
│  │  ├── docs │  □  📁 articles   collection  —    Apr 16    │
│  │  ├── blog │  □  📁 functions  collection  —    Apr 16    │
│  │  └── ...  │  □  📄 config.json  app/json  1.2K Apr 15    │
│  ├── system  │  □  📄 controller.xq  app/xq  4.8K Apr 16   │
│  └── ...     │  □  📄 repo.xml   app/xml   892B  Apr 12    │
│              │──────────────────────────────────────────────│
│              │  5 items | 2 selected  [✂ Cut] [📋 Copy]     │
│              │  [📥 Upload] [🗑 Delete] [🔒 Permissions]    │
├──────────────┴──────────────────────────────────────────────┤
│  ℹ controller.xq | application/xquery | 4.8K | rwxr-xr-x  │
│  owner: admin | group: dba | [Open in eXide] [Download]    │
└─────────────────────────────────────────────────────────────┘
```

### Layout regions

1. **Collection tree** (left sidebar, ~250px, collapsible)
   - Rooted at `/db`
   - Lazy-loads children on expand
   - Click to navigate
   - Highlights current collection
   - Collapse on mobile → dropdown or breadcrumb-only mode

2. **Breadcrumb bar** (top of main area)
   - Clickable path segments: `/db` / `apps` / `docs` / `data`
   - Action buttons on the right: "Up" (parent), "New Collection", "Upload"

3. **Resource table** (main area)
   - Columns: checkbox, icon, name, MIME type, size, last modified
   - Collections listed first, then resources
   - Click collection → navigate into it
   - Click resource → show info bar at bottom
   - Double-click resource → open in eXide
   - Sortable columns
   - Multi-select with checkboxes (Ctrl+Click, Shift+Click)
   - Right-click context menu: Open in eXide, Download, Rename, Cut, Copy, Delete, Properties

4. **Action bar** (below table)
   - Selection count
   - Contextual buttons: Cut, Copy, Paste, Delete, Upload, Permissions
   - Buttons enabled/disabled based on selection and user permissions

5. **Info bar** (bottom, shown when a single resource is selected)
   - Resource name, MIME type, size, permissions string
   - Owner, group
   - "Open in eXide" button, "Download" button

## Implementation Plan

### Phase 1: exist-api Audit and Extensions

exist-api already provides most needed operations. Audit results:

**Already available — no changes needed:**
```
GET    /api/db?path={path}               → db:list (name, path, type, mode, owner, group, size, modified, acl)
GET    /api/db?path={path}&collections-only=true  → tree data
GET    /api/db/resource?path={path}      → db:get-resource (text/binary content)
POST   /api/db/resource (multipart)      → db:store-resource
DELETE /api/db/resource?path={path}      → db:remove-resource
POST   /api/db/collection               → db:create-collection
DELETE /api/db/collection?path={path}    → db:remove-collection
POST   /api/db/copy                      → db:copy (resources + collections, auto-detects)
POST   /api/db/move                      → db:move (resources + collections, auto-detects)
GET    /api/db/properties?path={path}    → db:properties (full metadata)
POST   /api/db/permissions               → db:set-permissions (owner, group, mode)
GET    /api/users                         → users:list (for permissions dialog)
GET    /api/users/groups                  → users:list-groups
GET    /api/users/whoami                  → users:whoami (check current user)
```

**New endpoint needed:**
```
POST   /api/db/rename
       Body: { "path": "/db/a/old.xml", "name": "new.xml" }
       → Rename a resource or collection (uses xmldb:rename)
```

**List endpoint enhancement needed:**
- Add `mime` field to resource entries (currently missing — needed for icon mapping and "Open in eXide" logic)
- Add `writable` boolean flag so the UI knows whether to show write operations for the current user

**eXide's approach (for reference):**
eXide's `api/storage/{path}` uses `POST { action: "rename", target: newName }` for rename. We can follow a similar pattern or use a dedicated endpoint. The dedicated `/api/db/rename` endpoint is cleaner and consistent with the existing `/api/db/copy` and `/api/db/move` pattern.

### Phase 2: Collection Tree Component

**File**: `src/components/existdb-collections-tree.js`

- Lit web component
- Starts at `/db`, shows immediate child collections
- Click triangle → lazy-load and expand subcollections
- Click name → navigate (emit custom event, parent updates resource list)
- Visual: indented list with `▶`/`▼` expand indicators
- Badge with subcollection count
- Current selection highlighted
- Scroll into view on deep navigation

### Phase 3: Resource List Component

**File**: `src/components/existdb-resource-list.js`

- Sortable table with columns: checkbox, icon, name, type, size, modified
- Collections first, then resources (each group sorted by name)
- Pagination: lazy-load in 50-row batches (Intersection Observer)
- Multi-select: checkboxes, Ctrl+Click, Shift+Click range select
- Double-click → open in eXide (or navigate if collection)
- Context menu (right-click):
  - Open in eXide
  - Download
  - Rename...
  - Cut / Copy / Paste
  - Delete
  - Properties...
- Filter input for name search (client-side regex)
- Empty state: "This collection is empty" with "Upload" and "New Collection" buttons

### Phase 4: Action Bar and Operations

**File**: `src/components/existdb-collections-actions.js`

Contextual action bar below the resource table.

**Operations:**

| Action | Trigger | API Call |
|--------|---------|----------|
| New Collection | Button + dialog (name input) | POST /api/db/collection |
| Upload | Button → file picker; drag-drop anywhere on resource list | POST /api/db/resource (multipart) |
| Download | Single resource: direct download; collection: ZIP; multi-select: one download per item | Resources: `GET /api/db/resource?path=...&download=true`; Collections: `GET /api/db/collection?path=...` → ZIP |
| Rename | Context menu → inline edit or dialog; F2 shortcut | POST /api/db/rename |
| Delete | Button or context menu → confirm dialog | DELETE /api/db/resource (or collection) |
| Cut | Button or Ctrl+X → stores in clipboard | (client-side clipboard) |
| Copy | Button or Ctrl+C → stores in clipboard | (client-side clipboard) |
| Paste | Button or Ctrl+V → executes move/copy | POST /api/db/resource/move (or copy) |
| Properties | Context menu → dialog | GET metadata + PATCH to update |

**Clipboard**: In-memory array of `{ paths: [...], mode: "copy"|"move" }`. Paste executes the API calls and refreshes the listing.

**Confirmation dialogs**: Delete and overwrite operations show a confirmation dialog with the resource/collection name(s).

**Drag-and-drop upload**:
- Drop zone: the entire resource list area
- Visual feedback: blue border + "Drop files to upload to {collection}" overlay
- Multiple files supported
- Each file → `POST /api/db/resource` with the current collection path as target
- Progress indicator for multi-file uploads
- Overwrite confirmation if file already exists
- Auto-refresh resource list on completion

**Serialization preferences** (for XML download):
Following eXide's pattern, provide a preferences panel (gear icon or settings menu) with:
- **Indent on download**: boolean (default: true)
- **Expand XIncludes on download**: boolean (default: false)
- **Omit XML declaration on download**: boolean (default: false)

Preferences stored in `localStorage` and passed as query parameters to the `GET /api/db/resource` endpoint:
```
GET /api/db/resource?path={path}&download=true&indent={bool}&expand-xincludes={bool}&omit-xml-decl={bool}
```

Binary resources are downloaded as-is regardless of serialization preferences.

### Phase 5: Permissions Dialog

**File**: `src/components/existdb-permissions-dialog.js`

Modal dialog for viewing/editing resource or collection permissions.

**Fields:**
- Owner (dropdown, populated from exist-api user list)
- Group (dropdown, populated from exist-api group list)
- Permission matrix: 3×4 grid
  - Rows: User, Group, Other
  - Columns: Read, Write, Execute, Special (setUID/setGID/sticky)
  - Checkboxes
- MIME type (text input, for resources only)

**Display**: Also shows current values as a compact string: `rwxr-sr-x admin:dba`

**API calls**:
- GET user/group lists (from exist-api or security manager)
- PATCH permissions on save

### Phase 6: Launcher Integration

Add "Collections" as a tab in the public launcher page.

**Option**: Modify `existdb-launcher-app.js` to add a tab bar:
```
[Apps] [Collections]
```

Or create a new wrapper `existdb-home.js` that renders:
```javascript
html`
  <div class="tabs">
    <button class="${tab === 'apps' ? 'active' : ''}" @click=${...}>Apps</button>
    <button class="${tab === 'collections' ? 'active' : ''}" @click=${...}>Collections</button>
  </div>
  ${tab === 'apps'
    ? html`<existdb-launcher ...></existdb-launcher>`
    : html`<existdb-collections-app></existdb-collections-app>`
  }
`
```

The Collections tab should also be accessible via direct URL: `index.html#collections`

### Phase 7: Keyboard Shortcuts and Polish

- Arrow keys: navigate resource list
- Enter: open in eXide (or navigate into collection)
- Delete/Backspace: delete selected (with confirmation)
- Ctrl+C/X/V: copy/cut/paste
- Ctrl+A: select all
- F2: rename
- Escape: clear selection, close dialogs
- Drag and drop: reorder/move resources between collections (stretch goal)

## File Structure

```
src/components/
├── existdb-home.js                    — Tab wrapper: Apps | Collections
├── existdb-collections-app.js         — Main layout: tree + list + actions
├── existdb-collections-tree.js        — Collapsible collection tree sidebar
├── existdb-resource-list.js           — Sortable resource table with multi-select
├── existdb-collections-actions.js     — Contextual action bar
├── existdb-permissions-dialog.js      — Permission editing modal
└── existdb-collections-api.js         — API client (fetch wrappers for exist-api)
```

## exist-api Extensions

Most operations already exist. Minimal changes needed:

**New endpoint** (in `modules/db.xqm` + `modules/api.json`):
```
POST /api/db/rename
     Body: { "path": "/db/apps/foo/old.xml", "name": "new.xml" }
     Implementation: xmldb:rename($collection, $old-name, $new-name)
     Works for both resources and collections
```

**Enhancements to db:list**:
- Add `mime` field to each resource entry (use `xmldb:get-mime-type()`)
- Add `writable` boolean (use `sm:has-access(xs:anyURI($path), "w")`)

**Enhancements to db:get-resource**:
- Support `indent`, `expand-xincludes`, `omit-xml-decl` query parameters for serialization control on download (some may already work via `exist:serialize`)

**Fix needed:**
- `GET /api/db/collection?path=...` (download collection as ZIP) — implementation exists
  in `db:download-collection` using `compression:zip()`, but roaster returns 405. Likely a
  route registration issue in api.json or a roaster version incompatibility. The function
  and XQuery code are correct.

**Already available — reuse as-is:**
- `db:copy`, `db:move` — handle both resources and collections
- `db:properties` — full metadata including ACLs
- `db:set-permissions` — owner, group, mode
- `db:store-resource` — upload (supports multipart)
- `db:create-collection`, `db:remove-collection`, `db:remove-resource`
- `users:list`, `users:list-groups` — for permissions dialog dropdowns
- `users:whoami` — determine current user's access level

**Code sharing with eXide**:
eXide's `api/storage/*` endpoints (in `src/services/`) implement similar operations. Where possible, align the JSON response shapes so the same client code could potentially work against either API. The exist-api endpoints are the canonical source; eXide may eventually be updated to use them.

## Testing

Cypress E2E tests in `cypress/e2e/collections.cy.js`:

- Tree loads `/db` and shows child collections
- Navigate into a collection → resource list updates
- Breadcrumb shows correct path, segments are clickable
- Resource metadata columns display correctly
- "Open in eXide" opens correct URL in new tab
- Download link works for binary resources
- Create collection → appears in tree and list
- Upload file via button → appears in resource list
- Upload file via drag-and-drop → appears in resource list
- Multi-file drag-and-drop upload with progress
- Rename resource → name updates in list
- Delete resource → removed from list (with confirmation)
- Copy/paste resource between collections
- Cut/paste (move) resource between collections
- Permissions dialog shows correct values
- Permission changes persist after refresh
- Guest user sees only readable collections
- Guest user cannot see write operation buttons
- Large collections paginate correctly
- Sort by column works
- Filter by name works
- Download XML with indent=true produces indented output
- Download XML with omit-xml-decl=true omits declaration
- Serialization preferences persist in localStorage
- Keyboard shortcuts (Ctrl+C/X/V, F2, Delete, Enter, Escape)
- Drag-and-drop between tree nodes moves resources (stretch goal)

## Migration Notes

- eXide's DB Manager (`src/directory.js`, `src/resources.js`) uses a custom `api/storage/*` endpoint pattern. The Collections Manager uses exist-api's `/api/db/*` pattern instead. Where possible, align JSON response shapes for future convergence — eXide may eventually switch to exist-api endpoints.
- The dashboard currently uses Vite for bundling. New components follow the existing Lit patterns.
- No changes to `admin.xql` — the collections manager is on the public side.
- eXide is assumed to be installed. The "Open in eXide" URL pattern is: `{contextPath}/apps/eXide/?open={encodedDbPath}`
