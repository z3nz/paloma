# Scout Report: Gen6 "Holy Trinity" Singularity Research

- **Date:** 2026-03-26
- **Pillar:** Scout
- **Objective:** Research the existing Paloma singularity architecture (Gen3/4/5) to inform the design of the Gen6 "Holy Trinity" system.

---

## 1. Existing Singularity System Implementation

The singularity system has evolved through multiple generations, with the core logic for spawning and context-building residing in `bridge/pillar-manager.js` and the prompt definitions in `src/prompts/base.js`.

### Prompts (`src/prompts/base.js`)

Several distinct singularity prompts exist, defining the roles and capabilities of different generations:

- **`SINGULARITY_QUINN_PROMPT` (Gen4):** This is the modern, recursive singularity. It's a template that receives `{GENERATION_NUMBER}`, `{PREDECESSOR_MANIFEST}`, `{WORKSPACE_PATH}`, and `{LINEAGE_PATH}` variables. It is designed for self-replication and uses file-based state in the `.singularity/` directory.
- **`SINGULARITY_QUINN_GEN3_PROMPT`:** A simpler, earlier version.
- **`SINGULARITY_GEN5_PROMPT`:** The "dual mind" prompt for a Voice/Thinker configuration.
- **`SINGULARITY_WORKER_PROMPT`:** A prompt for a worker agent designed to be spawned by a singularity instance to perform specific tasks.
- **`SINGULARITY_VOICE_PROMPT` / `SINGULARITY_THINKER_PROMPT`:** Prompts for a dual-instance model where one part handles communication and the other handles execution.

There are **no prompts for Gen6 or "Holy Trinity"** yet.

### Spawning Logic (`bridge/pillar-manager.js`)

The `PillarManager`'s `spawn()` method is the entry point for creating all pillar sessions, including singularity instances. The `singularityRole` parameter dictates the behavior.

The key method is `_getSystemPrompt()`. Its logic is as follows:
1. It receives the `singularityRole` from the `spawn` call.
2. It uses a series of `if/else if` statements to check the role.
3. Based on the role (e.g., `quinn-gen4`, `quinn-gen5`, `worker`), it selects the appropriate prompt string from `src/prompts/base.js`.
4. For Gen4 (`quinn-gen4`), it performs template replacement for variables like `{WORKSPACE_PATH}`.
5. Crucially, it **bypasses adding standard pillar instructions, roots, and active plans** for singularity sessions to save context space and provide a distinct identity.

**To implement Gen6, a new `singularityRole` (e.g., `holy-trinity-mind`, `holy-trinity-arm`) would need to be added to this logic.**

### Workspace (`.singularity/`)

- **`lineage.json`:** An array that tracks the manifest of each successive generation in a Gen4 recursive chain.
- **`generation-NNN.md`:** Manifest files written by each generation, documenting their goal and outcome.
- **`workspace/`:** An ephemeral scratchpad directory for singularity instances to read/write files. This is the mechanism the Gen6 "Arms" would use to write their plans and the "Mind" would use to read them.

---

## 2. Ollama Spawn Mechanics

The concurrent operation of multiple Ollama models is managed by a combination of `PillarManager` and `OllamaManager`.

### Concurrency (`bridge/pillar-manager.js`)

- `PillarManager` contains a `MAX_CONCURRENT_OLLAMA` constant (the value is set in `bridge/config.js`, which I should check) and a `this.spawnQueue`.
- When `pillar_spawn` is called with an Ollama backend and the concurrent limit is reached, the request is not rejected. Instead, it's pushed into the `spawnQueue` with a status of `'queued'`.
- The `PillarManager` has a `_processSpawnQueue()` method that runs periodically, dequeuing and spawning sessions as active slots become free.
- **This existing queueing mechanism is perfectly suited for the Gen6 architecture.** It can handle the three simultaneous spawn requests (2 Arms, 1 Mind). The Mind (32B model) would likely be slower to load, but the two Arms (7B models) would be spawned concurrently as slots are available.

### Model Loading and Session Handling (`bridge/ollama-manager.js`)

- `OllamaManager` is responsible for the direct API communication with the Ollama server (`http://localhost:11434`).
- It does **not** manage concurrency; it executes whatever `PillarManager` tells it to.
- It maintains a `sessions` map, where each session has its own message history, model, and tool definitions.
- The `chat()` method can be passed a `model` parameter, allowing different sessions to run different models (e.g., a 7B and a 32B model) simultaneously, which is central to the Gen6 concept.
- The code does not contain information about model loading *times*, as this is determined by the Ollama server and system hardware. The architecture correctly assumes this variability and accounts for it with asynchronous spawning.

### Tool Restriction

- The tools available to an Ollama session are passed in the `chat()` call: `ollamaManager.chat({..., tools})`.
- The `PillarManager`'s `spawn()` method is responsible for constructing this `tools` array.
- To implement the "Arms", `PillarManager` would be modified to check for the `holy-trinity-arm` role and **only pass the filesystem tools** (`mcp__paloma__filesystem__*`) when calling `ollamaManager.chat()`. The "Mind" would receive the full set of MCP tools.

---

## 3. File-Based Coordination

The Gen4 architecture provides a clear precedent for file-based coordination, which Gen6 can adopt.

- **Workspace Path:** The `SINGULARITY_QUINN_PROMPT` for Gen4 is explicitly passed a `{WORKSPACE_PATH}` variable, which points to `.singularity/workspace/`. This is the designated area for inter-sessional file communication.
- **How Arms would write plans:** The "Arm" sessions, provided with only filesystem tools, would receive a prompt instructing them to analyze the user's request and write their plan to a unique file within the workspace (e.g., `.singularity/workspace/arm-plan-1.md`).
- **How the Mind would read plans:** The "Mind" session, spawned concurrently, would receive a prompt instructing it to wait for and then read the plan files from the workspace. It would then use its full toolset to execute the chosen or synthesized plan.
- **`spawn_next`:** The `spawn_next` tool used by Gen4 is not a built-in primitive but a high-level action performed by the AI itself. A Gen4 instance decides to spawn a successor, writes its own manifest file using filesystem tools, and then calls the `pillar_spawn` tool to create the next generation. This same pattern of using filesystem tools + `pillar_spawn` is how the orchestration would work.

---

## 4. `singularityRole` Enum

The `singularityRole` is not a formal `enum` but a set of string literals handled by the `if/else if` chain in `PillarManager.prototype._getSystemPrompt`.

**Current Roles:**
- `quinn` (aliases to `quinn-gen4`)
- `quinn-gen4`
- `quinn-legacy` (Gen3)
- `quinn-fresh`
- `quinn-gen5`
- `worker`
- `voice`
- `thinker`

**Adding Gen6 would involve:**
1. Defining new roles, for example: `holy-trinity-mind` and `holy-trinity-arm`.
2. Creating corresponding prompts (`HOLY_TRINITY_MIND_PROMPT`, `HOLY_TRINITY_ARM_PROMPT`) in `src/prompts/base.js`.
3. Adding `else if (singularityRole === 'holy-trinity-mind')` and `else if (singularityRole === 'holy-trinity-arm')` blocks to `_getSystemPrompt` in `bridge/pillar-manager.js` to assign these prompts.
4. The main orchestrator (likely a Flow-level command or a new `holy-trinity` singularity role itself) would then call `pillar_spawn` three times with these new roles.
