# Command Palette — Paloma's Command Center

> Ctrl+K opens a powerful command palette that goes beyond session switching. Manage plans, spawn pillars, trigger self-improvement, and navigate Paloma with speed.

## Vision

The command palette becomes Paloma's nerve center — a place where Adam can do anything with a few keystrokes. Not just search, but *command*.

**Core capabilities:**
1. **Navigation** — Switch sessions, new chat, settings, toggle sidebar
2. **Plan Management** — View all plans with status badges, activate/pause/archive plans inline
3. **Pillar Commands** — Spawn any pillar directly from the palette
4. **Power Commands** — SELF-IMPROVE (autonomous improvement spree), refresh plans, etc.
5. **Prefix filtering** — `>` for commands only, `plan:` for plans, `pillar:` for pillar actions

## Existing State

CommandPalette.vue exists with basic functionality:
- Opens on Ctrl+K (keyboard shortcut wired in useKeyboardShortcuts.js)
- Shows "New Chat" and "Settings" actions
- Lists recent sessions with phase icons
- Arrow key navigation + Enter to select
- Mounted in App.vue with close/select-session/new-chat/settings events

## Design Principles

- Fast and responsive — no loading spinners for basic commands
- Keyboard-first — everything reachable without a mouse
- Extensible — easy to add new commands later
- Beautiful — consistent with Paloma's dark theme aesthetic

## Implementation Spec

### 1. Architecture Overview

CommandPalette.vue is a **single-file component** — no new files needed. The component imports composable singletons directly (`useMCP`, `useProject`, `useSessions`, `useKeyboardShortcuts`) and emits events to App.vue only for actions that require App.vue's existing handlers (session selection, phase transitions, chat message injection).

**Data flow:**
```
CommandPalette.vue
  ├── Static commands (Navigation, Pillars, Power) — defined inline
  ├── Dynamic commands (Plans) — loaded via MCP list_directory on open
  ├── Sessions — from useSessions() singleton
  └── Emits → App.vue for: select-session, new-chat, settings, spawn-pillar, inject-message, toggle-sidebar
```

### 2. Command Registry

Commands are plain objects in a flat array. No class hierarchy, no registry pattern — just data.

```js
// Shape of a command item
{
  id: string,           // unique key, e.g. 'nav:new-chat', 'plan:active-20260319-...'
  category: string,     // 'navigation' | 'plans' | 'pillars' | 'power' | 'sessions'
  label: string,        // display text, e.g. 'New Chat', 'Pause: command-palette'
  description: string,  // secondary text, e.g. 'Start a fresh conversation'
  icon: string,         // single emoji/unicode char
  shortcut: string?,    // optional keyboard shortcut hint, e.g. 'Ctrl+N'
  badge: string?,       // optional status badge text, e.g. 'active', 'draft'
  badgeColor: string?,  // Tailwind text color class for the badge
  execute: Function,    // () => void — called when item is selected
}
```

**Static commands** (defined once at component level):

| ID | Category | Label | Icon | Shortcut | Execute |
|----|----------|-------|------|----------|---------|
| `nav:new-chat` | navigation | New Chat | + | Ctrl+N | `emit('new-chat')` |
| `nav:settings` | navigation | Settings | ⚙ | | `emit('settings')` |
| `nav:toggle-sidebar` | navigation | Toggle Sidebar | ◧ | Ctrl+/ | `sidebarCollapsed.value = !sidebarCollapsed.value` |
| `pillar:scout` | pillars | Spawn Scout | ◈ | | `emit('spawn-pillar', 'scout')` |
| `pillar:chart` | pillars | Spawn Chart | ▣ | | `emit('spawn-pillar', 'chart')` |
| `pillar:forge` | pillars | Spawn Forge | ✦ | | `emit('spawn-pillar', 'forge')` |
| `pillar:polish` | pillars | Spawn Polish | ◇ | | `emit('spawn-pillar', 'polish')` |
| `pillar:ship` | pillars | Spawn Ship | ⚐ | | `emit('spawn-pillar', 'ship')` |
| `power:self-improve` | power | Self-Improve | ⚡ | | `emit('inject-message', SELF_IMPROVE_PROMPT)` |
| `power:refresh-plans` | power | Refresh Plans | ↻ | | `refreshActivePlans(callMcpTool)` (inline) |

**Pillar descriptions (secondary text):**
- Scout: "Research and investigate"
- Chart: "Design and plan"
- Forge: "Build and implement"
- Polish: "Review and test"
- Ship: "Commit and deliver"

**SELF_IMPROVE_PROMPT** (const string):
```
"SELF-IMPROVE: Begin an autonomous improvement spree. Scout the codebase for issues, rough edges, or opportunities. Then run the full pipeline to fix what you find."
```

### 3. Dynamic Plan Commands

Plans are loaded **on each palette open** via a single MCP call. No caching needed — the call is fast (<50ms) and plans change infrequently.

**Loading flow (in `onMounted` or a `watch` on visibility):**
```js
async function loadPlans() {
  if (!projectRoot.value) return
  const result = await callMcpTool('mcp__filesystem__list_directory', {
    path: `${projectRoot.value}/.paloma/plans`
  })
  // Parse "[FILE] filename.md" lines
  const files = result.split('\n')
    .map(line => line.match(/^\[FILE\]\s+(.+)/)?.[1])
    .filter(Boolean)
  allPlans.value = files.map(parsePlanFilename).filter(Boolean)
}
```

**`parsePlanFilename(filename)` helper:**
```js
function parsePlanFilename(filename) {
  const match = filename.match(/^(active|paused|draft|completed|archived)-(\d{8})-(.+)\.md$/)
  if (!match) return null
  const [, status, date, rest] = match
  const firstDash = rest.indexOf('-')
  return {
    filename,
    status,
    date,
    scope: firstDash > -1 ? rest.slice(0, firstDash) : rest,
    slug: firstDash > -1 ? rest.slice(firstDash + 1) : '',
    body: `${date}-${rest}` // invariant across renames
  }
}
```

**Plan items are generated as commands:**
Each plan becomes a command item. Selecting a plan **drills into a sub-view** showing status change actions (see Section 5).

```js
// Generated per plan
{
  id: `plan:${plan.filename}`,
  category: 'plans',
  label: plan.slug.replace(/-/g, ' '),  // e.g. "command palette"
  description: `${plan.scope} · ${plan.date}`,
  icon: planStatusIcon(plan.status),
  badge: plan.status,
  badgeColor: planStatusColor(plan.status),
  execute: () => enterPlanSubView(plan)
}
```

**Status icons and colors:**
```js
const PLAN_STATUS = {
  active:    { icon: '●', color: 'text-green-400' },
  paused:    { icon: '⏸', color: 'text-yellow-400' },
  draft:     { icon: '○', color: 'text-text-muted' },
  completed: { icon: '✓', color: 'text-blue-400' },
  archived:  { icon: '▪', color: 'text-text-muted' }
}
```

**Plan display order:** active first, then paused, draft, completed, archived. Within each status group, sorted by date descending (newest first).

### 4. Prefix Filtering

The search input supports prefix-based category filtering:

| Prefix | Filters to | Placeholder hint |
|--------|-----------|------------------|
| `>` | Commands only (navigation + pillars + power) | "Type a command..." |
| `plan:` | Plans only | "Search plans..." |
| `pillar:` | Pillar commands only | "Choose a pillar..." |
| (none) | Everything (commands + plans + sessions) | "Search sessions, commands..." |

**Implementation:**
```js
const parsedQuery = computed(() => {
  const raw = query.value
  if (raw.startsWith('>'))      return { filter: 'commands', text: raw.slice(1).trim() }
  if (raw.startsWith('plan:'))  return { filter: 'plans', text: raw.slice(5).trim() }
  if (raw.startsWith('pillar:')) return { filter: 'pillars', text: raw.slice(7).trim() }
  return { filter: 'all', text: raw }
})
```

**Category visibility rules per filter:**
| Filter | navigation | plans | pillars | power | sessions |
|--------|-----------|-------|---------|-------|----------|
| `all` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `commands` | ✓ | ✗ | ✓ | ✓ | ✗ |
| `plans` | ✗ | ✓ | ✗ | ✗ | ✗ |
| `pillars` | ✗ | ✗ | ✓ | ✗ | ✗ |

**Text matching:** case-insensitive substring match against `label`, `description`, and `badge` fields.

### 5. Two-Level Drill-Down (Plan Sub-View)

When a plan item is selected, the palette transitions to a **sub-view** showing available status changes for that plan.

**State management:**
```js
const subView = ref(null)  // null = top-level, { type: 'plan-actions', plan: {...} } = drill-down
```

**When `subView` is set:**
- The search input shows the plan name as a breadcrumb prefix (non-editable visual label)
- The query resets to empty
- The results list shows only the available status transitions
- Pressing Backspace on empty query returns to top-level (`subView.value = null`)
- Pressing Escape also returns to top-level (if already in sub-view; if at top-level, closes palette)

**Available status transitions for a plan:**
```js
function getStatusActions(plan) {
  const all = ['active', 'paused', 'draft', 'completed', 'archived']
  return all
    .filter(s => s !== plan.status)  // exclude current status
    .map(newStatus => ({
      id: `plan-action:${plan.filename}:${newStatus}`,
      category: 'plan-actions',
      label: `${statusVerb(newStatus)}`,   // e.g. "Activate", "Pause", "Archive"
      description: `${plan.status} → ${newStatus}`,
      icon: PLAN_STATUS[newStatus].icon,
      badge: newStatus,
      badgeColor: PLAN_STATUS[newStatus].color,
      execute: () => changePlanStatus(plan, newStatus)
    }))
}

function statusVerb(status) {
  return { active: 'Activate', paused: 'Pause', draft: 'Move to Draft', completed: 'Complete', archived: 'Archive' }[status]
}
```

**`changePlanStatus` implementation:**
```js
async function changePlanStatus(plan, newStatus) {
  const basePath = `${projectRoot.value}/.paloma/plans`
  const newFilename = `${newStatus}-${plan.body}.md`
  await callMcpTool('mcp__filesystem__move_file', {
    source: `${basePath}/${plan.filename}`,
    destination: `${basePath}/${newFilename}`
  })
  await refreshActivePlans(callMcpTool)
  await loadPlans()  // refresh the palette's plan list
  subView.value = null  // return to top-level
}
```

**Sub-view breadcrumb rendering:**
When in sub-view, show a styled breadcrumb chip before the input:
```html
<span v-if="subView" class="shrink-0 text-xs bg-accent/20 text-accent px-2 py-0.5 rounded mr-2">
  {{ subView.plan.slug.replace(/-/g, ' ') }}
</span>
```

### 6. Event Contract

**Events emitted by CommandPalette → handled by App.vue:**

| Event | Payload | App.vue Handler |
|-------|---------|-----------------|
| `close` | none | `showCommandPalette = false` |
| `select-session` | `sessionId: string` | `handleSelectSession(id)` (existing) |
| `new-chat` | none | `handleNewChat()` (existing) |
| `settings` | none | `showSettings = true` (existing) |
| `toggle-sidebar` | none | `sidebarCollapsed.value = !sidebarCollapsed.value` |
| `spawn-pillar` | `phase: string` | NEW — calls `handlePhaseTransition({ phase, fromPhase: activeSession.phase, sessionId: activeSessionId })` |
| `inject-message` | `message: string` | NEW — injects message into active chat session (see below) |

**NEW: `spawn-pillar` handler in App.vue:**
```js
// In App.vue's CommandPalette listener:
@spawn-pillar="(phase) => {
  showCommandPalette = false
  handlePhaseTransition({ phase, fromPhase: activeSession?.phase || 'flow', sessionId: activeSessionId.value })
}"
```
This reuses the existing `handlePhaseTransition` function — it already creates pillar sessions with birth context, model selection, etc. No new bridge messaging needed.

**NEW: `inject-message` handler in App.vue:**
```js
@inject-message="(msg) => {
  showCommandPalette = false
  // Inject as a user message into the active chat session
  // useChat exposes injectMessage or we use a simple event bus approach
  injectedMessage.value = msg
}"
```

For `inject-message`, App.vue sets a reactive ref that ChatView watches. When ChatView sees a new injected message, it sends it as if the user typed and submitted it.

**Implementation in App.vue:**
```js
const injectedMessage = ref(null)
```

Pass to ChatView as a prop:
```html
<ChatView :injected-message="injectedMessage" @clear-injected="injectedMessage = null" />
```

ChatView watches `injectedMessage`, calls `sendMessage(injectedMessage)`, then emits `clear-injected`.

**Alternative (simpler):** Instead of a reactive ref, just emit `inject-message` and have App.vue directly call the chat composable. Since `useChat` is a singleton, App.vue can do:
```js
import { useChat } from './composables/useChat.js'
const { sendMessageFromPalette } = useChat()

// In handler:
@inject-message="(msg) => { showCommandPalette = false; sendMessageFromPalette(msg) }"
```

**Forge should evaluate which approach is simpler and pick one.** The key requirement is: SELF-IMPROVE sends a user message into the active chat without user having to type it. If `useChat` doesn't expose a programmatic send, Forge should add one (a thin wrapper around the existing send logic).

### 7. Visual Design

**Overall layout** — same as current: fixed overlay, centered card, search input at top, scrollable results below.

**Category headers:**
```html
<div class="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
  {{ categoryLabel }}
</div>
```
Category labels: "Navigation", "Plans", "Pillars", "Power", "Sessions"

Categories only render if they have visible items. Order: Navigation → Plans → Pillars → Power → Sessions.

**Command item (enhanced):**
```html
<button class="w-full flex items-center px-4 py-2 text-sm text-left transition-colors group"
        :class="selected ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-primary'">
  <!-- Icon -->
  <span class="w-5 h-5 mr-3 flex items-center justify-center text-xs shrink-0"
        :class="item.badgeColor || 'text-text-muted'">
    {{ item.icon }}
  </span>
  <!-- Label + Description -->
  <div class="flex-1 min-w-0">
    <div class="truncate">{{ item.label }}</div>
    <div v-if="item.description" class="text-[11px] text-text-muted truncate">{{ item.description }}</div>
  </div>
  <!-- Badge -->
  <span v-if="item.badge" class="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-border shrink-0"
        :class="item.badgeColor || 'text-text-muted'">
    {{ item.badge }}
  </span>
  <!-- Shortcut -->
  <kbd v-if="item.shortcut" class="ml-2 text-[10px] text-text-muted bg-bg-primary px-1.5 py-0.5 rounded border border-border shrink-0">
    {{ item.shortcut }}
  </kbd>
</button>
```

**Session items** remain as they are today — phase icon, title, time-ago. They become a `sessions` category in the unified list.

**Sub-view (plan actions):** Same item rendering, but with a breadcrumb chip before the search input and a back arrow hint:
```html
<button v-if="subView" @click="subView = null" class="shrink-0 text-text-muted hover:text-text-secondary mr-1">
  ←
</button>
```

**Empty state** adapts to the active filter:
- `>` prefix: "No matching commands"
- `plan:` prefix: "No matching plans"
- Default: "No results for "query""

### 8. Keyboard Navigation

Extends the existing flat-index pattern. All visible items across all categories are indexed sequentially into a single `selectedIndex`.

**Key bindings:**
| Key | Action |
|-----|--------|
| ↑/↓ | Move selection through flat list |
| Enter | Execute selected item (or drill into plan sub-view) |
| Escape | If in sub-view → return to top-level. If at top-level → close palette. |
| Backspace (on empty input) | If in sub-view → return to top-level. |
| Tab | No-op (prevent focus leaving the input) |

**Scroll into view:** When `selectedIndex` changes, scroll the selected item into view:
```js
watch(selectedIndex, () => {
  nextTick(() => {
    const el = paletteRef.value?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  })
})
```

### 9. Composable Imports (No Props)

CommandPalette imports singletons directly — no prop changes to App.vue's template:

```js
import { useSessions } from '../composables/useSessions.js'
import { useMCP } from '../composables/useMCP.js'
import { useProject } from '../composables/useProject.js'
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts.js'
```

App.vue only changes:
1. Add new event listeners: `@spawn-pillar`, `@inject-message`, `@toggle-sidebar`
2. Import `useChat` if using the programmatic send approach for inject-message

### 10. Files Modified

| File | Changes |
|------|---------|
| `src/components/CommandPalette.vue` | Full rewrite of command system, plan loading, prefix filtering, sub-view, visual enhancements |
| `src/App.vue` | Add `@spawn-pillar`, `@inject-message`, `@toggle-sidebar` handlers on CommandPalette |

No new files created. No composable changes needed (all necessary APIs are already exported).

### 11. Edge Cases

- **No projectRoot:** If `projectRoot` is null, skip plan loading. Plans category just doesn't appear.
- **move_file fails:** If plan rename fails (e.g. destination exists), show the error inline in the palette as a brief red text message. Don't crash.
- **Empty plan list:** Plans category header doesn't render if no plans match.
- **Very long plan lists:** The scrollable area already has `max-h-72`. 46 plans (current count) will scroll fine. No pagination needed.
- **Concurrent plan rename:** If two renames happen fast, the second may fail. Acceptable — user just retries.
- **Plan filename doesn't match pattern:** `parsePlanFilename` returns null → filtered out silently.

### 12. What Forge Does NOT Need to Build

- No new composables or utility files
- No WebSocket message types
- No bridge changes
- No new MCP tool integrations (uses existing `callMcpTool`)
- No routing changes

## Research References

- **Scout findings:** `.paloma/docs/scout-command-palette-20260319.md` — full interface specs for composables, MCP tools, plan data shapes

## Work Units

#### WU-1: Research the existing CommandPalette
- **Status:** completed
- **Files:** src/components/CommandPalette.vue, src/App.vue, src/composables/useProject.js, src/composables/useMCP.js
- **Scope:** Research the existing CommandPalette.vue, App.vue integration, useProject.js plan data, useMCP.js callMcpTool pattern, and filesystem MCP tools. Document the exact interfaces, data shapes, and integration points needed to enhance the palette.
- **Acceptance:** Scout doc written to .paloma/docs/ with clear interface specs for the enhancement
- **Result:** Scout doc written to .paloma/docs/scout-command-palette-20260319.md. Key findings: composables are singletons (no prop drilling needed), plan management = file rename via MCP move_file, pillar spawning NOT available from browser callMcpTool — must route through Flow session messages.

#### WU-2: Design the enhanced command palette architecture: command registry pattern, cate
- **Status:** completed
- **Files:** src/components/CommandPalette.vue
- **Scope:** Design the enhanced command palette architecture: command registry pattern, category system, plan management UX flow, prefix filtering logic, and power command execution model.
- **Acceptance:** Plan updated with detailed implementation spec covering component structure, command registry, and data flow
- **Result:** Implementation spec written to plan document. Key decisions: flat command registry, plan loading via MCP list_directory on open, two-level drill-down for plan status changes, prefix filtering (> commands, plan: plans, pillar: pillars), three new events (spawn-pillar, inject-message, toggle-sidebar). No new files needed.

#### WU-3: Implement the enhanced CommandPalette
- **Status:** completed
- **Files:** src/components/CommandPalette.vue, src/App.vue, src/components/chat/ChatView.vue
- **Scope:** Implement the enhanced CommandPalette.vue: command registry with categories, dynamic plan loading, plan status management, prefix filtering, SELF-IMPROVE, and App.vue/ChatView.vue integration.
- **Acceptance:** Command palette opens with Ctrl+K, shows categorized commands, can manage plans and trigger power commands
- **Result:** Full rewrite of CommandPalette.vue (13 static commands, dynamic plan loading, two-level drill-down, prefix filtering). App.vue wired with spawn-pillar/inject-message/toggle-sidebar. ChatView.vue accepts injectedMessage prop. Build passes clean.

#### WU-4: Review the implementation for code quality, UX edge cases, keyboard navigation c
- **Status:** completed
- **Files:** src/components/CommandPalette.vue, src/App.vue, src/components/chat/ChatView.vue
- **Scope:** Review the implementation for code quality, UX edge cases, keyboard navigation correctness, error handling, and visual polish.
- **Acceptance:** All issues found are documented or fixed. Code is clean and production-ready.
- **Result:** All clear — no blocking issues. Keyboard nav wraps correctly, plan rename logic preserves body invariant, inject-message has no infinite loop (null guard), all 7 emits match App.vue handlers, build clean.
#### WU-5: Commit all changes, update backlog, archive plan, push to remote
- **Status:** completed
- **Files:** src/components/CommandPalette.vue, src/App.vue, src/components/chat/ChatView.vue, .paloma/plans/active-20260319-paloma-command-palette.md, .paloma/plans/active-20260313-paloma-backlog.md
- **Scope:** Commit all changes, update backlog, archive plan, push to remote.
- **Acceptance:** Changes committed and pushed. Backlog updated. Plan archived.
- **Result:** 5 commits pushed to main. Merge conflict in ChatView.vue resolved (kept both injectedMessage watcher and pendingAutoResume watcher). Backlog ticket #2 marked complete. Plan archived to completed- prefix.