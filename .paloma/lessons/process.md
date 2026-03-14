# Lessons: Workflow and Process

> These lessons are extracted by Ship after each piece of work.
> They capture what Paloma learned and how she evolved.
> When a lesson leads to a DNA change, it's marked as Applied.

---

### Lesson: The Pillar Completion Rule prevents half-finished work
- **Context:** The most important lifecycle rule (Forge → Polish → Ship, every time) existed in CLAUDE.md and instructions.md but NOT in base.js or phases.js. Bridge-spawned pillars only saw it buried in instructions.md, easy to miss.
- **Insight:** Critical lifecycle rules belong in the DNA where every pillar sees them at the top of their context. The Pillar Completion Rule is non-negotiable — when a pillar is spawned, the pipeline completes. If the rule isn't in the DNA, pillars can skip steps or Flow can break the rule without realizing it's a rule at all.
- **Action:** Embedded the Pillar Completion Rule in base.js under "Flow — The Head Mind" section and added "The Pillar Pipeline" shared section so every pillar understands the flow. Also added it to Flow's phase prompt under Orchestration Discipline with enforcement guidance.
- **Applied:** YES — WU-1 embedded the rule in base.js, WU-2 added it to Flow's identity, WU-3 added "The Pillar Pipeline" shared section

---

### Lesson: Commit plan files as a separate early commit — don't leave them untracked
- **Context:** The email auto-response timeout system was fully implemented and committed (`f145c29`) but the plan file and scout doc were left untracked until Ship. Ship arrived to find the code already merged (even through a merge conflict resolution) but the artifacts floating.
- **Insight:** Plan files and scout docs should be committed in their own commit *before* the code commit, or *alongside* the first Forge commit at the latest. Leaving them untracked means: (a) they're invisible to git log searches, (b) they can't be recovered if the working tree is cleaned, (c) Ship has to do cleanup that should have happened at Forge or Polish. The workflow rule already says "commit plan changes separately and early" — this is a reminder it's non-negotiable, not advisory.
- **Action:** Awareness only — the rule is already in `instructions.md`. When Forge sees a plan file that isn't committed, commit it before touching any code.
- **Applied:** N/A — awareness only (rule already documented)
