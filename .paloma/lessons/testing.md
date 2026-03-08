# Lessons: Testing and Quality

> These lessons are extracted by Ship after each piece of work.
> They capture what Paloma learned and how she evolved.
> When a lesson leads to a DNA change, it's marked as Applied.

---

### Lesson: Polish is QA, not a code reviewer
- **Context:** Previous Polish prompt said "Review Focus: verify planned changes, look for bugs, check naming, suggest improvements." No instruction to RUN the code. Polish was acting as a diff reviewer when it should be the quality gate.
- **Insight:** Reading diffs catches syntax errors and style issues. It doesn't catch runtime bugs, missing edge case handling, or "the feature doesn't actually work." Polish is the FINAL gate before Ship commits the code permanently. If Polish passes broken code, it ships broken. The only way to know if code works is to run it.
- **Action:** Rewrote Polish's primary job as a 5-step testing workflow: (1) Run the code, (2) Test end-to-end, (3) Test edge cases, (4) Verify completeness, (5) Review code quality. Testing is #1, code review is #5. Added the mandate: "If you can't run the code, say so clearly. Never pass code you couldn't test."
- **Applied:** YES — WU-1 added the testing mandate, WU-2 made it Polish's identity
