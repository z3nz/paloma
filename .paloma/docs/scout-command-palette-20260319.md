# Scout: Command Palette Enhancement — Research Findings
**Date:** 2026-03-19  
**WU:** WU-1 (Command Palette plan)  
**For:** Chart (design) and Forge (implementation)

---

## 1. Current CommandPalette.vue — State of Play

**File:** `src/components/CommandPalette.vue`

### What it does today
- Opens via Ctrl+K (wired in `useKeyboardShortcuts.js`)
- Shows two hardcoded **Actions**: "New Chat" (Ctrl+N) and "Settings" (⚙)
- Shows recent **Sessions** (sorted by updatedAt, capped at 15)
- Unified search: filters both actions and sessions by label/title/phase
- Arrow key nav + Enter to select
- `@click.self` on backdrop to close

### Events emitted
```
'close'          — user pressed Escape or clicked backdrop
'select-session' — payload: session.id (string)
'new-chat'       — no payload
'open-settings'  — NOTE: action emits 'settings' (not 'open-settings') — minor bug/mismatch
```

### App.vue integration
```vue
<CommandPalette
  v-if="showCommandPalette"
  @close="showCommandPalette = false"
  @select-session="(id) => { showCommandPalette = false; handleSelectSession(id) }"
  @new-chat="() => { showCommandPalette = false; handleNewChat() }"
  @settings="() => { showCommandPalette = false; showSettings = true }"
/>
```
`showCommandPalette` is a `ref(false)` toggled by `onCommandPalette` callback in `registerKeyboardShortcuts`.

### Component imports
- Only uses `useSessions()` for the sessions list
- Does NOT currently import `useProject`, `useMCP`, or `callMcpTool`

### Item indexing for keyboard nav
Items are indexed as a flat list: actions first (indices 0..n-1), then sessions (indices n..n+m-1). The `selectedIndex` ref tracks position across both groups. This is the pattern to extend for additional categories.

---

## 2. App.vue — Available Context for the Palette

App.vue already has all the data the enhanced palette needs:

```js
const { callMcpTool } = useMCP()
const { activePlans, projectRoot, refreshActivePlans } = useProject()
```

**`activePlans`** — `ref([{ name: string, content: string }])` — already loaded at session start, lists only `active-*.md` files.

**`projectRoot`** — `ref(string|null)` — full filesystem path (e.g. `/home/adam/Projects/paloma`). Used to construct plan paths.

**`callMcpTool`** — async function, available in App.vue scope. Must be passed as a prop or injected into the palette.

**Current props passed to CommandPalette:** none. App.vue only listens for events.

**What needs to change in App.vue:**
- Pass `callMcpTool`, `activePlans`, `projectRoot`, and `refreshActivePlans` as props to `CommandPalette`
- Add handler for new events: `@spawn-pillar`, `@power-command`, etc.
- OR: CommandPalette can call `useMCP()` and `useProject()` directly (both are module-level singletons — safe to call from any component)

**Recommendation:** CommandPalette should call `useMCP()` and `useProject()` directly rather than receiving props. Both composables use module-level singleton refs (not created fresh per call). This keeps App.vue integration minimal and avoids prop drilling.

---

## 3. useProject.js — Plan Data Interface

### `activePlans` ref shape
```ts
activePlans: Ref<Array<{ name: string, content: string }>>
// name = filename only, e.g. "active-20260319-paloma-command-palette.md"
// content = full markdown text of the plan file
```
Only `active-*.md` files are loaded. Loaded at `switchProject()` / `refreshActivePlans()` time.

### `projectRoot` ref shape
```ts
projectRoot: Ref<string | null>
// e.g. "/home/adam/Projects/paloma"
```

### `refreshActivePlans(callMcpTool)` signature
```ts
async function refreshActivePlans(callMcpTool: Function): Promise<void>
// Rescans ${projectRoot}/.paloma/plans/ and updates activePlans ref in-place
// Must pass callMcpTool — it's not captured in closure
```

### `mcpListDir` (internal helper, not exported)
```ts
async function mcpListDir(callMcpTool, path): Promise<Array<{ name: string, kind: 'file'|'directory' }>>
// Parses "[FILE] name" / "[DIR] name" format from mcp__filesystem__list_directory
```
Not exported. To list ALL plans (not just active), CommandPalette must call `callMcpTool('mcp__filesystem__list_directory', { path })` directly and parse the result itself — OR we expose a `listAllPlans()` helper from useProject.

### Full plans directory path
```
${projectRoot}/.paloma/plans/
// e.g. /home/adam/Projects/paloma/.paloma/plans/
```

---

## 4. useMCP.js — callMcpTool Interface

### Function signature
```ts
async function callMcpTool(namespacedName: string, args: object): Promise<string>
// Returns: string (MCP tool result content, may be JSON-encoded)
// Throws: never (catches internally, returns error JSON string)
```

### Name format
`mcp__<server>__<tool>` — e.g. `mcp__filesystem__move_file`

### Example calls needed for plan management

**List all plans in directory:**
```js
const result = await callMcpTool('mcp__filesystem__list_directory', {
  path: `${projectRoot}/.paloma/plans`
})
// Returns: "[FILE] active-20260319-foo.md\n[FILE] completed-20260312-bar.md\n..."
// Parse with: result.split('\n').map(line => line.match(/^\[FILE\]\s+(.+)/)?.[1]).filter(Boolean)
```

**Rename a plan (change status):**
```js
await callMcpTool('mcp__filesystem__move_file', {
  source: `${projectRoot}/.paloma/plans/active-20260319-paloma-command-palette.md`,
  destination: `${projectRoot}/.paloma/plans/paused-20260319-paloma-command-palette.md`
})
// NOTE: move_file FAILS if destination already exists — check before renaming
```

**Read a plan file:**
```js
const content = await callMcpTool('mcp__filesystem__read_text_file', {
  path: `${projectRoot}/.paloma/plans/active-20260319-paloma-command-palette.md`
})
```

### Pillar spawning from browser
The palette plan mentions "spawn any pillar directly from the palette." This is possible via `callMcpTool('mcp__paloma__pillar_spawn', { pillar, prompt, backend })`. However, `mcp__paloma__*` tools are bridge-side tools — they're available in CLI sessions but NOT through the browser-side `callMcpTool`. 

**Conclusion:** Pillar spawning from the command palette must be sent as a message to the active Flow session (which then spawns the pillar), NOT directly via callMcpTool from the browser. This is an important architectural constraint.

---

## 5. useKeyboardShortcuts.js — Ctrl+K Wiring

```js
// In registerKeyboardShortcuts (called from App.vue):
if (e.key === 'k') {
  e.preventDefault()
  onCommandPalette?.()
  return
}

// In App.vue:
registerKeyboardShortcuts({
  onCommandPalette: () => { showCommandPalette.value = !showCommandPalette.value }
})
```

No changes needed here. Ctrl+K is already wired and functional.

---

## 6. Plan Files — Complete Survey

### Status prefix pattern
```
{status}-{YYYYMMDD}-{scope}-{slug}.md
```

### Status semantics
| Status | Meaning | Load into context? |
|--------|---------|-------------------|
| `active-` | Charted, pipeline-ready | YES — loaded into every session |
| `paused-` | In progress, on hold | No |
| `draft-` | Idea/early thinking, NOT build-ready | No |
| `completed-` | Done and shipped | No |
| `archived-` | No longer relevant, kept for history | No |

### Current plan counts (as of 2026-03-19)
- **active:** 5 files
- **paused:** 1 file
- **draft:** 9 files
- **completed:** 27 files
- **archived:** 4 files

### Active plans (what the palette would display by default)
```
active-20260312-paloma-ollama-feedback-loop.md
active-20260312-paloma-qwen-recursive-singularity.md
active-20260313-paloma-backlog.md
active-20260316-social-poster-crossplatform.md
active-20260319-paloma-command-palette.md   ← this one
```

### Plan status change — file rename operations

To change `active-20260319-paloma-command-palette.md` to `paused`:
1. Extract the date+scope+slug: `20260319-paloma-command-palette`
2. New filename: `paused-20260319-paloma-command-palette.md`
3. Call `mcp__filesystem__move_file` with old/new full paths
4. Call `refreshActivePlans(callMcpTool)` to update the `activePlans` ref

**Helper function Forge should write:**
```js
function parsePlanFilename(filename) {
  // "active-20260319-paloma-command-palette.md"
  // → { status: 'active', date: '20260319', scope: 'paloma', slug: 'command-palette', ext: '.md' }
  const match = filename.match(/^(active|paused|draft|completed|archived)-(\d{8})-(.+)\.md$/)
  if (!match) return null
  const [, status, date, rest] = match
  const dashIdx = rest.indexOf('-')
  return {
    status,
    date,
    scope: rest.slice(0, dashIdx),
    slug: rest.slice(dashIdx + 1),
    body: `${date}-${rest}` // the part that stays constant across renames
  }
}
```

---

## 7. MCP Filesystem Tool Interfaces

### `mcp__filesystem__move_file`
```ts
// Input:
{ source: string, destination: string }
// Both must be within allowed directories (/home/adam).
// FAILS if destination exists.
// Returns: string confirmation message on success, throws on failure.
```

### `mcp__filesystem__list_directory`
```ts
// Input:
{ path: string }
// Returns: string with lines like:
// "[FILE] filename.md"
// "[DIR] dirname"
```

### `mcp__filesystem__read_text_file`
```ts
// Input:
{ path: string, head?: number, tail?: number }
// Returns: string (file contents)
```

---

## 8. Prefix Filtering — Design Notes

The plan calls for prefix-based filtering:
- `>` — commands only (actions)
- `plan:` — plans only
- `pillar:` — pillar commands only

This is a frontend-only feature. The `query` ref value just needs to be checked for these prefixes before applying filter logic. Example:

```js
const effectiveQuery = computed(() => {
  if (query.value.startsWith('>')) return query.value.slice(1).trim()
  if (query.value.startsWith('plan:')) return query.value.slice(5).trim()
  if (query.value.startsWith('pillar:')) return query.value.slice(7).trim()
  return query.value
})

const activeCategory = computed(() => {
  if (query.value.startsWith('>')) return 'actions'
  if (query.value.startsWith('plan:')) return 'plans'
  if (query.value.startsWith('pillar:')) return 'pillars'
  return 'all'
})
```

---

## 9. SELF-IMPROVE Power Command

The plan calls for a SELF-IMPROVE command. Since pillar spawning isn't directly available from the browser, this should work by:
1. Finding the active Flow session
2. Sending it a message: `"SELF-IMPROVE: Begin an autonomous improvement spree. Scout the codebase, identify improvements, and run the full pipeline."`
3. Using `sendPillarUserMessage` from `useMCP()` — this sends a message to an existing pillar by ID

The relevant `useMCP` export:
```js
function sendPillarUserMessage(pillarId: string, message: string): void
```

But to send to Flow, we need Flow's `pillarId`. This is tracked in `pillarDbSessions` (reactive Map). Forge would need to find the Flow session and its pillarId, or send it via a new bridge message type. **This is a known complexity** — Chart should decide the implementation approach.

---

## 10. Open Questions for Chart

1. **Plan loading strategy:** Should the palette load ALL plans (active + paused + draft) on open, or only active? Loading all requires a fresh `list_directory` call each open — adds latency. Recommendation: load all on open (one MCP call, fast), cache with a 30s TTL.

2. **Pillar spawn UX:** Since direct spawn isn't possible from browser, should "pillar commands" just send messages to Flow? Or is there a bridge message type we should add? Chart should decide scope.

3. **SELF-IMPROVE:** Same question — send to Flow as message, or add a dedicated bridge command?

4. **callMcpTool in CommandPalette:** Best accessed via `useMCP()` directly inside the component (singleton pattern), not props. Confirm this is acceptable.

5. **Plan content display:** Should the palette show plan content preview on hover/select? Or just filename + status badge? Recommend filename + status badge only for v1.

6. **Error handling for plan rename:** What if `move_file` fails (destination exists, permissions)? Show an error toast? Silently fail?

---

## 11. Summary — What Forge Needs

### New props for CommandPalette (OR: use composables directly)
If using composables directly (recommended):
```js
// Inside CommandPalette.vue <script setup>
import { useMCP } from '../composables/useMCP.js'
import { useProject } from '../composables/useProject.js'

const { callMcpTool } = useMCP()
const { activePlans, projectRoot, refreshActivePlans } = useProject()
```

### New emits for CommandPalette
No new emits needed if composables are called directly. If props approach:
```
'plan-status-change' — payload: { filename, newStatus }
'power-command'      — payload: { command: 'self-improve' | ... }
```

### New command categories to build
1. **Navigation** (existing: New Chat, Settings + add: Toggle Sidebar)
2. **Plans** (dynamic: loaded from filesystem — all statuses, with status badges)
3. **Pillars** (static: spawn Scout / Chart / Forge / Polish / Ship commands → send to Flow)
4. **Power** (static: SELF-IMPROVE, Refresh Plans)

### Key new reactive state needed in component
```js
const allPlans = ref([])       // { filename, status, date, scope, slug } — loaded async on open
const plansLoading = ref(false)
const planError = ref(null)
```

### Plan status change flow
```
1. User selects "Pause plan: command-palette"
2. parsePlanFilename(filename) → extract body
3. callMcpTool('mcp__filesystem__move_file', { source: .../active-{body}.md, destination: .../paused-{body}.md })
4. refreshActivePlans(callMcpTool)  → updates activePlans ref app-wide
5. Re-render palette
```
