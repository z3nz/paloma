# Lessons: Architecture and System Design

> These lessons are extracted by Ship after each piece of work.
> They capture what Paloma learned and how she evolved.
> When a lesson leads to a DNA change, it's marked as Applied.

---

### Lesson: Establish a single source of truth for rules
- **Context:** Before this work, the most correct rules lived in CLAUDE.md — a file that bridge-spawned pillars never see. base.js, phases.js, instructions.md, and CLAUDE.md all had overlapping rules that drifted. When rules changed in one place, they weren't updated everywhere.
- **Insight:** Having multiple files with the same rules creates a maintenance nightmare and guarantees drift. When the drift includes contradictions (file A says do X, file B says don't do X), the system behavior becomes unpredictable based on which file the session happened to prioritize.
- **Action:** Established a clear hierarchy: phases.js (pillar DNA, authoritative) → base.js (shared foundation) → instructions.md (project conventions) → CLAUDE.md (CLI pointer). Each file has a distinct role. Rules live in ONE place. CLAUDE.md no longer duplicates — it references. When a rule changes, it changes in the DNA and flows downward.
- **Applied:** YES — WU-3 started this (moved Flow content to phases.js), WU-4 will complete it (slim CLAUDE.md and instructions.md to remove duplication)
