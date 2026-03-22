# Locode v0.5 — Workflow Automation

**Date:** 2026-03-10
**Status:** Proposed
**Scope:** Assisted workflow engine, milestone commands, checkpointed state persistence, context curation for Claude
**Depends on:** v0.3.5 (agent hardening + performance), v0.4 (codebase intelligence)

---

## 1. Goal

Chain multiple coding agent runs into **automated workflows** — fetch tickets, create branches, gather context, implement code, run tests, commit, push, and create PRs. The local LLM orchestrates; Claude writes code; Locode manages everything.

---

## 2. Design Principles

1. **Fixed state machines, not free-form planning** — small LLMs are unreliable planners; workflows are deterministic step sequences
2. **LLM fills args, not decides steps** — the workflow engine controls what happens next; the LLM decides how (tool arguments, code changes)
3. **Claude receives curated context** — local LLM + codebase index gather context; Claude gets a focused `ContextBundle` and returns `FileChange[]`
4. **Checkpointed by default** — branch creation, push, PR, and ticket mutation pause for approval unless the user explicitly opts into full automation
5. **Resumable** — workflow state persists to disk; interrupted workflows resume where they left off
6. **MCP-native project management** — Linear, GitHub, etc. via MCP servers; no provider abstraction layer

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

export interface WorkflowStepDef {
  id: string
  agent: 'local' | 'claude' | 'coding-agent'  // coding-agent uses the v0.3 CodingAgent
  description: string
  tools?: string[]                    // restrict available tools for this step
  checkpoint?: 'never' | 'before' | 'after'
  input?: string                      // reference to previous step output key
  output?: string                     // key to store result
  on_failure?: 'stop' | 'retry' | string  // step id to jump to
  max_retries?: number
}

export interface WorkflowInstance {
  id: string
  template: string
  status: 'running' | 'paused' | 'completed' | 'failed'
  currentStep: number
  stepResults: Map<string, StepResult>
  artifactDir: string
  params: Record<string, unknown>     // initial parameters
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

Built-in templates should be **assisted** by default:

- `feature-ticket`
  checkpoints before branch creation, before commit, before push, before PR creation
- `bugfix`
  checkpoints before commit and before PR creation
- `test-fix`
  no remote git operations unless explicitly enabled

Templates can opt into fewer checkpoints, but the default product posture should favor user trust over full autonomy.

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

### 6.1 Default Milestone Template

```yaml
# Built-in template (src/workflow/templates.ts)

milestone:
  description: "Implement all tickets in a milestone"
  steps:
    - id: fetch_tickets
      agent: local
      description: "Fetch tickets from project management tool"
      tools: [mcp__linear__list_issues, mcp__github__list_issues]
      output: tickets

    - id: for_each_ticket  # pseudo — engine handles iteration
      agent: local
      description: "Process each ticket"
      input: tickets
      steps:
        - id: create_branch
          agent: local
          description: "Create a git branch for this ticket"
          tools: [git_mutate]
          output: branch_name

        - id: gather_context
          agent: local
          description: "Gather relevant code context for implementation"
          tools: [search_code, read_file, symbol_lookup, semantic_search]
          output: context_bundle

        - id: implement
          agent: coding-agent
          description: "Implement the ticket changes"
          input: context_bundle
          output: code_changes
          on_failure: retry
          max_retries: 2

        - id: run_tests
          agent: local
          description: "Run tests to validate changes"
          tools: [run_command]
          on_failure: fix_and_retry

        - id: fix_and_retry
          agent: coding-agent
          description: "Fix failing tests"
          input: test_errors
          on_failure: stop
          max_retries: 1

        - id: commit_push
          agent: local
          description: "Stage, commit, and push changes"
          tools: [git_mutate]

        - id: create_pr
          agent: local
          description: "Create a pull request"
          tools: [run_command]  # gh pr create

        - id: update_ticket
          agent: local
          description: "Update ticket status to done"
          tools: [mcp__linear__save_issue, mcp__github__update_issue]
```

### 6.2 Single Ticket Template

```yaml
single_ticket:
  description: "Implement a single ticket"
  steps:
    - id: gather_context
      agent: local
      tools: [search_code, read_file, symbol_lookup, semantic_search]
      output: context_bundle

    - id: implement
      agent: coding-agent
      input: context_bundle
      output: code_changes
      on_failure: retry
      max_retries: 2

    - id: run_tests
      agent: local
      tools: [run_command]
      on_failure: stop

    - id: commit
      agent: local
      tools: [git_mutate]
```

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

### v0.3 CodingAgent

The workflow engine delegates implementation steps to `CodingAgent`:

```typescript
// In WorkflowEngine step execution
case 'coding-agent':
  const context = stepResults.get(step.input)
  const result = await this.codingAgent.run(step.description, {
    context: context as GatheredContext,
    autoConfirm: true,  // no manual confirmation in workflow mode
  })
  return { output: result.edits, tokensUsed: result.tokensUsed }
```

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

v0.5 is the culmination of the architecture. After v0.5:
- Developers can run `locode milestone start "sprint-3"` and walk away
- Locode fetches tickets, implements code, runs tests, creates PRs
- Local LLM handles orchestration at zero cloud cost
- Claude only called for actual code implementation (minimal tokens)

---

## 14. Success Criteria

- [ ] Workflow engine executes multi-step templates
- [ ] State persists to disk; interrupted workflows resume correctly
- [ ] `locode milestone start` fetches tickets via MCP and processes them
- [ ] CodingAgent integration works within workflow steps
- [ ] Context curation produces focused bundles from codebase index
- [ ] Progress display shows real-time step completion
- [ ] Error recovery handles test failures with retry
- [ ] Claude rate limits pause workflow and resume automatically
- [ ] All tests pass, build succeeds
