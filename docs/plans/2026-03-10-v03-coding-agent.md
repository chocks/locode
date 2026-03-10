# Locode v0.3 — Coding Agent

**Date:** 2026-03-10
**Status:** Proposed
**Scope:** Cursor-style agent loop with structured edits, diff output, agent memory, and streaming UX
**Depends on:** v0.2 (tool foundation — registry, executor, safety gate)

---

## 1. Goal

Turn Locode from a chat router into a **coding agent** that can analyze code, plan changes, apply structured edits, validate results, and present diffs — all optimized for local LLMs on laptops.

---

## 2. Design Principles

1. **Plan before edit** — generate an edit plan, then apply structured changes (never rewrite whole files)
2. **Tools before reasoning** — use deterministic systems (ripgrep, file reads, git) before LLM thinking
3. **Structured output only** — LLMs produce JSON edit operations, not free-form code blocks
4. **Session memory** — track recent files, edits, and commands to avoid redundant retrieval
5. **Diff-first display** — show unified diffs, not full files, for every code change
6. **Stream everything** — stream reasoning steps and tool calls for responsive CLI UX

---

## 3. Architecture

```
User Request (CLI)
    │
    ▼
┌────────────────────┐
│   Router            │ ← existing: regex + LLM classification
│   (router.ts)       │
└────────┬───────────┘
         │
         ├── non-coding task → existing LocalAgent/ClaudeAgent chat
         │
         └── coding task ──▼
                           │
┌──────────────────────────┴──────────────────────┐
│                   CODING AGENT                    │
│                                                   │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │ ANALYZE  │──►│  PLAN    │──►│ EXECUTE  │    │
│  │          │   │          │   │          │    │
│  │ • search │   │ • gen    │   │ • apply  │    │
│  │ • read   │   │   edit   │   │   edits  │    │
│  │ • git    │   │   plan   │   │ • record │    │
│  │ • memory │   │ • show   │   │   memory │    │
│  └──────────┘   │   user   │   └────┬─────┘    │
│                 └──────────┘        │          │
│                      ▲              ▼          │
│                      │         ┌──────────┐    │
│                      │         │ VALIDATE │    │
│                      └─────────│          │    │
│                   (on failure) │ • run    │    │
│                                │   tests  │    │
│                                └────┬─────┘    │
│                                     │          │
│                                     ▼          │
│                                ┌──────────┐    │
│                                │ PRESENT  │    │
│                                │          │    │
│                                │ • diffs  │    │
│                                │ • confirm│    │
│                                └──────────┘    │
│                                                   │
│  ┌─────────────────────────────────────────┐    │
│  │ Agent Memory (session-level)             │    │
│  │ recent files • edits • commands • errors │    │
│  └─────────────────────────────────────────┘    │
│                                                   │
│  Uses: ToolExecutor (from v0.2)                  │
│        CodeEditor + DiffRenderer (NEW)           │
└──────────────────────────────────────────────────┘
```

---

## 4. New Files

```
src/
├── agent/                          # NEW — coding agent runtime
│   ├── coding-agent.ts            # Agent loop: analyze→plan→execute→validate→present
│   ├── coding-agent.test.ts
│   ├── planner.ts                 # Edit plan generation from LLM
│   ├── planner.test.ts
│   ├── memory.ts                  # Session memory
│   ├── memory.test.ts
│   ├── stream.ts                  # Streaming output events + CLI renderer
│   ├── stream.test.ts
│   └── types.ts                   # Shared interfaces
├── editor/                         # NEW — structured code editing
│   ├── code-editor.ts             # Apply edit operations to files
│   ├── code-editor.test.ts
│   ├── diff-renderer.ts           # Generate + colorize unified diffs
│   ├── diff-renderer.test.ts
│   └── types.ts                   # EditOperation, ApplyResult, etc.
├── tools/definitions/              # NEW tools (added to v0.2 registry)
│   ├── apply-edit.ts              # Apply structured edit operation
│   └── git-mutate.ts              # Git write ops (commit, branch)
```

**New files: 14** (including tests). **Modified: 4** (orchestrator.ts, repl.ts, config/schema.ts, locode.yaml).

---

## 5. TypeScript Interfaces

### 5.1 Coding Agent

```typescript
// src/agent/types.ts

export type AgentPhase = 'analyze' | 'plan' | 'execute' | 'validate' | 'present'

export interface AgentState {
  phase: AgentPhase
  prompt: string
  plan: EditPlan | null
  editsApplied: EditOperation[]
  validationResult: ValidationResult | null
  iteration: number
  maxIterations: number
}

export interface AgentConfig {
  max_iterations: number      // max plan→execute→validate cycles (default: 5)
  auto_confirm: boolean       // skip user confirmation for edits (default: false)
  show_plan: boolean          // display plan before executing (default: true)
  run_validation: boolean     // run tests/lint after edits (default: true)
  validation_command?: string // e.g., "npm test"
}

export interface AgentRunResult {
  success: boolean
  edits: EditOperation[]
  diffs: string[]              // unified diffs per file
  validationPassed: boolean | null
  iterations: number
  tokensUsed: { input: number; output: number }
  agent: 'local' | 'claude' | 'hybrid'
}
```

```typescript
// src/agent/coding-agent.ts

export class CodingAgent {
  constructor(
    private localAgent: LocalAgent,
    private claudeAgent: ClaudeAgent | null,
    private toolExecutor: ToolExecutor,
    private codeEditor: CodeEditor,
    private memory: AgentMemory,
    private config: AgentConfig,
  ) {}

  async run(prompt: string): Promise<AgentRunResult>

  // Event emitter for streaming UX
  on(event: 'stream', handler: (data: StreamEvent) => void): void
}
```

### 5.2 Edit Planning

```typescript
// src/agent/planner.ts

export interface EditPlan {
  description: string
  steps: EditStep[]
  estimatedFiles: string[]
}

export interface EditStep {
  description: string
  file: string
  operation: 'insert' | 'replace' | 'delete' | 'create'
  target?: string             // function name, line range, or search pattern
  reasoning: string
}

export interface GatheredContext {
  files: Array<{ path: string; content: string; relevance: string }>
  searchResults: Array<{ file: string; line: number; match: string }>
  gitContext?: string
  memory: MemorySnapshot
}

export class Planner {
  async generatePlan(
    prompt: string,
    context: GatheredContext,
    agent: 'local' | 'claude',
  ): Promise<EditPlan>

  async refinePlan(
    plan: EditPlan,
    errors: string[],
    agent: 'local' | 'claude',
  ): Promise<EditPlan>
}
```

### 5.3 Structured Code Editing

```typescript
// src/editor/types.ts

export interface EditOperation {
  file: string
  operation: 'insert' | 'replace' | 'delete' | 'create'
  afterLine?: number          // for insert (0 = beginning of file)
  startLine?: number          // for replace/delete
  endLine?: number            // for replace/delete
  search?: string             // alternative: find-and-replace by content match
  content?: string            // new code (for insert/replace/create)
}

export interface ApplyResult {
  applied: EditOperation[]
  failed: Array<{ edit: EditOperation; error: string }>
  originals: Map<string, string>  // for rollback
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

### 5.4 Agent Memory

```typescript
// src/agent/memory.ts

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
  toPromptContext(): string  // compact summary for LLM prompts
  clear(): void
}
```

### 5.5 Streaming

```typescript
// src/agent/stream.ts

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

---

## 6. Agent Loop — Phase Details

### Phase 1: ANALYZE

Gather context using tools. No LLM reasoning yet for the code — just tool selection.

1. Check memory for recently accessed files
2. Ask local LLM: "What should I search/read to handle this request?" → tool calls
3. Execute tool calls via `ToolExecutor` (search_code, read_file, list_files, git_query)
4. Limit: max 5 files, max 2000 tokens per file
5. Record accessed files in memory

### Phase 2: PLAN

Generate a structured edit plan. LLM sees gathered context + memory, outputs a plan — not code.

```
System: You are a code editing planner. Create an edit plan. Do NOT write code.
User: [request] + [gathered context] + [memory summary]
Output: JSON { description, steps: [{ description, file, operation, target, reasoning }] }
```

Benefits: smaller prompts for code gen, user can review before execution, retry refines plan not code.

### Phase 3: EXECUTE

Convert each plan step into a concrete `EditOperation`:

1. For each step, show the LLM only the target file section + the step description
2. LLM outputs a JSON `EditOperation` (file, operation, line numbers, content)
3. Preview diffs before applying
4. Apply via `CodeEditor`
5. Record edits in memory

### Phase 4: VALIDATE

Run configured validation command (e.g., `npm test`). On failure, loop back to PLAN with error output (up to `max_iterations`).

### Phase 5: PRESENT

Show unified diffs with colors, summary stats, and confirmation prompt:

```
─── Edit Plan: Add logging to auth middleware ───

--- src/middleware/auth.ts
+++ src/middleware/auth.ts
@@ -1,4 +1,5 @@
 import { Request, Response, NextFunction } from 'express'
+import { logger } from '../utils/logger'

1 file changed, 2 insertions(+)
✓ Tests passed

Apply changes? [Y/n/edit]
```

---

## 7. Model Routing Per Phase

| Phase | Model | Rationale |
|---|---|---|
| ANALYZE | Local (small) | Just selecting tools — small action space |
| PLAN | Local or Claude | Simple: local. Multi-file/complex: Claude |
| EXECUTE | Local or Claude | Follows plan routing decision |
| VALIDATE | No LLM | Deterministic (run command) |
| PRESENT | No LLM | Deterministic (render diffs) |

Auto-escalation rule: if the plan has >2 unique files or >3 steps, route PLAN+EXECUTE to Claude.

---

## 8. Config Additions

```typescript
// Added to src/config/schema.ts

const AgentConfigSchema = z.object({
  max_iterations: z.number().min(1).max(10).default(5),
  auto_confirm: z.boolean().default(false),
  show_plan: z.boolean().default(true),
  run_validation: z.boolean().default(true),
  validation_command: z.string().optional(),
})

const EditorConfigSchema = z.object({
  show_diff: z.boolean().default(true),
  color_diff: z.boolean().default(true),
  backup_before_edit: z.boolean().default(true),
})
```

```yaml
# locode.yaml additions

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

## 9. Integration with Existing Code

### Orchestrator

```typescript
// src/orchestrator/orchestrator.ts — modified process()

async process(prompt: string, previousSummary?: string): Promise<OrchestratorResult> {
  // ... existing routing ...
  const route = await this.router.classify(enrichedPrompt)

  // NEW: detect coding tasks and delegate to CodingAgent
  if (this.isCodingTask(prompt)) {
    return this.runCodingAgent(prompt, route)
  }

  // ... existing chat dispatch ...
}

private isCodingTask(prompt: string): boolean {
  const patterns = /\b(add|fix|implement|refactor|change|update|modify|create|write|delete|remove)\b/i
  return patterns.test(prompt)
}
```

### REPL

```typescript
// src/cli/repl.ts — agent mode with streaming

if (isCodingTask(input)) {
  const renderer = new StreamRenderer(codingAgent.stream)
  renderer.start()
  const result = await orchestrator.process(input, previousSummary)
  renderer.stop()
} else {
  // existing chat behavior
}
```

---

## 10. Example Workflows

### Simple: Single-file edit (fully local, ~3s)

```
User: "Add logging to the auth middleware"

ANALYZE (200ms) → search_code("auth.*middleware") → read_file("src/middleware/auth.ts")
PLAN (500ms)    → { steps: [insert logger import, add log statement] }
EXECUTE (800ms) → apply 2 edit operations
VALIDATE (2s)   → npm test → ✓ passed
PRESENT         → show diff, confirm

Total: ~3.5s, 0 Claude tokens
```

### Complex: Multi-file refactor (escalates to Claude, ~12s)

```
User: "Refactor tool dispatch to use the new registry"

ANALYZE (300ms) → search + read 4 files
PLAN (2s)       → Claude: { steps: [create registry, migrate 3 tools, update agent] }
EXECUTE (5s)    → Claude: generate edits for 4 files
VALIDATE (3s)   → npm test → ✗ fail → loop to PLAN
  PLAN (1s)     → Claude: fix import path
  EXECUTE (500ms) → apply fix
  VALIDATE (2s) → npm test → ✓ pass
PRESENT         → show diffs for 4 files, confirm

Total: ~14s, Claude used for plan + execute only
```

---

## 11. Performance Budget

Local LLMs have small context windows (2048-4096 tokens). Every prompt must be compact.

| Phase | Max Prompt Tokens | Strategy |
|---|---|---|
| ANALYZE | ~500 | Short system prompt + request + tool list |
| PLAN | ~1500 | Request + truncated files + memory summary |
| EXECUTE | ~1000 | Plan step + target file section only |

Techniques:
- Parallel tool execution in ANALYZE
- JSON mode for constrained generation (~30% faster)
- Memory-based context reuse (skip re-reading known files)
- Early termination (0 steps → skip execute/validate)
- Streaming (perceived latency near zero)

---

## 12. Dependencies

| Package | Purpose | Type |
|---|---|---|
| `diff` | Generate unified diffs | Pure JS, lightweight |

No native dependencies. All existing deps (chalk, ollama, etc.) are reused.

---

## 13. What This Enables

- **v0.4**: Smart context retrieval feeds into the ANALYZE phase automatically
- **v0.5**: Workflow engine chains multiple CodingAgent runs for multi-ticket execution

---

## 14. Success Criteria

- [ ] Agent completes single-file edits using only local LLM
- [ ] Agent auto-escalates multi-file changes to Claude
- [ ] Diffs display correctly with colors in terminal
- [ ] Agent memory prevents re-reading recently accessed files
- [ ] Validation failures trigger plan refinement (up to max_iterations)
- [ ] Streaming output shows phase progression in real time
- [ ] All existing tests pass + new module tests pass
- [ ] `npm run build` succeeds
