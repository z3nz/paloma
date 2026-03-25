# Scout: Kelsey File Management System
**Date:** 2026-03-25  
**Scope:** Integration research for client file upload/download/search within Paloma  
**For:** Chart (planning) and Forge (implementation)

---

## Executive Summary

No existing file upload infrastructure exists anywhere in the codebase. This is a greenfield build, but the integration points are clean and well-understood. The work splits into three layers:

1. **Bridge HTTP endpoint** — file upload/download/list/delete API routes in `bridge/index.js`
2. **MCP server** — AI-accessible tools in `mcp-servers/files.js` for Paloma/Kelsey to manage files conversationally
3. **Frontend UI** — drag-and-drop upload + files browser tab in the sidebar

Each layer is independent and can be built separately. No existing code needs to be broken.

---

## 1. MCP Server Pattern

**Where to look:** `mcp-servers/` (all custom servers), `~/.paloma/mcp-settings.json` (registration)

### Pattern (from `mcp-servers/web.js`, `mcp-servers/fs-extra.js`)

All custom MCP servers follow exactly the same structure:
```js
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server({ name: 'files', version: '1.0.0' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...] }))
server.setRequestHandler(CallToolRequestSchema, async (request) => { ... })

const transport = new StdioServerTransport()
await server.connect(transport)
```

### Registration

Add to `~/.paloma/mcp-settings.json` under `"servers"`:
```json
"files": {
  "command": "node",
  "args": ["/home/adam/paloma/mcp-servers/files.js"]
}
```

Once registered, tools are automatically available to all Claude CLI sessions as `files__tool_name` — no changes needed to `bridge/mcp-proxy-server.js`.

### Security model

All existing MCP servers scope allowed paths to `resolve(homedir())` (`/home/adam`). The new files server should follow the same pattern — restrict operations to `~/paloma/projects/`.

### Recommendation

Build `mcp-servers/files.js` with these tools:
- `files_upload` — write binary/text content to `projects/{client}/files/{filename}`
- `files_list` — list files for a client with metadata
- `files_delete` — delete a file
- `files_search` — search by filename substring (wraps `files_list` with filter)

**Note:** Reading file content is already covered by `filesystem__read_text_file`. No need to duplicate that.

---

## 2. Bridge HTTP Endpoints

**Key file:** `bridge/index.js`  
**Relevant section:** Lines ~190–280 (email API routes + frontend serving)

### Existing route pattern

```js
if (pathname === '/api/emails' && req.method === 'GET') {
  // ... parse body, respond with JSON
}
```

Routes check `pathname` and `req.method`, parse URL params, respond with JSON. CORS headers are added for all `/api/` routes (lines ~186–191).

### What needs to be added

```
POST   /api/files/upload         — receive file (base64 JSON body, avoid multipart complexity)
GET    /api/files/:client        — list files for a client
GET    /api/files/:client/:name  — download/serve a file  
DELETE /api/files/:client/:name  — delete a file
```

### Gotcha: multipart vs base64

The bridge HTTP server uses raw Node `createServer` — no Express, no `busboy`. Multipart parsing is painful to implement from scratch. **Recommend: accept files as base64-encoded JSON body** for the upload endpoint:

```json
POST /api/files/upload
{ "client": "fadden", "filename": "contract.pdf", "data": "<base64>", "mimeType": "application/pdf" }
```

The frontend `FileReader` API can produce base64 easily. Decodes to `Buffer.from(data, 'base64')` on the server. This works for all file types (PDFs, images, Word docs).

**For serving downloads:** Same pattern as the existing static file server — `createReadStream` piped to `res`. Already proven in the frontend-serving code (lines ~256–280).

### File storage path

```
/home/adam/paloma/projects/{clientSlug}/files/{filename}
```

Create the directory if it doesn't exist (`mkdir({ recursive: true })`). No subdirectories — flat folder per client.

### Metadata

Store a sidecar index at `projects/{clientSlug}/files/.index.json`:
```json
[
  {
    "filename": "contract-v2.pdf",
    "uploadedAt": "2026-03-25T14:30:00Z",
    "uploadedBy": "kelsey",
    "size": 204800,
    "mimeType": "application/pdf"
  }
]
```

Read/update this on every upload/delete. `GET /api/files/:client` returns this index.

---

## 3. Frontend — Drag and Drop

**Key files:**
- `src/components/prompt/PromptBuilder.vue` — the textarea/input area, where drag-and-drop hooks most naturally
- `src/components/prompt/FileChip.vue` — existing chip UI for attached files (lines 1–22) — reusable as-is
- `src/components/layout/Sidebar.vue` — has tabs (`activeView === 'chat'` / `'inbox'`) — add `'files'` tab here
- `src/App.vue` — renders `<InboxView v-else-if="activeView === 'inbox'" />` — same pattern for `<FilesView>`

### Option A: Drop on PromptBuilder (quick MVP)

Add `@dragover.prevent` and `@drop.prevent` to the `<div>` wrapper in `PromptBuilder.vue`. On drop, call the upload API, then inject the filename as context into the prompt or as a FileChip.

The existing `attachedFiles` ref (line ~107 of PromptBuilder.vue) holds `{ path, name }` objects shown as FileChip chips. Upload a file → add an entry with the server path → AI sees it as an attached file context.

**Gotcha:** `attachedFiles` currently holds **project codebase paths** (for `@mention` search via `useFileIndex`). Client files are a different concept. Either extend the chip data structure with a `type: 'client-file'` field, or keep them separate.

### Option B: Files tab in sidebar (proper MVP)

Add a third tab to `Sidebar.vue` alongside Chats/Inbox. Renders a `<FilesView>` component that shows uploaded files grouped by client.

This is cleaner — the Inbox pattern is already established. Look at `src/components/inbox/` for the template.

**Recommendation: Build both.** Files tab for browsing + management. Drop zone on PromptBuilder for quick attach-while-chatting.

### New components needed

```
src/components/files/
  FilesView.vue        — main file browser (like InboxView.vue)
  FileUploadZone.vue   — drag-and-drop drop target
  FilesList.vue        — table/grid of uploaded files
  FileRow.vue          — single file row with download/delete
```

---

## 4. Project Directory Structure

**Key finding:** No `files/` directories exist in any project today. This is net new.

Existing project structure (from `projects/fadden-demo/`):
```
projects/fadden-demo/
  .paloma/
  .git/
  src/
  package.json
  ...
```

Files would add:
```
projects/fadden-demo/
  files/
    .index.json          ← metadata
    contract-v2.pdf
    logo-final.png
    brief-march.docx
```

`useProject.js` provides `projectRoot` (e.g., `/home/adam/paloma/projects/fadden-demo`). The frontend composable is already set up to derive paths from this root. All file API calls can use `projectRoot.value + '/files/'` as the base path.

**Gotcha:** The `projectRoot` is only available after the project is loaded (async). The FilesView component needs to handle the loading state.

---

## 5. Existing File Handling — None Found

Grep for `upload`, `multipart`, `drag`, `drop` across `src/` returned zero results. The existing `attachedFiles` system in PromptBuilder is purely for attaching **existing codebase files** via `@mention` — it reads files from the project tree via `useFileIndex`, it does NOT upload anything.

The existing `FileChip.vue` / `FileSearch.vue` / `useFileIndex.js` composable are for codebase file context (think "@src/components/ChatView.vue" to include the file in prompt). This is separate from client file management.

---

## 6. MCP Proxy Configuration

**Key file:** `bridge/mcp-proxy-server.js`

### How tools flow to Claude CLI

`_buildToolList()` (line ~77) iterates `mcpManager.getTools()` and prefixes each tool as `{serverName}__{toolName}`. A new `files` MCP server automatically appears as `files__files_upload`, `files__files_list`, etc. — **no changes needed to mcp-proxy-server.js**.

The tool confirmation flow (lines ~254–290) asks the browser for approval before executing. File uploads via AI will show the standard ToolConfirmation dialog.

### Existing tool timeouts

`TOOL_TIMEOUTS` (line ~20) has per-tool timeout overrides. Large file uploads may need a longer timeout — add:
```js
'files__files_upload': 2 * 60 * 1000, // 2 min for large files
```

---

## 7. File Naming Convention

**Current plan naming:** `{status}-{YYYYMMDD}-{scope}-{slug}.md`

For uploaded client files: **keep original filenames**. Don't rename them. Kelsey uploads "Q1-proposal-final.pdf" and that's what she wants to find. Use `.index.json` sidecar for metadata/searchability.

If two files with the same name are uploaded: append a timestamp suffix — `contract.pdf` → `contract-20260325-143022.pdf`. Detect collision at upload time.

**Search:** Index entries in `.index.json` have `filename`, `mimeType`, `uploadedAt`, `uploadedBy`, `tags[]`. The `files_search` MCP tool filters this in-memory — no need for a DB.

---

## 8. Risks and Gotchas

| Risk | Severity | Mitigation |
|------|----------|------------|
| Bridge bulletproof rule — any crash kills ALL of Paloma | HIGH | Wrap all new HTTP routes in try/catch, never let file ops throw to top level |
| Large file uploads (50MB+ PDFs) — base64 bloat (+33%) | MEDIUM | Set a max file size limit (e.g., 25MB). For larger files, use streaming multipart later. |
| No auth on bridge — anyone on localhost can upload | LOW | Acceptable for local-only tool; note for future if bridge goes remote |
| `projectRoot` undefined on cold load | LOW | FilesView shows loading state until project is set |
| `.index.json` concurrent writes | LOW | Reads are cheap, writes are rare — file-level lock not needed for MVP |
| Word docs are binary — `filesystem__read_text_file` can't read them | MEDIUM | AI can see metadata (filename, date) but not content. PDF text extraction is a future enhancement. |

---

## Recommended Build Order (MVP)

1. **`mcp-servers/files.js`** — MCP server with `files_upload`, `files_list`, `files_delete`, `files_search`
2. **Register in `~/.paloma/mcp-settings.json`** — one line
3. **`bridge/index.js` routes** — `POST /api/files/upload`, `GET /api/files/:client`, `GET /api/files/:client/:name`, `DELETE /api/files/:client/:name`
4. **`src/components/files/`** — FilesView + FileUploadZone components
5. **Sidebar tab** — add "Files" to `Sidebar.vue` and wire `<FilesView>` in `App.vue`
6. **Drag-and-drop on PromptBuilder** — attach uploaded files as context chips

Steps 1–3 are pure backend and can be done without touching the frontend. Steps 4–6 are pure frontend and can be done once the API exists.

---

## Key Files Reference

| File | Purpose | What to change |
|------|---------|----------------|
| `mcp-servers/files.js` | NEW — AI tools for file management | Create from scratch |
| `~/.paloma/mcp-settings.json` | MCP server registry | Add `"files"` entry |
| `bridge/index.js` | HTTP server + WebSocket bridge | Add file API routes (~lines 190–280) |
| `src/components/files/FilesView.vue` | NEW — file browser UI | Create from scratch |
| `src/components/files/FileUploadZone.vue` | NEW — drag-and-drop target | Create from scratch |
| `src/components/prompt/PromptBuilder.vue` | Chat input area | Add drop handler (optional) |
| `src/components/layout/Sidebar.vue` | Tab nav | Add "Files" tab |
| `src/App.vue` | Root app | Wire FilesView for `activeView === 'files'` |

---

## Open Questions for Chart

1. **Who uploads?** Kelsey via the Paloma browser UI only? Or should Paloma be able to save files from AI sessions too (e.g., Forge generates a PDF → saves it as a client file)?
2. **Per-project vs. global?** Files stored under `projects/{client}/files/` means you must have a project loaded to see files. Is that right, or should there be a global files view across all clients?
3. **File preview?** Images should show inline thumbnails. PDFs — just download link for MVP? Or embed a viewer?
4. **Tags?** The `.index.json` schema has a `tags[]` field. Does Kelsey need to tag files (e.g., "contract", "invoice", "brief")? Or is filename search enough?
5. **Max file size?** 25MB cap seems reasonable for PDFs/Word docs. Images can be large — should we auto-resize?
