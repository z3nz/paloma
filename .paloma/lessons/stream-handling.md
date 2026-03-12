# Lessons: Stream Handling and Event Pipeline

> These lessons are extracted by Ship after each piece of work.
> They capture what Paloma learned and how she evolved.
> When a lesson leads to a DNA change, it's marked as Applied.

---

### Lesson: Every new stream consumer must handle ALL event types — not just text
- **Context:** The email stream handler in `useMCP.js` was written as a naive text accumulator when email sessions were first added. It only processed `assistant`/`content_block_delta` events with text content, silently discarding tool_use, tool_result, usage, and model data. This made email chats second-class citizens — no tool activity, no token counts, wrong model badge in the sidebar. The fix required adding ~90 lines to `onEmailStream` and `onEmailDone`.
- **Insight:** The Claude CLI event stream emits at least 6 distinct event types that consumers need to handle: `assistant` (text + tool_use blocks), `content_block_start` (tool_use), `content_block_delta` (text_delta, input_json_delta), `user` (tool_result blocks), `result` (usage + done), and `content_block_stop`. A handler that only processes text is NOT a stream handler — it's a text scraper. Every new stream consumer should be written against the FULL event matrix from the start. The reference implementation is `src/composables/useCliChat.js` — `runCliChat()`'s event processing loop is the gold standard.
- **Action:** When adding any new stream consumer (email, pillar variant, notification, webhook), start with `useCliChat.js`'s event handler as the template. Copy the full event matrix. Mark what you're intentionally skipping (e.g., "interrupted handling N/A for email sessions") versus accidentally missing. Never ship a consumer that only handles the happy-path text events.
- **Applied:** YES — `onEmailStream` in `useMCP.js` now handles all event types, matching `runCliChat` patterns

---

### Lesson: When UI doesn't show data, check the data pipeline first — not the components
- **Context:** Email chats showed no tool activity, no token counts, and wrong model badges. The natural instinct was to look at the rendering components (MessageItem, ToolCallGroup, TopBar). Every component was fine — they all rendered correctly for regular chats. The problem was entirely upstream: the data was never populated in the first place.
- **Insight:** UI components that work for one data path and not another are almost always innocent. If `ToolCallGroup` renders tool calls for regular chats but not email chats, the component is not the bug — the data pipeline feeding email chats is. Diagnosis pattern: (1) Check what the component REQUIRES to render (e.g., `message.toolActivity`, `message.usage`). (2) Check whether those fields exist on the actual data (IndexedDB records, state maps). (3) Trace backward from the missing field to the handler that should populate it. The component is the last place to look.
- **Action:** When a UI element works in one context but not another, open the database (IndexedDB DevTools) and compare the actual stored records. If the records are missing fields, the bug is in the data pipeline. Only look at components if the records have the data but the UI doesn't show it.
- **Applied:** N/A — awareness only; no code change needed

---

### Lesson: Hardcoded model values in event handlers are silent lies
- **Context:** Two places in `useMCP.js` hardcoded `'claude-cli:sonnet'` for email sessions — `onEmailReceived` (session creation) and `onEmailDone` (message save). The email watcher (`bridge/email-watcher.js`) actually spawns with `model: 'opus'`. This meant every email session was stored with the wrong model, causing wrong sidebar labels, wrong context limit calculations, and wrong cost estimates.
- **Insight:** Hardcoded model strings in event handlers create a maintenance trap. They're wrong on day one if they don't match the spawner, and they drift silently as the spawner changes. The correct pattern: (1) Have the spawner broadcast the model it used as part of the event metadata. (2) The consumer reads the model from the event, not from a constant. For email sessions specifically, `bridge/email-watcher.js` should include `model: 'claude-cli:opus'` in its broadcast payload so `onEmailReceived` can store it correctly rather than guessing.
- **Action:** Never hardcode model strings in event consumers. Either (a) receive model from the event payload (preferred), or (b) import and reference a shared constant that matches the spawner. If you see a hardcoded model string like `'claude-cli:sonnet'` in a handler, treat it as a bug until proven otherwise.
- **Applied:** YES — both hardcoded `'claude-cli:sonnet'` values changed to `'claude-cli:opus'` to match the email watcher's actual spawn model. Full fix (passing model in broadcast payload) left as follow-up.
