# Locode v0.3 — Coding Agent Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Depends on:** v0.2 (tool registry, executor, safety gate, 6 tools)
**Minimum context window:** 4096 tokens (local LLM `num_ctx` setting)
**Source:** `docs/plans/2026-03-10-v03-coding-agent.md`

---

## Goal

Turn Locode from a chat router into a coding agent that can analyze code, plan changes, apply structured edits, validate results, and present diffs — optimized for local LLMs on laptops.

---

## Design Principles

1. **Plan before edit** — generate an edit plan, then apply structured changes (never rewrite whole files)
2. **Tools before reasoning** — use deterministic systems (ripgrep, file reads, git) before LLM thinking
3. **Structured output only** — LLMs produce JSON edit operations, not free-form code blocks
4. **Session memory** — track recent files, edits, and commands to avoid redundant retrieval
5. **Diff-first display** — show unified diffs, not full files, for every code change
6. **Stream everything** — stream reasoning steps and tool calls for responsive CLI UX

---

## Implementation Phases

### Phase A: CodeEditor + DiffRenderer

Pure file-editing utilities with no LLM dependency.

**Prerequisite:** Add a `search_code` tool to the v0.2 tool registry. The ANALYZE phase needs structured search results (`{ file, line, match }`), which the raw `run_command` tool cannot provide. This is a small addition to `src/tools/definitions/` before Phase A begins.

**New files:**
- `src/editor/types.ts`
- `src/editor/code-editor.ts` + `code-editor.test.ts`
- `src/editor/diff-renderer.ts` + `diff-renderer.test.ts`

**Interfaces:**

```typescript
// src/editor/types.ts

export interface EditOperation {
  file: string
  operation: 'insert' | 'replace' | 'delete' | 'create'
  // Search-based addressing (preferred — LLMs are bad at line counting)
  search?: string             // find content match in file (must be unique)
  // Line-based addressing (fallback)
  afterLine?: number          // for insert (0 = beginning of file)
  startLine?: number          // for replace/delete
  endLine?: number            // for replace/delete
  content?: string            // new code (for insert/replace/create)
}

// Search field semantics per operation type:
//   insert:  insert `content` AFTER the line containing `search` match
//   replace: replace `search` match with `content`
//   delete:  delete the line(s) containing `search` match
//   create:  `search` is ignored (creates new file with `content`)
//
// If `search` matches multiple locations → error (must be unique, same as edit_file tool).
// If both `search` and line fields are set → `search` takes precedence.

export interface ApplyResult {
  applied: EditOperation[]
  failed: Array<{ edit: EditOperation; error: string }>
  originals: Map<string, string>  // original file contents for rollback
}

export interface DiffPreview {
  file: string
  diff: string
  additions: number
  deletions: number
}
```

```typescript
// src/editor/code-editor.ts

export class CodeEditor {
  async applyEdits(edits: EditOperation[]): Promise<ApplyResult>
  async rollback(result: ApplyResult): Promise<void>
  async preview(edits: EditOperation[]): Promise<DiffPreview[]>
}
```

```typescript
// src/editor/diff-renderer.ts

export class DiffRenderer {
  static unifiedDiff(file: string, original: string, modified: string): string
  static colorize(diff: string): string
  static summary(diffs: DiffPreview[]): string
}
```

**Design decisions:**
- Search-based matching is preferred over line numbers. Local LLMs produce unreliable line counts but can match text patterns well.
- Both modes supported — search-first, line numbers as fallback.
- `applyEdits()` stores originals for rollback before writing anything.
- `preview()` is a dry-run: computes diffs without touching the filesystem.
- `CodeEditor` validates write paths against `SafetyGate.allowed_write_paths` before applying edits. It receives a `SafetyGate` reference in its constructor — does NOT bypass the safety system.

**Dependency:** `diff` npm package (pure JS, lightweight) for unified diff generation.

---

### Phase B: AgentMemory

Session-scoped memory for tracking agent activity.

**New files:**
- `src/coding/types.ts`
- `src/coding/memory.ts` + `memory.test.ts`

Note: uses `src/coding/` (not `src/agent/`) to avoid confusion with the existing `src/agents/` directory which contains LLM agent clients.

**Interfaces:**

```typescript
// src/coding/memory.ts

export interface MemoryEntry {
  timestamp: number
  type: 'file_read' | 'file_write' | 'search' | 'command' | 'edit' | 'error'
  detail: string
  result?: string  // truncated
}

export interface MemorySnapshot {
  recentFiles: string[]
  recentEdits: EditOperation[]
  recentCommands: string[]
  recentErrors: string[]
  sessionStart: number
}

export class AgentMemory {
  private entries: MemoryEntry[] = []
  private maxEntries: number = 50

  record(entry: Omit<MemoryEntry, 'timestamp'>): void
  getSnapshot(): MemorySnapshot
  getRecentFiles(n?: number): string[]
  toPromptContext(): string  // compact summary for LLM prompts (~500 tokens max)
  clear(): void
}
```

**Design decisions:**
- No persistence — lives only for the session, resets on exit.
- Capped at 50 entries (FIFO eviction).
- `toPromptContext()` produces a compact string (recently touched files, last few edits, errors) that fits within local LLM token budgets.

---

### Phase C: Planner + CodingAgent Loop

The core agent runtime — LLM-driven analyze→plan→execute→validate→present cycle.

**New files:**
- `src/coding/planner.ts` + `planner.test.ts`
- `src/coding/coding-agent.ts` + `coding-agent.test.ts`

**Planner:**

```typescript
// src/coding/planner.ts

export interface EditPlan {
  description: string
  steps: EditStep[]
  estimatedFiles: string[]
}

export interface EditStep {
  description: string
  file: string
  operation: 'insert' | 'replace' | 'delete' | 'create'
  search?: string             // content match to locate the edit target
  reasoning: string
}

export interface GatheredContext {
  files: Array<{ path: string; content: string; relevance: string }>
  searchResults: Array<{ file: string; line: number; match: string }>
  gitContext?: string
  memory: MemorySnapshot
}

export class Planner {
  constructor(
    private localAgent: LocalAgent,
    private claudeAgent: ClaudeAgent | null,
  ) {}

  async generatePlan(
    prompt: string,
    context: GatheredContext,
    agent: 'local' | 'claude',
  ): Promise<EditPlan>

  async refinePlan(
    plan: EditPlan,
    errors: string[],   // from ApplyResult.failed[].error + EditValidationResult.output
    agent: 'local' | 'claude',
  ): Promise<EditPlan>
}

// JSON parsing fallback: if LLM produces malformed JSON for EditPlan,
// Planner attempts extraction with regex (same approach as LocalAgent's
// parseTextToolCalls). On total failure, returns a single-step plan
// asking the LLM to retry with simpler output.
```

**CodingAgent loop:**

```typescript
// src/coding/coding-agent.ts

export type AgentPhase = 'analyze' | 'plan' | 'execute' | 'validate' | 'present'

// Named EditValidationResult to avoid collision with ToolRegistry's ValidationResult
export interface EditValidationResult {
  passed: boolean
  output: string              // stdout/stderr from validation command
  command: string             // the command that was run
}

export interface AgentState {
  phase: AgentPhase
  prompt: string
  plan: EditPlan | null
  editsApplied: EditOperation[]
  validationResult: EditValidationResult | null
  iteration: number
  maxIterations: number
}

export interface AgentConfig {
  max_iterations: number      // max plan→execute→validate cycles (default: 5)
  auto_confirm: boolean       // skip user confirmation for edits (default: false)
  show_plan: boolean          // display plan before executing (default: true)
  run_validation: boolean     // run tests/lint after edits (default: true)
  validation_command?: string // e.g., "npm test". If undefined and run_validation=true, validation is skipped (no auto-detection).
}

export interface AgentRunResult {
  success: boolean
  edits: EditOperation[]
  diffs: string[]
  validationPassed: boolean | null  // null if validation was skipped
  iterations: number
  tokensUsed: { input: number; output: number }
  agent: 'local' | 'claude'        // whichever agent handled PLAN+EXECUTE (no hybrid — one agent per run)
}

export class CodingAgent {
  constructor(
    private localAgent: LocalAgent,
    private claudeAgent: ClaudeAgent | null,
    private toolExecutor: ToolExecutor,
    private codeEditor: CodeEditor,
    private planner: Planner,
    private memory: AgentMemory,
    private config: AgentConfig,
  ) {}

  async run(prompt: string): Promise<AgentRunResult>
  on(event: 'stream', handler: (data: StreamEvent) => void): void
}
```

**Agent phases:**

| Phase | What happens | Model |
|---|---|---|
| ANALYZE | Gather context via tools (read_file, search_code, git_query). LLM generates tool calls; CodingAgent executes them via ToolExecutor. Check memory first to skip known files. Hard limit: max 5 files, truncated to 2000 tokens/file. | Local (small action space) |
| PLAN | Planner generates JSON EditPlan from context + memory. No code gen. | Local (≤2 files, ≤3 steps) or Claude (larger) |
| EXECUTE | Each plan step → LLM generates EditOperation → CodeEditor applies. Preview diffs first. | Follows PLAN routing |
| VALIDATE | Run validation command. No LLM. On failure, loop to PLAN (up to max_iterations). | None (deterministic) |
| PRESENT | DiffRenderer shows colored diffs + summary. User confirms. | None (deterministic) |

**Auto-escalation rule:** If the plan has >2 unique files or >3 steps, route PLAN+EXECUTE to Claude.

**Coding task detection:** Internal regex matching on coding verbs (add, fix, implement, refactor, change, update, modify, create, write, delete, remove). Not user-configurable — kept simple. Patterns refined to reduce false positives (e.g. exclude "explain/describe" prefixes).

**Classification precedence:** `isCodingTask()` runs first. If it matches, the prompt goes to `CodingAgent` which internally uses the existing `Router.classify()` result to decide local vs Claude for PLAN+EXECUTE. If `isCodingTask()` does not match, the prompt goes through the existing chat dispatch path as before.

**Integration with Orchestrator:**

```typescript
// Modified orchestrator.process()
if (this.isCodingTask(prompt)) {
  return this.runCodingAgent(prompt, route)  // route still used for local/claude decision
}
// else: existing chat dispatch
```

**Rollback policy:**
- If an edit in the EXECUTE phase fails to apply, all previously applied edits in that iteration are rolled back via `CodeEditor.rollback()`. The filesystem returns to its pre-EXECUTE state before looping back to PLAN.
- If validation fails (VALIDATE phase), edits are NOT rolled back. Instead, the agent loops to PLAN with the validation errors — the refinement plan can build on the existing edits.
- If `max_iterations` is exhausted with validation still failing, all edits across all iterations are rolled back and the user is informed.
- User can always reject edits in the PRESENT phase, which triggers a full rollback.

---

### Phase D: Streaming UX + REPL Integration

Event-based streaming for real-time CLI feedback.

**New files:**
- `src/coding/stream.ts` + `stream.test.ts`

**Interfaces:**

```typescript
// src/coding/stream.ts

export type StreamEvent =
  | { type: 'phase'; phase: AgentPhase; detail: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; success: boolean; summary: string }
  | { type: 'plan'; plan: EditPlan }
  | { type: 'diff'; file: string; diff: string }
  | { type: 'validation'; passed: boolean; output: string }
  | { type: 'error'; message: string }
  | { type: 'done'; result: AgentRunResult }

export class AgentStream extends EventEmitter {
  emit(event: 'stream', data: StreamEvent): boolean
  on(event: 'stream', handler: (data: StreamEvent) => void): this
}

export class StreamRenderer {
  constructor(private stream: AgentStream) {}
  start(): void
  stop(): void
}
```

**REPL changes:**
- Coding tasks: create `StreamRenderer`, start it, await result, stop it
- Non-coding tasks: existing chat behavior unchanged

**Config additions to schema + locode.yaml:**

```yaml
agent:
  max_iterations: 5
  auto_confirm: false
  show_plan: true
  run_validation: true
  # validation_command: "npm test"

editor:
  show_diff: true
  color_diff: true
  backup_before_edit: true
```

---

## New Files Summary

```
src/
├── tools/definitions/
│   └── search-code.ts + test       # Prerequisite
├── coding/
│   ├── types.ts                    # Phase B
│   ├── memory.ts + test            # Phase B
│   ├── planner.ts + test           # Phase C
│   ├── coding-agent.ts + test      # Phase C
│   └── stream.ts + test            # Phase D
├── editor/
│   ├── types.ts                    # Phase A
│   ├── code-editor.ts + test       # Phase A
│   └── diff-renderer.ts + test     # Phase A
```

**16 new files** (including tests). **4 modified** (orchestrator.ts, repl.ts, config/schema.ts, locode.yaml).

---

## New Dependency

| Package | Purpose | Type |
|---|---|---|
| `diff` | Generate unified diffs | Pure JS, lightweight |

---

## Performance Budget

**Minimum requirement:** 4096-token context window (`num_ctx` in Ollama config). Models with 2048 tokens are too small for the PLAN phase — the agent will warn and suggest increasing `num_ctx` or routing to Claude.

| Phase | Max Prompt Tokens | Strategy |
|---|---|---|
| ANALYZE | ~500 | Short system prompt + request + tool list |
| PLAN | ~1500 | Request + truncated files + memory summary |
| EXECUTE | ~1000 | Plan step + target file section only |

**Degradation:** If context is too tight for PLAN (detected via truncation or repeated malformed JSON), auto-escalate to Claude for that run. Log a warning suggesting the user increase `num_ctx`.

Techniques: parallel tool execution in ANALYZE, JSON mode for constrained generation (with regex fallback for malformed output), memory-based context reuse, early termination (0 steps → skip), streaming for perceived latency.

---

## Success Criteria

- [ ] Agent completes single-file edits using only local LLM
- [ ] Agent auto-escalates multi-file changes to Claude
- [ ] Diffs display correctly with colors in terminal
- [ ] Agent memory prevents re-reading recently accessed files
- [ ] Validation failures trigger plan refinement (up to max_iterations)
- [ ] Streaming output shows phase progression in real time
- [ ] All existing tests pass + new module tests pass
- [ ] `npm run build` succeeds
