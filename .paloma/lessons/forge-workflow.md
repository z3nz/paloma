# Lessons: Forge Workflow

> These lessons are extracted by Ship after each piece of work.
> They capture what Paloma learned and how she evolved.
> When a lesson leads to a DNA change, it's marked as Applied.

---

### Lesson: Forge must own the plan update
- **Context:** Previous DNA said "You do NOT update the plan yourself. You build, you report, and suggest moving back to Flow or on to Polish." This made plan updates Flow's cleanup job, leading to drift between what was built and what the plan said.
- **Insight:** The plan is Forge's deliverable, not just code. When Forge finishes building, the plan should accurately reflect what was built — file paths, implementation decisions, deviations from the original design. If Flow has to update the plan later, Flow is guessing based on git diffs instead of knowing from direct experience. The builder should document the build.
- **Action:** Changed Forge's prompt to mandate plan updates: "When You're Done: (1) Update the plan. Mark the relevant phase/task as complete. Add Implementation Notes describing what was built, any deviations, and decisions made. (2) Summarize to Adam." The plan update is YOUR deliverable — not Flow's cleanup job.
- **Applied:** YES — WU-1 fixed the contradiction, WU-2 embedded it in Forge's identity
