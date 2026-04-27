# Lessons: Forge Workflow

> These lessons are extracted by Ship after each piece of work.
> They capture what Paloma learned and how she evolved.
> When a lesson leads to a DNA change, it's marked as Applied.

---

### Lesson: Forge MUST verify the build before declaring done
- **Context:** Forge session (flow-spawned-548) was dispatched to implement WU-1 self-improvement fixes. It rewrote three files with broken code: an invalid `<div>` between `</template>` and `<script>` in a Vue SFC, duplicate function declarations (compile error), a `let x = null` immediately followed by `const x = ...` (duplicate const), and empty stub implementations. It committed and reported "done" without ever running `npm run build`. The build was completely broken.
- **Insight:** A diff that looks correct can still be syntactically broken. Forge sessions are working in fresh context with no continuity — they don't know what "working" feels like. The build check is the only objective truth. `npm run build` either passes or it doesn't. Without it, Forge is guessing. With it, Forge has proof.
- **Action:** Added mandatory build verification as Step 1 of Forge's "When You're Done" checklist — before updating the plan, before summarizing. Also added a rule to `base.js` Code Conventions: "Code changes are not done until the build passes."
- **Applied:** YES — `src/prompts/phases.js` Forge section, `src/prompts/base.js` Code Conventions

### Lesson: "(Flow direct)" annotation means Flow handles it — never spawn Forge for it
- **Context:** The self-improve plan WU-1 was explicitly annotated "(Flow direct)" — indicating it was small enough for Flow to handle in-session. Despite this, Flow spawned a Forge pillar (flow-spawned-548) for it. Forge ran without the nuance and full context Flow had from reading the existing implementation, producing inferior and broken code that undid the working committed changes.
- **Insight:** The "(Flow direct)" annotation exists for tasks where spawning a fresh Forge context introduces more risk than benefit — small fixes, nuanced changes where the existing code pattern matters, or changes where the broader architectural understanding is essential. When this annotation is present, the correct move is always: do it yourself in Flow, verify the build, commit, push.
- **Action:** Added explicit rule to Flow's Orchestration Discipline section in `phases.js`: "(Flow direct) tasks stay in Flow. Do NOT spawn Forge."
- **Applied:** YES — `src/prompts/phases.js` Flow Orchestration Discipline section

### Lesson: Forge must own the plan update
- **Context:** Previous DNA said "You do NOT update the plan yourself. You build, you report, and suggest moving back to Flow or on to Polish." This made plan updates Flow's cleanup job, leading to drift between what was built and what the plan said.
- **Insight:** The plan is Forge's deliverable, not just code. When Forge finishes building, the plan should accurately reflect what was built — file paths, implementation decisions, deviations from the original design. If Flow has to update the plan later, Flow is guessing based on git diffs instead of knowing from direct experience. The builder should document the build.
- **Action:** Changed Forge's prompt to mandate plan updates: "When You're Done: (1) Update the plan. Mark the relevant phase/task as complete. Add Implementation Notes describing what was built, any deviations, and decisions made. (2) Summarize to Adam." The plan update is YOUR deliverable — not Flow's cleanup job.
- **Applied:** YES — WU-1 fixed the contradiction, WU-2 embedded it in Forge's identity

### Lesson: Flow can write Scout artifacts directly when Scout is skipped
- **Context:** On the dual-voice plan, Scout was never properly spawned. Flow wrote the scout findings doc (`.paloma/docs/scout-paloma-dual-voice-20260312.md`) directly as part of the Charter work.
- **Insight:** The pipeline artifact matters more than who produced it. Scout's job is to produce findings docs — but if the work is small enough or Adam wants to skip Scout, Flow can write the doc itself and the downstream pillars (Chart, Forge) will still have what they need. The file is the handoff, not the pillar.
- **Action:** When Flow needs to bypass Scout, write the findings doc yourself with the same format Scout would use. Name it `scout-{scope}-{slug}-{date}.md` in `.paloma/docs/`. The pipeline stays healthy because the artifact exists.
- **Applied:** N/A — awareness only. Pipeline is resilient to Scout being skipped when Flow writes the artifact.

### Lesson: Codex CLI prints auth status to stderr, not stdout
- **Context:** During WU-4 investigation, `codex login status` was run to check auth state. The output appeared empty on stdout. The actual status message ("Logged in as...") was on stderr.
- **Insight:** Some CLIs route status/diagnostic output to stderr even for informational (non-error) messages. This is a common pattern for CLI tools that follow Unix conventions strictly: stdout = data, stderr = everything else (status, warnings, progress). When a CLI check appears to return nothing, always capture stderr too. In the bridge, auth probes use `{ stdout: 'pipe', stderr: 'pipe' }` and must check both channels.
- **Action:** When probing CLI auth status in the bridge, always capture both stdout and stderr. Check the combined output, not just stdout. Pattern: `const output = (stdout + stderr).trim()`. If auth check appears to fail silently, the answer is probably on stderr.
- **Applied:** YES — `bridge/codex-cli.js` auth probe updated to check stderr (WU-4)
