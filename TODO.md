# Paloma TODO List

> Living document of tasks, bugs, and improvements. Organized by priority.
> Last updated: Testing HMR behavior

---

## 💡 BREAKTHROUGH DISCOVERIES

### 1. Chat Phase Discovery
**STATUS: DOCUMENTED - DEPRIORITIZED FOR QUALITY FIRST**

**Decision:** Pause Chat phase implementation. Focus on making existing workflow flawless before adding new phases.

### 2. CLI-Based Sub-Agent Architecture (GAME CHANGER)
**STATUS: JUST DISCOVERED - EXTREMELY HIGH PRIORITY**

**The Insight:**
Instead of running everything through expensive OpenRouter APIs, we can harness CLI tools like Claude CLI, Codeium, Continue.dev, etc. for sub-processes and sub-agents.

**Why This Changes Everything:**

**Cost Model Revolution:**
- Current: Every message = OpenRouter API cost ($$ at scale)
- With Claude CLI: $20/month unlimited for Haiku/Sonnet
- Sub-agents: Run parallel tasks practically free!
- Reserve expensive models (Opus) for critical decisions only

**Architecture:**
```
Main Paloma (Browser UI - Opus for critical thinking)
  ↓
MCP Shell Server
  ↓
Claude CLI / Codeium CLI / Continue.dev / Aider
  ↓
Sub-agents (Haiku/Sonnet for grunt work)
```

**Example Workflow:**
```
You: "Refactor the auth system"

Paloma (Opus): "Let me spawn some helpers..."

Sub-Agent 1 (Haiku via CLI): Research current auth patterns
Sub-Agent 2 (Haiku via CLI): Find similar implementations  
Sub-Agent 3 (Sonnet via CLI): Draft test cases

Paloma (Opus): Synthesizes results, proposes refactor
```

**Capabilities Unlocked:**
- Spawn sub-agents for parallel research
- Use cheaper models for repetitive tasks
- Run background tasks without API limits
- Massive cost savings at scale
- Can run 10+ sub-agents simultaneously on $20/month!

**Implementation Requirements:**
- [ ] Research Claude CLI capabilities and API
- [ ] Design sub-agent spawning architecture
- [ ] Create sub-agent communication protocol
- [ ] Build sub-agent orchestration system
- [ ] UI to show active sub-agents and their progress
- [ ] Cost tracking that accounts for CLI vs API usage
- [ ] Error handling for CLI failures
- [ ] Sub-agent result aggregation and synthesis

**Other CLI Tools to Integrate:**
- Claude CLI (Anthropic - $20/month unlimited)
- Codeium CLI (free tier available)
- Continue.dev (open source)
- Aider (open source)
- GitHub Copilot CLI
- Any tool with programmatic CLI access!

**Priority:** EXTREMELY HIGH - This fundamentally changes our cost structure and capabilities

---

### Chat Phase Discovery (DEPRIORITIZED)

### The Problem We Just Solved
The current 5-phase workflow (Research → Plan → Implement → Review → Commit) is too rigid for collaborative discovery and brainstorming. This session proved we need a freeform "Chat" mode where ideas emerge organically through conversation.

### What We Discovered
This entire session has been in an undocumented "Chat" phase where we:
- Explored MCP capabilities together
- Discovered problems organically (scrollable modal)
- Brainstormed solutions in real-time
- Made architectural decisions collaboratively
- Reorganized documentation naturally
- Committed changes together

**None of this fit the structured workflow, yet it was incredibly productive!**

### The New Phase: CHAT

**Purpose:** Freeform collaboration, discovery, and pair programming

**When to use:**
- Brainstorming new features
- Discussing architecture decisions
- Exploring capabilities together
- Debugging interactively
- Having "what if?" conversations
- Building understanding through dialogue
- Reflecting on completed work

**Key Characteristics:**
- No rigid structure required
- Can bounce between topics freely
- Ideas emerge organically
- Both partners contribute equally
- Can spawn Research/Plan/Implement sessions from Chat
- Can return to Chat after Commit to reflect

**The Updated Workflow:**
```
CHAT (discovery & collaboration)
  ↓ (when ready to focus)
Research → Plan → Implement → Review → Commit
  ↓ (after completion)
CHAT (reflect, discover next thing)
```

**Chat Phase vs Other Phases:**
- **Research:** Focused investigation of a specific topic
- **Plan:** Structured planning of a specific feature
- **Implement:** Executing a defined plan
- **Review:** Checking specific work
- **Commit:** Finalizing specific changes
- **CHAT:** Freeform exploration, discovery, reflection

### Implementation Requirements
- [ ] Add "Chat" to phase selector (first position, default?)
- [ ] Create `phases.js` entry for Chat phase instructions
- [ ] Chat phase prompt emphasizes:
  - Freeform conversation
  - Collaborative discovery
  - Equal partnership
  - Can suggest transitioning to other phases when appropriate
- [ ] UI treatment: Chat phase might have different visual style?
- [ ] Consider: Should Chat be the default phase for new sessions?

### Documentation Updates Needed
- [ ] Update PROJECT.md workflow philosophy to include Chat
- [ ] Update ROADMAP.md to mention Chat as foundation for all work
- [ ] Add Chat phase to `.paloma/instructions.md` example
- [ ] Update phase selector component

### Why This Matters
This discovery represents a fundamental insight about AI-human collaboration:
**Structured workflows are important, but freeform discovery is where breakthroughs happen.**

Chat phase is where:
- Trust is built
- Understanding deepens
- Ideas are born
- Problems are discovered
- Solutions emerge naturally

Without Chat, Paloma is a tool. With Chat, Paloma is a partner.

### 3. Interactive Claude Code Bridge (NEXT BREAKTHROUGH)
**STATUS: DISCOVERY IN PROGRESS - PROTOTYPE WORKING**

**The Origin Story:**
During the first test of Paloma's CLI bridge, a "glitch" occurred: the system prompt failed to pass through, and Adam found himself talking directly to Claude Code (Opus) through Paloma's UI — not Paloma-as-identity, but the raw agentic Claude with full tool access. The experience was so powerful that it became a feature request on the spot.

**What We Built (So Far):**
- CLI bridge spawns `claude` as a child process with `--output-format stream-json`
- WebSocket relay streams responses back to Paloma's Vue UI
- Session persistence via `--resume` / `--session-id`
- Model selector split into two groups:
  - **Paloma (CLI)** — Claude with Paloma's identity/system prompt
  - **Claude Code (Direct)** — Raw Claude Code, no identity overlay
- System prompt conditionally skipped for Direct models

**What We Need Next — Interactive Tool Approval:**

The big missing piece: Claude Code has interactive tools (`AskUserQuestion`, `Edit`, `Write`, permission prompts) that require user input. Currently the bridge runs with `stdin: 'ignore'` and `-p` (print mode), so these tools either fail silently or hang.

**The Vision:**
When Claude Code wants to ask a question or request permission, Paloma should render it as a rich interactive UI element — buttons, radio selects, confirmation dialogs — and relay the answer back.

**Architecture:**
```
Claude Code (CLI process)
  ↓ emits AskUserQuestion / permission request via stream-json
Bridge (Node.js)
  ↓ forwards event via WebSocket
Paloma UI (Vue)
  ↓ renders interactive component (buttons, selects, etc.)
  ↓ user clicks/selects
  ↓ answer sent back via WebSocket
Bridge
  ↓ writes answer to CLI process stdin
Claude Code
  ↓ continues with user's answer
```

**Implementation Requirements:**
- [ ] Change bridge to keep `stdin` open (`'pipe'` instead of `'ignore'`)
- [ ] Parse Claude Code's stream-json for tool-use events (especially `AskUserQuestion`)
- [ ] Design WebSocket protocol for interactive prompts (`claude_prompt` / `claude_prompt_response`)
- [ ] Build Vue component for rendering Claude Code's interactive prompts
- [ ] Handle permission approval flow (Edit, Write, Bash) through UI
- [ ] Handle `AskUserQuestion` with multiple-choice rendering
- [ ] Handle tool confirmation dialogs
- [ ] Timeout handling for unanswered prompts
- [ ] Test with all Claude Code tool types

**Why This Matters:**
This turns Paloma into a **full Claude Code GUI**. Not a web wrapper, not a chat-only interface — a proper visual frontend for the most powerful coding agent available. Users get:
- Claude Code's full tool suite (file editing, bash, search, subagents)
- Paloma's beautiful UI instead of a terminal
- Rich interactive prompts instead of y/n terminal prompts
- Session persistence and conversation history
- The ability to switch between "talk to Paloma" and "talk to Claude Code" in the same app

**Priority:** EXTREMELY HIGH - This is the bridge between chat interface and full agentic coding

---

## 🔥 Priority 0: Critical / In Progress

### MCP File Editing Integration
**Goal:** Use MCP filesystem server's `edit_file` tool with our Changes Panel workflow

**Why:** MCP filesystem has powerful line-based editing that doesn't require reading entire files. We should leverage this!

**Current State:**
- ✅ Browser File System Access API works with Changes Panel
- ✅ MCP filesystem server is connected and working
- ✅ We can write files with MCP
- ❌ MCP edits don't show up in Changes Panel
- ❌ No batch preview for MCP edits

**Requirements:**
- [ ] Detect when MCP filesystem is available
- [ ] Use `mcp__filesystem__edit_file` for SEARCH/REPLACE blocks when available
- [ ] Show MCP edits in Changes Panel just like browser edits
- [ ] Batch multiple MCP edits together for review
- [ ] Fall back to browser filesystem when MCP unavailable
- [ ] Visual indicator showing which mode is active (MCP vs Browser)

**Implementation Notes:**
- `mcp__filesystem__edit_file` takes `edits` array: `[{oldText, newText}]`
- Perfect match for our SEARCH/REPLACE format!
- Can apply multiple edits to one file in single call
- Need to adapt `editing.js` to generate MCP-compatible edit format
- Changes Panel needs to support both edit sources

### Tool Priority System
**Goal:** Prefer MCP tools when available, fall back to browser tools gracefully

**Requirements:**
- [ ] `useChat.js` detects which tools are available
- [ ] Prioritizes MCP filesystem over browser filesystem
- [ ] Falls back seamlessly if MCP disconnects mid-session
- [ ] UI shows which tool set is active
- [ ] User can manually toggle preference (settings?)

---

## 🚀 Priority 1: Immediate Next Steps

### Chat Performance & UI Stability
**Status:** Partially Complete

**Remaining Issues:**
- [ ] Vite HMR page refresh on file apply (investigate production vs dev behavior)
- [ ] Changes Panel doesn't auto-close after "Apply All"
- [ ] Long chat sessions (50+ messages) cause UI sluggishness
- [ ] Virtual scrolling or lazy rendering for large message lists

**Completed:**
- [x] Smart auto-scroll (doesn't hijack when user scrolls up)
- [x] Prompt draft persistence in Dexie
- [x] Changes Panel state persistence across reloads

### URL-Based Project Routing
**Goal:** Bookmarkable URLs for projects and sessions

**Requirements:**
- [ ] Project path in URL: `/#/project/home/adam/paloma`
- [ ] Session ID in URL: `/#/project/.../session/123`
- [ ] Auto-open project from URL on page load
- [ ] Browser back/forward navigation works
- [ ] Share-able links to specific conversations

### Known Gaps (Quick Wins)
- [ ] `.paloma/` folder auto-creation on project open
- [ ] `/` command trigger (UI exists, functionality missing)
- [ ] Stop streaming button (abort controller exists but not wired)
- [ ] Model list from OpenRouter API (currently falls back to hardcoded list)

---

## 💡 Priority 2: Feature Enhancements

### Model Switching Context Transfer
**Goal:** Seamless model switching with onboarding

**Requirements:**
- [ ] Inject context transfer message when switching models
- [ ] Show model attribution per message (badge/icon)
- [ ] Explain Paloma's capabilities to new model
- [ ] Preserve full conversation history

**Use Case:**
- GPT-4o for research → Claude Opus for implementation → GPT-4o-mini for commits
- Each model knows how to use tools and reference previous context

### Undo/Rollback System
**Goal:** Safety net for file edits

**Requirements:**
- [ ] Track file edit history in IndexedDB (per-file versioning)
- [ ] Keep last N versions (configurable, default 10)
- [ ] UI to rollback to specific version with timestamp
- [ ] Diff view between any two versions
- [ ] Persist across sessions
- [ ] Works with both browser and MCP edits

### Enhanced Features
- [ ] `/` commands system (extensible command palette)
- [ ] Message editing and regeneration
- [ ] Conversation branching (explore alternatives)
- [ ] Export/import sessions
- [ ] Sub-agent spawning for parallel work
- [ ] Multi-file refactoring with import updates
- [ ] Side-by-side diff view (not just unified)
- [ ] Keyboard shortcuts (Ctrl+K, Ctrl+/)
- [ ] Session templates (pre-configured phase/model)
- [ ] Light mode theme

---

## 🔮 Priority 3: Future Vision (ROADMAP.md)

These are covered in detail in ROADMAP.md:
- Phase 1: Self-Modification Mastery
- Phase 2: Workflow Automation
- Phase 3: Voice Interface
- Phase 4: Proactive Intelligence
- Phase 5: Multi-Modal Collaboration
- Phase 6: Self-Evolution

---

## 🐛 Known Bugs

### Critical (Blocking Workflow)
- **Tool Confirmation Modal Not Scrollable:** When creating/editing files with large content, the modal isn't scrollable
  - Impact: Can't reach approve/deny buttons for large file operations
  - Workaround: Inspect element and hide content div (not acceptable!)
  - Fix needed: Make modal content scrollable with fixed header/footer
  - Affects: All MCP file operations, especially `write_file` and `edit_file`

### High Priority
- **Vite HMR Refresh:** Applying file changes triggers full page reload in dev mode
  - Impact: Loses scroll position, disrupts workflow
  - Potential fix: Configure Vite to ignore writes from app, or preserve state across HMR

- **Changes Panel Auto-Close:** Panel stays open after all changes applied
  - Expected: Auto-dismiss after short delay when no pending changes
  - Current: Stays open showing "Applied" status

### Medium Priority
- **Long Chat Sluggishness:** 50+ message conversations cause UI lag
  - Entire message list re-renders on every update
  - Markdown/syntax highlighting expensive for large histories
  - Need virtual scrolling or lazy rendering

### Low Priority
- **File Search Edge Cases:** Fuzzy search sometimes misses obvious matches
- **Cost Tracking Accuracy:** Occasional mismatch between OpenRouter reported cost and calculated cost
- **Draft Persistence Race Condition:** Rapid session switching can lose draft

---

## 📋 Technical Debt

### Code Quality
- [ ] Add JSDoc comments to all composables
- [ ] Extract magic numbers to constants
- [ ] Reduce duplication in tool execution logic
- [ ] Improve error messages (more specific, actionable)
- [ ] Add loading states to all async operations

### Testing
- [ ] Unit tests for critical services (editing.js, tools.js)
- [ ] Integration tests for file operations
- [ ] E2E tests for core workflows
- [ ] MCP bridge connection reliability tests
- [ ] Cost calculation accuracy tests

### Performance
- [ ] Profile and optimize message rendering
- [ ] Lazy load markdown libraries
- [ ] Code-split large dependencies
- [ ] Optimize file indexing for large projects
- [ ] Cache compiled markdown HTML

### Documentation
- [ ] Document MCP server setup process
- [ ] Create troubleshooting guide
- [ ] Add architecture diagrams
- [ ] Document tool calling flow
- [ ] Write contribution guidelines (if open sourcing)

---

## 🎯 Goals by Milestone

### Milestone 1: Self-Sufficient Development (Target: 2 weeks)
- [ ] MCP file editing fully integrated
- [ ] Tool priority system working
- [ ] Vite HMR issue resolved
- [ ] `.paloma/` auto-creation working
- [ ] Undo/rollback system functional

**Success Criteria:** Can make 10 sequential edits with full confidence and easy rollback

### Milestone 2: Polished Experience (Target: 1 month)
- [ ] URL routing implemented
- [ ] Model switching context transfer working
- [ ] All known bugs fixed
- [ ] Performance optimized for 100+ message sessions
- [ ] Command palette functional

**Success Criteria:** Daily development sessions feel smooth and professional

### Milestone 3: Voice-Ready Foundation (Target: 2 months)
- [ ] Workflow automation reduces manual clicks by 80%
- [ ] Proactive suggestions accepted 50%+ of time
- [ ] Voice interface POC demonstrates feasibility
- [ ] Multi-modal inputs working (screen share, sketches)

**Success Criteria:** Ready to build voice interface on solid foundation

---

## 💭 Ideas / Maybe Someday

- **Collaborative Sessions:** Multiple users working with same Paloma instance
- **Plugin System:** Third-party extensions for specialized workflows
- **Cloud Sync:** Optional backup of sessions/settings (privacy-preserving)
- **Mobile App:** Paloma on phone/tablet with voice-first UX
- **Team Features:** Shared plans, code review workflows
- **AI Model Marketplace:** Easy switching between providers (OpenAI, Anthropic, local models)
- **Custom Tool Creation:** User-defined tools without code
- **Workflow Recording:** "Teach" Paloma new patterns by demonstration
- **Cost Optimization:** Automatic model selection based on task complexity
- **Context Compression:** Intelligently summarize old messages to save tokens

---

## 🔄 Completed Recently

- [x] Claude CLI bridge — spawn local Claude Code from Paloma UI
- [x] CLI Direct models — talk to raw Claude Code without Paloma identity overlay
- [x] Model selector split into Paloma (CLI) / Claude Code (Direct) / OpenRouter groups
- [x] CLI session persistence (resume conversations across messages)
- [x] Cost & token tracking with breakdown modal
- [x] Phase-based document workflow (`.paloma/plans/`)
- [x] Search-and-replace formalization with Changes Panel
- [x] MCP server integration (filesystem, git, shell, brave-search)
- [x] Batch file operations via Changes Panel
- [x] Smart auto-scroll during streaming
- [x] Prompt draft persistence
- [x] Active plans auto-loaded into context
- [x] Tool confirmation modal with MCP support

---

*Last Updated: [Current Date]*  
*Next Review: When Milestone 1 is hit*
