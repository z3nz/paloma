# Paloma TODO List

> Living document of tasks, bugs, and improvements. Organized by priority.

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
