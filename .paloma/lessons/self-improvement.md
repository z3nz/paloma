# Lessons: Self-Improvement Audits

### Lesson: Codebase self-audits produce high-value, low-risk wins at scale
- **Context:** On 2026-03-21, a comprehensive self-improvement session audited the entire Paloma codebase (bridge, MCP servers, frontend). Produced 28 fixes across 4 categories (security, performance, robustness, UX) in 5 commits. The session used parallel Forge pillars for file-disjoint work and the full Scout→Forge→Polish pipeline.
- **Insight:** Self-improvement audits — where Paloma systematically reviews her own code for security, performance, and quality issues — are one of the highest-ROI activities. The key patterns that made this work: (1) **Scout first** — a structured audit pass identifies all issues before any code is touched, producing a prioritized list with severity ratings. (2) **Batch by file, not by category** — grouping fixes by which files they touch (not by "security" vs "performance") enables parallel Forge sessions on file-disjoint batches. (3) **Multiple focused commits** — 5 smaller commits (not 1 mega-commit) with clear subjects make git history searchable and reversible. (4) **Polish catches real issues** — the cosmetic cleanup commit (ce8f66b) came from Polish finding leftover dead code and misattached JSDoc that Forge missed.
- **Action:** Schedule periodic self-improvement audits (monthly or after major feature pushes). Use the pattern: Scout audit → categorize by severity → batch by file affinity → parallel Forge → Polish → Ship.
- **Applied:** N/A — awareness only, establishing the pattern for future audits

---

### Lesson: Path traversal via startsWith without trailing separator is a real vulnerability pattern
- **Context:** Three separate MCP servers (exec.js, fs-extra.js, web.js) had path validation using `resolvedPath.startsWith(allowedDir)` where `allowedDir` was `/home/adam`. This passes for `/home/adam-evil/secrets` because the string starts with `/home/adam`.
- **Insight:** `startsWith` path validation MUST include a trailing separator: `path.startsWith(allowedDir + '/')` or check `path === allowedDir`. This is OWASP-level basic but easy to miss when writing path guards quickly. The fix is mechanical — search for all `startsWith` calls on path variables and verify they include the separator. This pattern should be checked in every security audit.
- **Action:** When reviewing path validation: grep for `startsWith` on any variable that holds a directory path. Verify trailing `/` is included. Fix immediately if missing.
- **Applied:** YES — fixed in exec.js, fs-extra.js, web.js (commit 7214e02)

---

### Lesson: highlight.js tree-shaking yields massive bundle wins (940KB → 21KB)
- **Context:** The frontend bundle included the full highlight.js library (940KB chunk) for syntax highlighting in chat messages. Only ~10 languages were actually used.
- **Insight:** highlight.js ships every language by default when imported as `import hljs from 'highlight.js'`. Switching to `import hljs from 'highlight.js/lib/core'` and registering only needed languages (`javascript`, `python`, `typescript`, `bash`, `json`, `html`, `css`, `rust`, `go`, `yaml`) reduced the chunk from 940KB to 21KB — a 97.7% reduction in that chunk and ~66% reduction in total bundle size. This is the single biggest performance win possible in most frontend projects that use highlight.js. Check for this pattern in any project using highlight.js.
- **Action:** Always import `highlight.js/lib/core` and register languages individually. Never use the default import.
- **Applied:** YES — fixed in frontend (commit 7214e02)

---

### Lesson: Singleton composables eliminate O(n²) reactivity overhead
- **Context:** `useCostTracking` was instantiated per-component, each creating its own reactive watchers over the same shared state. With N components mounting, this created N² reactive subscriptions.
- **Insight:** Vue composables that track global state (costs, session info, connection status) should use the module-level singleton pattern: create reactive state once at module scope, export a function that returns refs to that state. Every component shares the same reactive objects — zero duplication, O(1) subscriptions regardless of component count. This is already the pattern used by other Paloma composables (useMCP, useCliChat).
- **Action:** When creating composables for global/shared state, always use module-level singletons. Per-component instantiation is only correct for component-local state.
- **Applied:** YES — refactored useCostTracking (commit 7214e02)
