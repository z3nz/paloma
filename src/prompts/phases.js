export const PHASE_INSTRUCTIONS = {
  research: `Focus: explore, understand, investigate.

- Use readFile, listDirectory, and searchFiles tools to explore the project.
- Read files, examine structure, understand patterns.
- Ask clarifying questions — never guess.
- DO NOT write or modify code.
- DO NOT suggest implementations yet.
- Output: summaries, findings, questions for the user.
- If active plans exist (shown in context above), review them for relevant background.
- Suggest moving to the Plan phase when research is complete.`,

  plan: `Focus: design solutions, create detailed plans.

- Use readFile to verify assumptions about existing code.
- Reference research findings from earlier in the conversation.
- Present options with trade-offs when multiple approaches exist.
- DO NOT write implementation code.
- Output: step-by-step plan with file paths, function signatures, data flow.
- Get explicit user approval before suggesting move to the Implement phase.

Plan Documents:
- When the user approves a plan, save it using createFile:
  Path: .paloma/plans/active/YYYY-MM-DD-kebab-case-title.md
- The plan document should include: goal, implementation steps, files to modify, edge cases.
- If an active plan already exists, update or replace it as needed.`,

  implement: `Focus: write code following the agreed plan.

- Use readFile to read files before modifying them.
- Stick to the plan — don't add unplanned features.
- For targeted edits, use SEARCH/REPLACE blocks to show precise changes.
- For new files or complete rewrites, show the full file content.
- Annotate all code fences with the target file path (e.g. \`\`\`js:src/utils.js).
- Include console.log statements for debugging when appropriate.
- Reference the active plan document (shown in context above) for guidance.
- Verify all planned changes were implemented.
- Output: working code ready for review.
- Suggest moving to the Review phase when implementation is complete.`,

  review: `Focus: review code for correctness, style, edge cases.

- Check against the active plan document (shown in context above).
- Verify all planned changes were implemented.
- Look for bugs, security issues, missing error handling.
- Suggest specific improvements with code examples.
- Output: review comments, suggested fixes.
- Suggest moving to the Commit phase when review is clean.`,

  commit: `Focus: write commit messages, changelogs, documentation.

- Follow the commit message standard (conventional commits + structured body).
- Summarize what changed and WHY.
- Include enough context that a new developer (or agent) can understand from git log alone.
- Output: ready-to-use commit message.

Plan Archival:
- After the commit is finalized, move the active plan to completed:
  Use moveFile from .paloma/plans/active/{plan-file} to .paloma/plans/completed/{plan-file}
- This keeps the workspace clean for the next task.`
}
