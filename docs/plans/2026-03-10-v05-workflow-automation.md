# Locode v0.5 — Workflow Automation

**Date:** 2026-03-10
**Updated:** 2026-04-03
**Status:** Proposed — do not begin until v0.4a ships
**Scope:** Single-ticket workflow engine, checkpointed state persistence, context curation for Claude. Milestone/multi-ticket looping is v0.5.1.
**Depends on:** v0.3.5 ✓ complete, v0.4 (hard prerequisite — `implement` step quality depends on it)

---

## 0. Product Thesis

**Internal:**
> Locode is a checkpoint-driven workflow engine for running coding agents unattended — resumable, fully auditable, and human-gated before every remote action.

**External tagline:**
> Auditable, resumable ticket-to-PR workflows for coding agents.

This thesis creates a product bar: **Locode must be safe to leave running.** Every design decision in v0.5 should be evaluated against it. Silent failures, non-deterministic checkpoints, undefined rollback for remote git state — all violate the trust contract.

---

## 1. Goal

Take a single ticket from description to committed, tested code — with resumable execution, full step-level auditability, and human gates before every remote action. The local LLM orchestrates; Claude writes code; Locode manages state and safety.

**v0.5 scope:** `single_ticket` workflow only. The `milestone` template (which requires a loop/iterator primitive over multiple tickets) ships in v0.5.1 once the single-ticket execution core is proven reliable.

---

## 2. Design Principles

1. **Fixed state machines, not free-form planning** — small LLMs are unreliable planners; workflows are deterministic step sequences
2. **LLM fills args, not decides steps** — the workflow engine controls what happens next; the LLM decides how (tool arguments, code changes)
3. **Claude receives curated context** — local LLM + codebase index gather context; Claude gets a focused `ContextBundle` and returns `FileChange[]`
4. **Checkpointed by default** — branch creation, push, PR, and ticket mutation pause for approval unless the user explicitly opts into full automation
5. **Resumable** — workflow state persists to disk; interrupted workflows resume where they left off
6. **MCP-native project management** — Linear, GitHub, etc. via MCP servers; no provider abstraction layer

---

## v0.5 and Model Specialization

v0.5 benefits from the optional `Model Specialization` track, but does not depend on it for delivery.

**How specialization can help v0.5**
- a faster classifier can reduce routing overhead for workflow steps on low-powered devices
- a narrower local executor can make bounded orchestration steps more responsive
- better traces and evals from the specialization track can improve workflow-step routing confidence

**What remains true without custom models**
- the workflow engine should work with the default routing/runtime stack
- Claude remains the path for complex code generation and reasoning
- workflow safety, checkpoints, and state handling must not assume fine-tuned models exist

**Constraint**
- do not make classifier training or local fine-tuning a hard prerequisite for workflow automation

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    WORKFLOW ENGINE                                │
│                                                                  │
│  locode milestone start "feature-x"                             │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────┐                                        │
│  │  Load Template       │ ← from config or ~/.locode/workflows/ │
│  └──────────┬──────────┘                                        │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────┐     ┌──────────────────┐              │
│  │  For each step:      │     │  State Manager    │              │
│  │                      │────►│                  │              │
│  │  1. Set agent        │     │  • persist state  │              │
│  │  2. Restrict tools   │     │  • resume support │              │
│  │  3. Checkpoint       │     │  • artifact links  │              │
│  │  4. Execute          │◄────│  • error recovery │              │
│  │  5. Capture output   │     └──────────────────┘              │
│  │  6. Pass to next     │                                        │
│  └──────────┬──────────┘                                        │
│             │                                                    │
│     ┌───────┴────────┐                                          │
│     │                │                                          │
│     ▼                ▼                                          │
│  LOCAL STEPS      CLAUDE STEPS                                  │
│  • fetch tickets  • implement ticket                            │
│  • create branch  • fix test failures                           │
│  • gather context • complex refactoring                         │
│  • run tests                                                     │
│  • commit                                                        │
│  • push (checkpointed)                                           │
│  • create PR (checkpointed)                                      │
│  • update ticket                                                │
│                                                                  │
│  Uses: CodingAgent (v0.3.5+), ContextRetriever (v0.4),         │
│        ToolExecutor (v0.2), MCP servers                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. New Files

```
src/
├── workflow/                          # NEW — workflow runtime
│   ├── engine.ts                     # State machine runner
│   ├── engine.test.ts
│   ├── state.ts                      # Workflow state persistence
│   ├── state.test.ts
│   ├── templates.ts                  # Built-in workflow definitions
│   ├── templates.test.ts
│   └── types.ts                      # Workflow interfaces
├── context/                           # NEW — context curation for Claude
│   ├── curator.ts                    # Build ContextBundle from index + tools
│   ├── curator.test.ts
│   ├── cache.ts                      # Cache context bundles + Claude results
│   ├── cache.test.ts
│   └── types.ts                      # (extended from v0.4)
├── cli/
│   ├── milestone.ts                  # NEW — milestone CLI commands
│   └── milestone.test.ts
├── tools/definitions/                 # NEW tools
│   └── git-mutate.ts                 # Git write ops: commit, branch, push (gated by safety)
```

**New files: 14** (including tests). **Modified: 4** (index.ts, orchestrator.ts, config/schema.ts, locode.yaml).

> **Safety note:** v0.5 assumes the v0.3.5 runtime artifact store, approval policy, and rollback model exist. Workflow automation should not bypass those layers.

---

## 5. TypeScript Interfaces

### 5.1 Workflow Types

```typescript
// src/workflow/types.ts

export interface WorkflowTemplate {
  name: string
  description: string
  steps: WorkflowStepDef[]
}

// Discriminated union — engine switches on `type` to handle loops vs linear steps
export type WorkflowStepDef = LinearStepDef | ForEachStepDef

export interface LinearStepDef {
  type?: 'linear'  // default; omitting `type` is treated as linear (backward-compatible)
  id: string
  agent: 'local' | 'claude' | 'coding-agent'
  description: string
  tools?: string[]                    // restrict available tools for this step
  checkpoint?: 'never' | 'before' | 'after' | 'both'
  inputFrom?: string[]                // explicit step output keys this step reads
  outputKey?: string                  // key to store result in step results namespace
  onFailure?: OnFailure
}

// First-class loop primitive — required for milestone/multi-ticket templates (v0.5.1+)
export interface ForEachStepDef {
  type: 'for-each'
  id: string
  iterateOver: string                 // outputKey from a previous step (must resolve to array)
  itemKey: string                     // binding name for each item within the sub-workflow
  subWorkflow: WorkflowTemplate       // runs once per item
  checkpoint?: 'never' | 'before-each' | 'after-each'
}

// Typed failure handling — replaces on_failure: string (which was a goto in disguise)
export type OnFailure =
  | { action: 'stop' }
  | { action: 'retry'; maxRetries: number }
  | { action: 'recover'; recoveryStepId: string; maxAttempts: number }
  | { action: 'continue' }           // mark failed, proceed anyway (use with caution)

export interface WorkflowInstance {
  id: string
  template: string
  snapshotTemplate: WorkflowTemplate  // full template definition pinned at start — safe to change templates without breaking resume
  status: 'running' | 'paused' | 'completed' | 'failed'
  currentStep: number
  stepResults: Record<string, StepResult>  // plain object — JSON-safe, not Map (Map serializes to {})
  artifactDir: string
  params: Record<string, unknown>
  startedAt: number
  updatedAt: number
}

export interface StepResult {
  stepId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  output?: unknown
  error?: string
  approvalRequired?: boolean
  tokensUsed: { input: number; output: number }
  durationMs: number
}

// Shown to user at every checkpoint — gives context for approval, not just a blocking prompt
export interface WorkflowApprovalRequest {
  workflowId: string
  stepId: string
  description: string               // "Push branch feat/linear-12 to origin"
  action: string                    // human-readable action
  preview?: string                  // diff, PR title, commit message, etc.
  consequences: string[]            // ["Creates remote branch", "Triggers CI"]
  artifactDir: string               // path to step artifacts for inspection
}
```

### 5.2 Workflow Engine

```typescript
// src/workflow/engine.ts

export class WorkflowEngine {
  constructor(
    private orchestrator: Orchestrator,
    private codingAgent: CodingAgent,
    private stateManager: StateManager,
    private config: Config,
  ) {}

  /** Start a new workflow from a template */
  async start(
    templateName: string,
    params: Record<string, unknown>,
  ): Promise<WorkflowInstance>

  /** Resume an interrupted workflow */
  async resume(workflowId: string): Promise<WorkflowInstance>

  /** Get status of a running/completed workflow */
  getStatus(workflowId: string): WorkflowInstance | undefined

  /** List all workflows */
  list(): WorkflowInstance[]

  /** Cancel a running workflow */
  async cancel(workflowId: string): Promise<void>

  /** Approve a paused checkpoint and continue */
  async approve(workflowId: string): Promise<WorkflowInstance>
}
```

### 5.3 State Manager

```typescript
// src/workflow/state.ts

export class StateManager {
  private storageDir: string  // ~/.locode/workflows/

  /** Save workflow state to disk */
  async save(instance: WorkflowInstance): Promise<void>

  /** Load workflow state from disk */
  async load(workflowId: string): Promise<WorkflowInstance | null>

  /** List all saved workflows */
  async listAll(): Promise<WorkflowInstance[]>

  /** Delete completed workflow state */
  async cleanup(olderThanMs: number): Promise<number>
}
```

### 5.4 Context Curator (for Claude)

```typescript
// src/context/curator.ts

export interface ContextBundle {
  task: string                    // ticket or step description
  chunks: CodeChunk[]             // relevant code (from v0.4 index)
  testChunks: CodeChunk[]         // existing tests for modified code
  gitContext?: string             // recent diffs, blame
  totalTokenEstimate: number
}

export interface CodeChunk {
  file: string
  startLine: number
  endLine: number
  content: string
  symbol?: string                 // function/class name
  relevance: number               // 0-1
}

export class ContextCurator {
  constructor(
    private indexer: CodebaseIndexer,     // from v0.4
    private budgetManager: BudgetManager, // from v0.4
    private toolExecutor: ToolExecutor,   // from v0.2
  ) {}

  /**
   * Build a focused context bundle for Claude.
   *
   * Pipeline:
   * 1. Extract hints from task description (file paths, function names)
   * 2. Symbol index search (v0.4)
   * 3. Semantic search for related code (v0.4)
   * 4. Expand dependencies (imports of matched files)
   * 5. Include existing tests for matched files
   * 6. Allocate token budget across chunks
   */
  async curate(task: string, hints?: string[]): Promise<ContextBundle>
}
```

### 5.5 Context Cache

```typescript
// src/context/cache.ts

export class ContextCache {
  /**
   * Cache key: hash(task + sorted file paths + content hashes of included files)
   * Invalidates when any included file changes.
   */
  async get(task: string, files: string[]): Promise<ContextBundle | null>
  async set(task: string, files: string[], bundle: ContextBundle): Promise<void>
  async invalidate(changedFiles: string[]): Promise<number>
}
```

---

## 6. Workflow Templates

Built-in templates should be **assisted** by default — the default posture favors user trust over full autonomy. Templates can opt into fewer checkpoints, but the product never removes them globally without explicit user config.

**v0.5 ships one built-in template: `single_ticket`.** The `milestone` template requires the `ForEachStepDef` loop primitive and ships in v0.5.1.

---

## 7. Performance Notes

Workflow performance matters because repeated slow startup costs make automation feel worse than manual execution. v0.5 should therefore:

- reuse the v0.3.5 run artifact store instead of recomputing context between steps
- cache curated context bundles keyed by task + file hashes
- avoid re-running full retrieval if only workflow metadata changed
- prefer targeted validation commands between steps and reserve full test runs for explicit gates
- stream step progress immediately so long-running local operations still feel responsive

---

## 8. Recommended Rollout

Ship workflow automation in this order:

1. local-only milestone commands with checkpoints
2. Claude-assisted implementation steps with artifact capture
3. resumable state and context cache
4. remote git operations (`push`, PR creation) behind explicit opt-in

This keeps v0.5 developer-friendly and safe while still moving toward end-to-end automation.

### 6.1 Single Ticket Template (v0.5)

```yaml
# Built-in template — ships in v0.5
single_ticket:
  description: "Implement a single ticket from description to committed, tested code"
  steps:
    - id: gather_context
      type: linear
      agent: local
      description: "Gather relevant code context for implementation"
      tools: [search_code, read_file, symbol_lookup, semantic_search]
      outputKey: context_bundle

    - id: implement
      type: linear
      agent: coding-agent
      description: "Implement the changes"
      inputFrom: [context_bundle]
      outputKey: code_changes
      onFailure: { action: retry, maxRetries: 2 }
      checkpoint: never  # workspace-only at this point; no remote actions yet

    - id: run_tests
      type: linear
      agent: local
      description: "Run tests to validate changes"
      tools: [run_command]
      inputFrom: [code_changes]
      outputKey: test_results
      onFailure: { action: recover, recoveryStepId: fix_tests, maxAttempts: 1 }

    - id: fix_tests
      type: linear
      agent: coding-agent
      description: "Fix failing tests"
      inputFrom: [test_results]
      outputKey: code_changes  # overwrites previous code_changes
      onFailure: { action: stop }

    - id: commit
      type: linear
      agent: local
      description: "Stage and commit changes"
      tools: [git_mutate]
      inputFrom: [code_changes]
      checkpoint: before  # user sees commit message + diff before it lands
```

> **Note on `fix_tests`:** This is an explicit step ID referenced by `run_tests.onFailure.recoveryStepId`, not a goto. The engine executes it only once (bounded by `maxAttempts`) and halts on failure. Recovery steps are always typed and bounded — never implicit jumps.

### 6.2 Milestone Template (v0.5.1 — requires ForEachStepDef)

The milestone template requires the `for-each` loop primitive to iterate over tickets. It ships in v0.5.1 once the single-ticket execution core is proven reliable:

```yaml
# Planned for v0.5.1
milestone:
  description: "Implement all tickets in a milestone"
  steps:
    - id: fetch_tickets
      type: linear
      agent: local
      description: "Fetch tickets from project management tool"
      tools: [mcp__linear__list_issues, mcp__github__list_issues]
      outputKey: tickets

    - id: process_tickets
      type: for-each          # requires ForEachStepDef — NOT available in v0.5
      iterateOver: tickets
      itemKey: ticket
      checkpoint: before-each
      subWorkflow:
        name: single_ticket_with_pr
        steps:
          # ... single_ticket steps + create_branch + create_pr
          # update_ticket deliberately omitted until write-back is proven safe
```

> **Deliberately excluded from milestone template:** `update_ticket` (Linear/GitHub write-back). High blast radius for a step that adds no value in proving the core execution model. Add it in v0.5.2 after the loop primitive is stable.

---

## 7. Claude Agent Evolution

In v0.5, `ClaudeAgent` is evolved to accept `ContextBundle` and return `FileChange[]`:

```typescript
// src/agents/claude.ts — evolved

export interface ClaudeImplementResult extends AgentResult {
  changes: FileChange[]
  explanation: string
  rateLimitInfo: RateLimitInfo | null
}

export interface FileChange {
  file: string
  action: 'create' | 'modify' | 'delete'
  content: string  // full new content or unified diff
}

export class ClaudeAgent {
  /** Existing: free-form chat */
  async run(prompt: string, systemPrompt?: string): Promise<ClaudeAgentResult>

  /** NEW: structured implementation from context bundle */
  async implement(bundle: ContextBundle): Promise<ClaudeImplementResult>
}
```

The `implement()` method sends a structured prompt with the context bundle and expects structured output (file changes). The `run()` method remains for interactive chat.

---

## 8. Config Additions

```typescript
// Added to src/config/schema.ts

const WorkflowConfigSchema = z.object({
  storage_dir: z.string().default('~/.locode/workflows'),
  custom_templates_dir: z.string().optional(),
  auto_cleanup_days: z.number().default(30),
})
```

```yaml
# locode.yaml additions

workflows:
  storage_dir: ~/.locode/workflows
  # custom_templates_dir: ~/.locode/templates
  auto_cleanup_days: 30
```

---

## 9. CLI Commands

```bash
# Milestone workflow
locode milestone start "feature-x"     # Start milestone workflow
locode milestone status                 # Show current workflow progress
locode milestone resume                 # Resume interrupted workflow
locode milestone list                   # List all workflows (active + completed)
locode milestone cancel                 # Cancel running workflow

# Single ticket
locode implement "Add user authentication"  # Run single-ticket workflow
locode implement --ticket LINEAR-42         # Implement a specific ticket
```

### Progress Display

```
$ locode milestone start "auth-system"

  Milestone: auth-system
  Tickets: 4 found

  [1/4] LINEAR-12: Add login endpoint
  ├── Creating branch: feat/linear-12-login-endpoint  ✓
  ├── Gathering context...  ✓ (3 files, 1200 tokens)
  ├── Implementing...  ✓ (2 files changed, +45 -3)
  ├── Running tests...  ✓ (24 passed)
  ├── Committing...  ✓
  ├── Creating PR...  ✓ → github.com/org/repo/pull/42
  └── Updating ticket...  ✓

  [2/4] LINEAR-13: Add session middleware
  ├── Creating branch: feat/linear-13-session  ✓
  ├── Gathering context...  ■ (in progress)
  ...

  Progress: 1/4 tickets completed
  Tokens: local 3,200 | claude 8,500 ($0.12)
  Time: 2m 30s elapsed
```

---

## 10. Integration Points

### Orchestrator

```typescript
// src/orchestrator/orchestrator.ts

class Orchestrator {
  private workflowEngine?: WorkflowEngine

  async initWorkflows(): Promise<void> {
    const stateManager = new StateManager(this.config.workflows.storage_dir)
    this.workflowEngine = new WorkflowEngine(this, this.codingAgent, stateManager, this.config)
  }

  async startMilestone(name: string): Promise<WorkflowInstance> {
    return this.workflowEngine.start('milestone', { milestone: name })
  }
}
```

### v0.3 CodingAgent in Workflow Mode

The workflow engine delegates implementation steps to `CodingAgent`. In workflow mode, interactive prompts (diff display, plan approval) are suppressed — but this is not a simple `autoConfirm: true` flag. The distinction matters:

- **Interactive mode:** user approves diffs, plans, tool calls
- **Workflow mode:** workflow-level checkpoints gate remote actions; within-step operations execute without per-prompt approval; diffs are captured as artifacts rather than displayed

The `CodingAgent` must accept an explicit `executionMode` to make this distinction clear at the type level:

```typescript
// In WorkflowEngine step execution
case 'coding-agent':
  const contextBundle = step.inputFrom
    ?.map(key => stepResults[key]?.output)
    .find(Boolean)
  const result = await this.codingAgent.run(step.description, {
    context: contextBundle as GatheredContext,
    executionMode: 'workflow',  // suppresses interactive prompts; diffs go to artifacts
    artifactDir: instance.artifactDir,
  })
  return { output: result.edits, tokensUsed: result.tokensUsed }
```

> **Design note:** Do not use `autoConfirm: true` for this. That flag bypasses the safety layer entirely. `executionMode: 'workflow'` should suppress interactive display while still writing diffs and plans to the artifact dir — preserving auditability.

### v0.4 ContextRetriever

The workflow's `gather_context` step uses the codebase index:

```typescript
case 'gather_context':
  const bundle = await this.contextCurator.curate(ticketDescription, ticketHints)
  return { output: bundle }
```

---

## 11. Error Recovery

| Scenario | Behavior |
|---|---|
| Test failure | Retry with error context (up to max_retries) |
| Claude rate limit | Pause workflow, save state, resume when tokens reset |
| Network error | Retry with exponential backoff (up to 4 attempts) |
| LLM generates invalid output | Retry with validation error (free local compute) |
| User interrupts (Ctrl+C) | Save state immediately, resume later |
| Step fails after max retries | Mark step failed, continue to next ticket or stop |

---

## 12. Performance Considerations

| Operation | Target | Notes |
|---|---|---|
| Workflow startup | < 2s | Load template + fetch tickets |
| Context curation per ticket | < 500ms | Leverages v0.4 index |
| Implementation per ticket | 5-30s | Depends on complexity |
| Full milestone (5 tickets) | 2-5 min | Sequential by default |

Future optimization: parallel ticket execution using git worktrees (one worktree per ticket).

---

## 13. What This Enables

After v0.5:
- Developers run `locode implement --ticket LINEAR-42`, step away, and return to committed, tested code
- Every step is logged to the artifact dir — readable post-hoc even if the session is gone
- Interrupted runs resume cleanly; no need to re-run from scratch
- Checkpoints before commit mean nothing irreversible happens without explicit approval
- Local LLM handles orchestration at zero cloud cost; Claude only handles code generation

After v0.5.1:
- `locode milestone start "sprint-3"` processes multiple tickets sequentially
- Each ticket gets its own branch, implementation, test run, and PR — human-gated before each push

---

## 14. Success Criteria

**v0.5 (single-ticket workflow):**
- [ ] `WorkflowEngine` executes flat `LinearStepDef` templates
- [ ] `WorkflowInstance.stepResults` serializes/deserializes correctly (no `Map` — use `Record`)
- [ ] `WorkflowInstance.snapshotTemplate` is saved at start; resume uses snapshot, not current template
- [ ] Interrupted workflows resume from correct step with correct step results loaded
- [ ] `WorkflowApprovalRequest` is shown at every checkpoint with action, preview, and consequences
- [ ] `CodingAgent` runs in `executionMode: 'workflow'` — no interactive prompts; diffs written to artifact dir
- [ ] `locode implement "..."` and `locode implement --ticket LINEAR-42` work end-to-end
- [ ] `single_ticket` template: gather_context → implement → run_tests → (fix_tests) → commit
- [ ] Error recovery: `recover` strategy calls `fix_tests` step once on test failure, then stops
- [ ] Claude rate limit pauses workflow, saves state, resumes on next run
- [ ] Progress display shows real-time step completion with token and time stats
- [ ] All tests pass, build succeeds

**v0.5.1 (milestone workflow — not in v0.5 scope):**
- [ ] `ForEachStepDef` implemented in engine with bounded iteration
- [ ] `milestone` template fetches tickets via MCP and processes each via sub-workflow
- [ ] `locode milestone start "..."` works end-to-end
