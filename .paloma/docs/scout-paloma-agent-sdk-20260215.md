# Scout Research: Claude Agent SDK

**Date:** 2026-02-15  
**Scope:** Paloma sub-agent orchestration foundation  
**Package:** `@anthropic-ai/claude-agent-sdk` v0.2.42  
**Purpose:** Research the Agent SDK API for Phase 1 implementation (replacing CLI subprocess with SDK `query()`)

---

## Executive Summary

The Claude Agent SDK provides a programmatic API to interact with Claude using the same infrastructure that powers Claude Code. It offers:
- **Primary API:** `query()` function returning an AsyncIterable of `SDKMessage` events
- **Built-in tools:** Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task (subagents), etc.
- **MCP integration:** Native support for stdio, SSE, and HTTP MCP servers
- **Streaming:** Real-time event streaming with partial messages
- **Session management:** Resume sessions via `session_id`
- **Tool execution:** SDK handles the entire agent loop (tool calls, results, retries)

This replaces our current CLI subprocess approach with a cleaner, programmatic API while maintaining the same capabilities.

---

## Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

**Current Version:** 0.2.42 (as of 2026-02-15)

**Peer Dependencies:**
- `zod` ^4.0.0 (for tool schemas and structured output)
- Node.js 18+ required

**Environment:**
```bash
export ANTHROPIC_API_KEY=your-api-key
```

---

## Core API: `query()`

### Function Signature

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

function query(config: {
  prompt: string;
  options?: Options;
}): Query;

interface Query extends AsyncGenerator<SDKMessage, void> {
  // Control methods
  interrupt(): Promise<void>;
  
  // File management
  rewindFiles(userMessageUuid: string): Promise<void>;
  
  // Runtime configuration
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  
  // Introspection
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  accountInfo(): Promise<AccountInfo>;
}
```

### Basic Usage

```typescript
for await (const message of query({
  prompt: 'Find and fix bugs in auth.py',
  options: {
    allowedTools: ['Read', 'Edit', 'Bash'],
  },
})) {
  console.log(message);
}
```

---

## Options Interface

```typescript
interface Options {
  // Core Configuration
  abortController?: AbortController;
  additionalDirectories?: string[];
  cwd?: string;

  // Tools & Permissions
  allowedTools?: string[];
  disallowedTools?: string[];
  canUseTool?: CanUseTool;
  permissionMode?: PermissionMode;
  allowDangerouslySkipPermissions?: boolean;

  // Model Configuration
  model?: string; // e.g., 'claude-opus-4-6', 'claude-sonnet-4-5-20250929'
  fallbackModel?: string;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;

  // Settings Sources (filesystem-based config)
  settingSources?: SettingSource[]; // 'user' | 'project' | 'local'

  // System Prompt
  systemPrompt?: string | { 
    type: 'preset'; 
    preset: 'claude_code'; 
    append?: string 
  };

  // MCP & Plugins
  mcpServers?: Record<string, McpServerConfig>;
  plugins?: SdkPluginConfig[];

  // Subagents
  agents?: Record<string, AgentDefinition>;

  // Hooks
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;

  // Advanced Options
  betas?: SdkBeta[];
  continue?: boolean;
  enableFileCheckpointing?: boolean;
  env?: Record<string, string>;
  executable?: 'bun' | 'deno' | 'node';
  forkSession?: boolean;
  includePartialMessages?: boolean;
  maxTurns?: number;
  outputFormat?: { type: 'json_schema'; schema: JSONSchema };
  resume?: string; // Resume session by session_id
  resumeSessionAt?: string;
  sandbox?: SandboxSettings;
  stderr?: (data: string) => void;
  strictMcpConfig?: boolean;
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
}
```

---

## Message Types (Events)

The `query()` function yields an `AsyncIterable<SDKMessage>`. All possible message types:

```typescript
type SDKMessage =
  | SDKAssistantMessage        // Claude's response (complete)
  | SDKUserMessage             // User input (echoed back)
  | SDKUserMessageReplay       // Replayed user message (resume)
  | SDKResultMessage           // Final result (success/error)
  | SDKSystemMessage           // System initialization
  | SDKPartialAssistantMessage // Streaming partial (real-time)
  | SDKCompactBoundaryMessage; // Context compaction marker
```

### SDKAssistantMessage (Complete Response)

```typescript
type SDKAssistantMessage = {
  type: 'assistant';
  uuid: UUID;
  session_id: string;
  message: APIAssistantMessage; // From @anthropic-ai/sdk
  parent_tool_use_id: string | null; // For subagent attribution
};
```

### SDKPartialAssistantMessage (Streaming)

```typescript
type SDKPartialAssistantMessage = {
  type: 'partial_assistant';
  uuid: UUID;
  session_id: string;
  delta: {
    type: 'content_block_delta';
    index: number;
    delta: { type: 'text_delta'; text: string };
  } | {
    type: 'content_block_start';
    index: number;
    content_block: ContentBlock;
  } | {
    type: 'content_block_stop';
    index: number;
  };
};
```

### SDKResultMessage (Final Outcome)

```typescript
type SDKResultMessage = {
  type: 'result';
  subtype: 'success' | 'error_*';
  session_id: string;
  duration_ms: number;
  is_error: boolean;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage: NonNullableUsage;
};
```

---

## MCP Integration

### MCP Server Configuration

```typescript
type McpServerConfig =
  | McpStdioServerConfig        // Command-based (subprocess)
  | McpSSEServerConfig          // SSE transport (HTTP streaming)
  | McpHttpServerConfig;        // HTTP transport

// SSE (for remote servers — matches our proxy!)
type McpSSEServerConfig = {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
};
```

**CRITICAL INSIGHT for Paloma:** Our current MCP proxy server already speaks SSE! We can pass it directly to the Agent SDK via `mcpServers` option pointing to `http://localhost:19192/sse`.

### Subagents

```typescript
type AgentDefinition = {
  description: string;
  tools?: string[];
  prompt: string;
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
};
```

---

## Permission Modes

```typescript
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
```

---

## Session Management

Sessions are identified by `session_id` (returned in all messages). Resume with `options.resume = sessionId`.

---

## Key Insights for Paloma

1. Our MCP proxy (port 19192) can be used directly via `mcpServers.sse` config
2. SDK handles the full agent loop internally — we normalize events on output
3. `includePartialMessages: true` is critical for real-time streaming
4. `allowDangerouslySkipPermissions: true` is safe because our MCP proxy gates tool execution
5. System prompt can use `preset: 'claude_code'` with `append` for identity injection
6. Session resume works via `session_id` — same pattern as CLI path

---

## References

- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript API Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [NPM Package](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)

---

**Scout Signature:** Research complete. Ready for Chart phase to design the implementation architecture.
