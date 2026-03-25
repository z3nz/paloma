# Plan: Kelsey File Management MVP
**Status:** completed  
**Date:** 2026-03-25  
**Scope:** paloma  
**Slug:** kelsey-file-management  

---

## Status Tracker

- [x] WU-1: MCP server (`mcp-servers/files.js`) + registration
- [x] WU-2: Bridge HTTP routes (`bridge/index.js`)
- [x] WU-3: Frontend (new components + App.vue/Sidebar.vue wiring)

---

## Research References

- Scout findings: `.paloma/docs/scout-kelsey-file-management-20260325.md`

---

## Goal

MVP file management system for Kelsey (and Paloma) to upload, browse, and download client files within Paloma. Drag-and-drop upload from the browser. MCP tools for Paloma to manage files from AI sessions. Per-project file storage. Searchable via filename. No versioning, no tags, no preview — just filenames and download links.

---

## Architecture

```
Browser (FilesView)
    │
    │  fetch POST /api/files/upload       ← drag-drop upload
    │  fetch GET  /api/files/:slug        ← list files
    │  <a href="/api/files/:slug/:name">  ← download (native HTML)
    │  fetch DELETE /api/files/:slug/:name
    ▼
Bridge (bridge/index.js)
    │
    │  reads/writes ─────────────────────────────────────────┐
    ▼                                                         ▼
projects/{slug}/files/                         projects/{slug}/files/
  .index.json  ← metadata sidecar                 contract.pdf
  file1.pdf                                        logo-final.png
  ...

MCP server (mcp-servers/files.js)
    │  (direct disk access — no HTTP roundtrip)
    │  writes to same projects/{slug}/files/ paths
    └─ files_list, files_upload, files_delete, files_search
```

All three layers read/write the same path on disk: `/home/adam/paloma/projects/{slug}/files/`. The `.index.json` sidecar is the source of truth for metadata.

---

## File Naming Convention

**The searchable naming pattern:** `{type}-{descriptor}-{date}.{ext}`

Examples:
- `contract-sow-march2026.pdf`
- `brief-q1-campaign.docx`
- `logo-final-v3.png`
- `invoice-march2026.pdf`
- `deck-pitch-q1.pdf`
- `photo-headshot-kelsey.jpg`

**Categories (type prefix):** `contract`, `invoice`, `brief`, `logo`, `photo`, `deck`, `report`, `doc`, `asset`

**Rules:**
- All lowercase, hyphens only (no spaces, no underscores)
- Date as `monthYYYY` or `YYYYMMDD` — human-readable preferred
- Extension preserved as-is

**Collision handling:** If `contract-sow-march2026.pdf` already exists, append timestamp: `contract-sow-march2026-143022.pdf`. Detect collision at upload time (check `.index.json`).

**Smart naming UX (MVP):**  
When a file is dropped, the UI shows an editable filename input pre-filled with the original filename. A hint below shows the naming convention. The user (or Paloma) edits before confirming. No AI call needed — the editable input IS the smart naming for MVP. Paloma as an AI naturally picks good names when calling `files_upload` via MCP.

---

## File Storage Path

```
/home/adam/paloma/projects/{projectSlug}/files/
  .index.json          ← metadata index (array)
  contract-sow.pdf
  logo-final.png
  ...
```

`projectSlug` = last path segment of `projectRoot` (e.g., `fadden-demo` from `/home/adam/paloma/projects/fadden-demo`).

`.index.json` schema:
```json
[
  {
    "filename": "contract-sow-march2026.pdf",
    "uploadedAt": "2026-03-25T14:30:00.000Z",
    "uploadedBy": "kelsey",
    "size": 204800,
    "mimeType": "application/pdf"
  }
]
```

---

## WU-1: MCP Server

**File:** `mcp-servers/files.js` (new)  
**Also:** `~/.paloma/mcp-settings.json` (add `"files"` entry)

### Tool Signatures

**`files_list`**
```js
Input:  { projectSlug: string }
Output: { files: Array<{ filename, uploadedAt, uploadedBy, size, mimeType }> }
```

**`files_upload`**
```js
Input:  { 
  projectSlug: string,
  filename: string,         // suggested name — caller is responsible for good naming
  content: string,          // base64-encoded binary OR UTF-8 text
  encoding: 'base64' | 'utf8',
  mimeType?: string,        // optional, stored in index
  uploadedBy?: string       // 'paloma' | 'kelsey' | etc., stored in index
}
Output: { success: true, filename: string, size: number, path: string }
```
Writes file, creates dir if needed, updates `.index.json`. On filename collision, appends `-{HHmmss}` before extension.

**`files_delete`**
```js
Input:  { projectSlug: string, filename: string }
Output: { success: true, filename: string }
```
Deletes file, removes entry from `.index.json`.

**`files_search`**
```js
Input:  { projectSlug: string, query: string }
Output: { files: Array<{ filename, uploadedAt, uploadedBy, size, mimeType }> }
```
Loads `.index.json`, filters entries where `filename.toLowerCase().includes(query.toLowerCase())`.

### Implementation Notes

- Base path: `join(homedir(), 'paloma/projects', projectSlug, 'files')`
- Path validation: slug must match `/^[a-z0-9_-]+$/i` — reject traversal attempts
- `mkdir({ recursive: true })` before any write
- Try/catch everything — MCP tool errors return `{ error: message }`, never throw
- Read `.index.json` with `JSON.parse`, default to `[]` if missing/corrupt
- Write `.index.json` atomically: write to `.index.json.tmp`, rename over old file

### Registration in `~/.paloma/mcp-settings.json`

Add under `"servers"`:
```json
"files": {
  "command": "node",
  "args": ["/home/adam/paloma/mcp-servers/files.js"]
}
```

---

## WU-2: Bridge HTTP Routes

**File:** `bridge/index.js`

### CORS Header Fix (one line)

Change:
```js
'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
```
To:
```js
'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
```

### New Routes — Add in the `// ─── Email API Routes ───` block

```
POST   /api/files/upload              — upload a file
GET    /api/files/:slug               — list files for a project  
GET    /api/files/:slug/:filename     — download a file
DELETE /api/files/:slug/:filename     — delete a file
```

**Route handlers (exact pattern matching — same as email routes):**

```js
if (pathname === '/api/files/upload' && req.method === 'POST') { ... }

if (pathname.startsWith('/api/files/') && req.method === 'GET') {
  const parts = pathname.split('/').filter(Boolean)  // ['api', 'files', slug, ?filename]
  if (parts.length === 3) { /* list */ }
  if (parts.length === 4) { /* download */ }
}

if (pathname.startsWith('/api/files/') && req.method === 'DELETE') { ... }
```

### Upload Handler Detail

```js
// Read body as JSON: { slug, filename, data (base64), mimeType }
// Validate slug: /^[a-z0-9_-]+$/i
// Decode: Buffer.from(data, 'base64')
// mkdir recursive, write file, update .index.json
// Return: { success: true, filename, size }
```

Body parsing (no Express): collect chunks into buffer, `JSON.parse(Buffer.concat(chunks).toString())`.

### Download Handler Detail

```js
// Construct path: join(homedir(), 'paloma/projects', slug, 'files', filename)
// Validate: resolved path must start with allowed base (prevent traversal)
// Use createReadStream piped to res
// Set Content-Disposition: attachment; filename="..."
// Set Content-Type from MIME_TYPES or 'application/octet-stream'
```

### Delete Handler Detail

```js
// Parse slug + filename from pathname
// Validate slug, validate filename (no path separators)
// unlink file
// Update .index.json (filter out entry)
// Return: { success: true }
```

### Bulletproofing Rules (NON-NEGOTIABLE)

Every route handler MUST:
- Be wrapped in `try/catch`
- Never throw to the outer HTTP server handler
- Validate slug and filename before any disk operation
- Return `{ error: message }` with appropriate status code on any failure
- Log errors with `console.error('[bridge] /api/files/...: ', err.message)`

---

## WU-3: Frontend

**New files:**
```
src/components/files/
  FilesView.vue       — main view (like InboxView.vue)
  FileUploadZone.vue  — drag-and-drop overlay
  FilesList.vue       — table of files with download/delete
```

**Modified files:**
```
src/components/layout/Sidebar.vue  — add Files tab
src/App.vue                        — import FilesView, wire activeView === 'files'
```

### Sidebar.vue — Add Files Tab

Add a third `<button>` after the Inbox button. Emit `switch-view` with `'files'`. Use a folder/paperclip icon. No badge needed (no unread count for files).

The sidebar's fallback `v-else` block (currently shows "Switching to Inbox view...") needs to only show for `activeView === 'inbox'`, since `FilesView` is rendered in the main content area (not the sidebar).

### App.vue Changes

```js
import FilesView from './components/files/FilesView.vue'
```

In template, after `<InboxView v-else-if="activeView === 'inbox'" />`:
```html
<FilesView v-else-if="activeView === 'files'" />
```

Also update the toggle shortcut if needed (currently toggles chat↔inbox — leave it as-is for MVP).

### FilesView.vue

**Responsibilities:**
- Show current project's files (or "no project loaded" state)
- Trigger file upload via drag-drop (global window listener) or click-to-browse button
- List files with filename + upload date + size + download link + delete button

**Structure:**
```
<div class="files-view">
  <FileUploadZone @upload="handleUpload" />   ← always mounted, listens to window
  <div class="files-header">
    <h2>Files — {projectName}</h2>
    <button @click="triggerFilePicker">Upload File</button>
  </div>
  <FilesList :files="files" @delete="handleDelete" />
</div>
```

**State:**
```js
const files = ref([])           // from GET /api/files/:slug
const uploading = ref(false)
const error = ref(null)
```

**API calls (plain fetch — no composable for MVP):**
```js
const projectSlug = computed(() => projectRoot.value?.split('/').pop())

async function loadFiles() { /* GET /api/files/${projectSlug.value} */ }
async function handleUpload(file, suggestedName) { /* POST /api/files/upload */ }
async function handleDelete(filename) { /* DELETE /api/files/${slug}/${filename} */ }
```

**Upload flow:**
1. User drops file (or clicks upload button → `<input type="file">` click)
2. Show a simple inline rename input pre-filled with the filename
3. Hint text: "Use format: type-description-date.ext (e.g., contract-sow-march2026.pdf)"
4. Confirm button → `FileReader.readAsDataURL()` → strip `data:...;base64,` prefix → POST
5. On success: reload file list

### FileUploadZone.vue

**Global drag-and-drop:**
```js
onMounted(() => {
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  window.addEventListener('dragleave', onDragLeave)
})
onUnmounted(() => { /* remove listeners */ })
```

Shows a full-page overlay (fixed, z-50, semi-transparent) while dragging. On drop, emits `@upload(file)` to parent.

**No drop on PromptBuilder** — global window listener covers "anywhere on the page" without touching PromptBuilder.vue.

### FilesList.vue

Simple table or list. For each file:
```html
<tr>
  <td>{{ file.filename }}</td>
  <td>{{ formatDate(file.uploadedAt) }}</td>
  <td>{{ formatSize(file.size) }}</td>
  <td><a :href="`/api/files/${slug}/${file.filename}`" download>Download</a></td>
  <td><button @click="$emit('delete', file.filename)">Delete</button></td>
</tr>
```

Download uses native `<a download>` — no JS, no fetch. Browser handles it.

No FileRow.vue — inline is simpler. Keep component count minimal.

### Styling

Use CSS variables only: `var(--color-bg-primary)`, `var(--color-border)`, `var(--color-accent)`, `var(--color-text-primary)`, `var(--color-text-muted)`. No hardcoded Tailwind color classes.

---

## Edge Cases

| Case | Handling |
|------|----------|
| No project loaded | FilesView shows "Open a project to see its files" |
| `files/` dir doesn't exist | `GET /api/files/:slug` returns `{ files: [] }` (no error) |
| Filename collision | Append `-{HHmmss}` before extension |
| Slug path traversal attempt | Reject with 400 if slug contains `/`, `..`, or fails `/^[a-z0-9_-]+$/i` |
| Filename path traversal | Reject if filename contains `/` or `..` |
| Corrupt `.index.json` | Default to `[]`, log warning, continue |
| Empty upload body | 400 error from bridge |
| File not found on delete | 404, log, don't crash |

---

## Work Units

### WU-1: MCP Server
**Status:** ready  
**Backend:** gemini  
**Files:**
- `mcp-servers/files.js` (create)
- `~/.paloma/mcp-settings.json` (add entry)

**What to build:** New MCP server with `files_list`, `files_upload`, `files_delete`, `files_search`. Follow exact pattern from `mcp-servers/fs-extra.js`. Register in mcp-settings.json. All operations scoped to `~/paloma/projects/{slug}/files/`. Validate slug before any disk op. Try/catch everything.

---

### WU-2: Bridge Routes
**Status:** complete  
**Backend:** gemini  
**Files:**
- `bridge/index.js` (modify — add routes, fix CORS headers)

**What to build:** 4 HTTP routes following the exact pattern of existing email routes. Fix CORS headers to include DELETE. Bulletproof try/catch on every handler. Path traversal validation on slug and filename. Stream files on download with `createReadStream`.

**Implementation Notes:**
- Added `rename` to fs/promises import for atomic `.index.json` writes
- Fixed CORS: `Access-Control-Allow-Methods` now includes `DELETE`
- Hoisted helper functions (`validateSlug`, `validateFilename`, `readIndex`, `writeIndexAtomic`) and `FILE_MIME_TYPES` outside request handler for performance
- 4 routes implemented: `POST /api/files/upload`, `GET /api/files/:slug` (list), `GET /api/files/:slug/:filename` (download), `DELETE /api/files/:slug/:filename`
- Every handler wrapped in try/catch with `console.error` logging and JSON error responses
- Slug validated with `/^[a-z0-9_-]+$/i`, filenames reject `/`, `\`, `..`
- Path traversal double-checked with `filePath.startsWith(dirPath)`
- Collision handling: appends `-HHmmss` before extension
- Download uses `createReadStream` piped to `res` with `Content-Disposition: attachment`
- Delete returns 404 for ENOENT, re-throws other errors
- Atomic index writes via `.tmp` + `rename`
- No deviations from plan. Syntax check passes (`node --check`).

---

### WU-3: Frontend
**Status:** ready  
**Backend:** gemini  
**Files:**
- `src/components/files/FilesView.vue` (create)
- `src/components/files/FileUploadZone.vue` (create)
- `src/components/files/FilesList.vue` (create)
- `src/components/layout/Sidebar.vue` (modify — add Files tab)
- `src/App.vue` (modify — import + wire FilesView)

**What to build:** FilesView shows project files with upload/download/delete. FileUploadZone listens globally on `window` for drag events, shows full-page overlay, emits `@upload(file)`. FilesList renders a table with download links and delete buttons. Sidebar gets a third tab. App.vue wires it all together. CSS variables only — no hardcoded colors.

---

## Parallelism

WU-1, WU-2, and WU-3 are fully file-disjoint — they can all run in parallel:
- WU-1 touches only `mcp-servers/` and `~/.paloma/`
- WU-2 touches only `bridge/index.js`
- WU-3 touches only `src/` and `src/components/layout/Sidebar.vue`

Dispatch all three to Forge simultaneously.

---

## Implementation Notes — WU-3 (Frontend)

**Files created:**
- `src/components/files/FilesView.vue` — Main view with header, upload form, file list. Gets project slug from `useProject()`. Upload flow: drop/click → stage file → editable filename input with naming hint → base64 encode → POST to bridge. Plain `fetch()` to bridge HTTP API.
- `src/components/files/FileUploadZone.vue` — Global drag-and-drop via `window` event listeners (`dragenter`/`dragover`/`dragleave`/`drop`). Uses `dragCounter` pattern to handle nested element drag events correctly. Full-page overlay via `<Teleport to="body">` with fade transition. Emits `@upload(file)` to parent.
- `src/components/files/FilesList.vue` — Table of files with sticky header. Each row shows filename, formatted date, formatted size, download link (`<a download>`), and delete button. Empty state shows "No files yet" message.

**Files modified:**
- `src/components/layout/Sidebar.vue` — Added third "Files" tab button with folder icon after Inbox. Changed the fallback `v-else` to `v-else-if="activeView === 'inbox'"` so the sidebar placeholder only shows for inbox view, not files.
- `src/App.vue` — Imported `FilesView`, added `<FilesView v-else-if="activeView === 'files'" />` after InboxView.

**Styling:** All CSS variables — `var(--color-bg-primary)`, `var(--color-border)`, `var(--color-accent)`, `var(--color-text-primary)`, `var(--color-text-muted)`, etc. No hardcoded Tailwind color classes. Matches existing Paloma dark theme aesthetic.

**Deviations from plan:** None. Built exactly as specified.
