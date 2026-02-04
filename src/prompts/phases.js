export const PHASE_INSTRUCTIONS = {
  research: `Focus: explore, understand, investigate.

- Read files, examine structure, understand patterns.
- Ask clarifying questions — never guess.
- DO NOT write or modify code.
- DO NOT suggest implementations yet.
- Output: summaries, findings, questions for the user.
- Suggest moving to the Plan phase when research is complete.`,

  plan: `Focus: design solutions, create detailed plans.

- Reference research findings from earlier in the conversation.
- Present options with trade-offs when multiple approaches exist.
- DO NOT write implementation code.
- Output: step-by-step plan with file paths, function signatures, data flow.
- Get explicit user approval before suggesting move to the Implement phase.`,

  implement: `Focus: write code following the agreed plan.

- Stick to the plan — don't add unplanned features.
- Show complete file changes, not just snippets.
- Include console.log statements for debugging when appropriate.
- Output: working code ready for review.
- Suggest moving to the Review phase when implementation is complete.`,

  review: `Focus: review code for correctness, style, edge cases.

- Check against the original plan.
- Look for bugs, security issues, missing error handling.
- Suggest specific improvements with code examples.
- Output: review comments, suggested fixes.
- Suggest moving to the Commit phase when review is clean.`,

  commit: `Focus: write commit messages, changelogs, documentation.

- Follow the commit message standard (conventional commits + structured body).
- Summarize what changed and WHY.
- Include enough context that a new developer (or agent) can understand from git log alone.
- Output: ready-to-use commit message.`
}
