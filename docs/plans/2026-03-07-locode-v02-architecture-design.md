# Locode v0.2 Architecture Design — Local-First Agent Runtime

**Date:** 2026-03-07
**Status:** Proposed
**Scope:** Full architecture evolution from routing CLI to agent runtime

---

## 1. Design Philosophy

1. **Local-first execution** — local LLM handles tool orchestration, parsing, system interaction
2. **Minimize Claude calls** — Claude only for deep reasoning and code implementation
3. **Deterministic workflows** — fixed state machines, not free-form agent planning
4. **Tool-first local model** — structured JSON tool calls, never free-form chat
5. **Fast CLI UX** — heuristic fast paths, speculative execution, minimal latency
6. **User-configurable** — routing rules, tool permissions, models, workflows all in `locode.yaml`
7. **Claude receives curated context** — local LLM gathers and chunks context; Claude has no tool access

---

## 2. Key Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Workflow control | Fixed state machine | Small models are unreliable planners; workflows are predictable |
| Claude tool access | None — receives context bundles, returns code | Saves tokens; Locode mediates all mutations |
| Local LLM output | Constrained JSON DSL (not native function-calling) | Faster generation, more models supported, easier validation |
| Speculative execution | Discard local output if router picks Claude | Simple; local compute is free |
| Context gathering | Ticket hints + heuristics + local LLM tool calls | No embeddings needed; deterministic chunking saves tokens |
| Context optimization | AST/line-range chunking with priority-weighted budget | Sends functions not files; predictable token usage |
| Project management | MCP-native, no abstraction layer | Stays true to MCP; users swap providers via config |

---

## 3. Target Developer Workflow

```
1. User + Claude → architecture + implementation plan
2. Claude creates milestones/tickets in Linear via MCP
3. User runs: locode milestone start "feature-x"
4. Workflow executes:

   LOCAL LLM:                          CLAUDE:
   ├── fetch tickets from Linear       │
   ├── parse ticket content            │
   ├── create git branch               │
   ├── gather context (read, grep)     │
   ├── chunk + build ContextBundle ──► │ implement ticket
   │                                   │ write code
   │                                   │ return FileChange[]
   ├── apply code changes ◄────────── │
   ├── run tests                       │
   │   └── (fail → send errors) ────► │ fix implementation
   │   └── (apply fix) ◄───────────── │
   ├── stage + commit                  │
   ├── push branch                     │
   ├── create pull request             │
   └── update Linear ticket status     │
```

---

## 4. System Architecture

### 4.1 Pipeline Overview

```
Prompt arrives
    │
    ▼
┌──────────────────────────────────┐
│         Task Classifier          │
│                                  │
│  L0: FastPath ─────────────────────► ToolExecutor (direct, no LLM)
│  L1: WorkflowStep ─────────────────► skip to assigned agent
│  L2: Interactive ──────┐         │
└────────────────────────┼─────────┘
                         │
                         ▼
                   ┌───────────┐
                   │  Router   │
                   │ heuristic │──► speculative local start
                   │ rules     │
                   │ LLM       │
                   └─────┬─────┘
                         │
                         ▼
                  RouteDecision
                   /         \
                  /           \
           LOCAL               CLAUDE
             │                    │
             ▼                    ▼
        LocalAgent          ┌──────────┐
        (JSON DSL)          │ Context  │
             │              │ Curator  │
             │              │          │
             │              │ Cache    │
             │              │ Budget   │
             │              │ Chunker  │
             │              └────┬─────┘
             │                   │
             │              ContextBundle
             │                   │
             │              ClaudeAgent
             │                   │
             ▼                   ▼
        ┌────────────────────────────┐
        │       Tool Executor        │
        │                            │
        │  validate → SafetyGate → execute
        │               ↓                 │
        │      (blocked → confirm)        │
        └─────────────────────────────────┘
             │
             ▼
         ToolResult
             │
             ▼
         Tracker
```

### 4.2 Task Classifier

New pipeline stage that eliminates unnecessary routing.

Three layers:

**Layer 0 — FastPath:** Regex match against known direct-execution patterns (`grep`, `ls`, `git status`, `show files`). Executes the tool immediately with zero LLM involvement. Near-zero latency.

**Layer 1 — WorkflowStep:** If the prompt originates from the workflow engine, the agent is already assigned. Skip routing entirely.

**Layer 2 — Interactive:** All other prompts proceed to the Router for classification.

```typescript
interface ClassificationResult {
  type: 'fast_path' | 'workflow_step' | 'interactive'
  toolCall?: ToolCall         // for fast_path
  assignedAgent?: AgentType   // for workflow_step
}

class TaskClassifier {
  private fastPathPatterns: Map<RegExp, ToolCall>  // from config

  classify(prompt: string, workflowContext?: WorkflowStep): ClassificationResult
}
```

Benefits:
- Avoids unnecessary LLM routing calls
- `git status`, `ls src/`, `grep TODO` execute instantly
- Workflow steps never hit the router

### 4.3 Router (evolved)

Three layers for interactive prompts only:

```
Layer 1: Heuristic    — zero-cost checks (prompt length, keywords, file refs)
Layer 2: Config rules  — regex patterns from locode.yaml (existing)
Layer 3: LLM fallback  — local model JSON classification (existing, now JSON-mode)
```

Output:

```typescript
interface RouteDecision {
  route: 'LOCAL' | 'CLAUDE'
  confidence: number       // 0-1
  method: 'heuristic' | 'rule' | 'llm'
  reason: string
}
```

If confidence < `routing.escalation_threshold`, escalate to Claude.

User override flags remain supported: `--local`, `--claude`.

### 4.4 Workflow Engine

Declarative state machine runner. Workflows are fixed step sequences — the local LLM fills in tool arguments, not decides what steps to take.

```typescript
interface WorkflowStep {
  id: string
  agent: 'local' | 'claude'
  tools?: string[]            // allowed tools for this step
  input?: string              // reference to previous step output
  output?: string             // key to store result
  on_failure?: string         // step to jump to on failure
}

interface WorkflowTemplate {
  name: string
  steps: WorkflowStep[]       // or nested with loop
}

class WorkflowEngine {
  async start(template: WorkflowTemplate, params: Record<string, unknown>): void
  async resume(workflowId: string): void
  getStatus(workflowId: string): WorkflowStatus
}
```

Example milestone workflow definition:

```yaml
workflows:
  milestone:
    steps:
      - id: fetch_tickets
        agent: local
        tools: [mcp__linear__list_issues]
        output: tickets

      - id: for_each_ticket
        loop: tickets
        steps:
          - id: create_branch
            agent: local
            tools: [git_create_branch]

          - id: gather_context
            agent: local
            tools: [read_file, grep, git_log]
            output: context_bundle

          - id: implement
            agent: claude
            input: context_bundle
            output: code_changes

          - id: apply_and_test
            agent: local
            tools: [write_file, shell_run_tests]
            input: code_changes
            on_failure: retry_claude

          - id: commit_and_push
            agent: local
            tools: [git_commit, git_push, mcp__linear__save_issue]
```

**State persistence:** Workflow state serialized to `~/.locode/workflows/<id>.json` for resume after interruption.

### 4.5 Context Curator

Builds minimal, focused context bundles for Claude. Contains three subsystems.

#### 4.5.1 Context Gathering

Priority order:
1. **Ticket hints** — file paths and scope from ticket body (when available)
2. **Heuristics** — file-context-injector (existing), import graph, `git log --follow`
3. **Local LLM tool calls** — `grep`, `read_file` for supplementary context

#### 4.5.2 Code Chunker

Extracts relevant code chunks instead of sending whole files.

```typescript
interface CodeChunk {
  file: string
  startLine: number
  endLine: number
  content: string
  symbol?: string           // function/class name if AST-extracted
  relevance: number         // 0-1, used for budget allocation
}
```

Strategies:
- **AST-based** — extract functions, classes, methods by name (preferred)
- **Line-range** — fallback for unsupported languages
- Configurable via `context.chunking: 'ast' | 'line-range'`

Token savings example:
```
Whole file:     src/orchestrator.ts → 300 lines → ~4500 tokens
Relevant chunk: Orchestrator.process() → 40 lines → ~600 tokens
                                                      (87% reduction)
```

#### 4.5.3 Context Budget Manager

Priority-weighted token allocation prevents context overflow.

```typescript
interface BudgetAllocation {
  total: number                // from config: context.max_context_tokens
  priorities: {
    task_description: 1.0      // always include full
    primary_files: 0.9         // files explicitly in ticket
    test_files: 0.7            // existing tests for modified code
    import_context: 0.5        // files imported by primary files
    git_context: 0.3           // recent diffs, blame
  }
}
```

Fill from highest priority down. When budget is exhausted, stop. Deterministic, predictable, adapts naturally to different task shapes.

#### 4.5.4 Plan Cache

Caches context bundles and Claude results to avoid redundant work.

Cache key:

```
hash(ticket_id + sorted_file_paths + tree_hash_of_relevant_files)
```

Uses `git hash-object` on specific files, not repo HEAD. Cache survives commits to unrelated files but invalidates when relevant code changes.

| Cached item | Lifetime | Invalidation |
|---|---|---|
| ContextBundle | Long (until relevant files change) | tree hash of included files |
| ClaudeResult | Short (single workflow run) | any file change in scope |

```typescript
interface ContextBundle {
  task: string
  chunks: CodeChunk[]
  testChunks: CodeChunk[]
  gitContext?: string
  totalTokenEstimate: number
}
```

### 4.6 Tool Executor

Decoupled from agents. Both the workflow engine and agents invoke tools through a single executor.

```typescript
interface ToolCall {
  tool: string
  args: Record<string, unknown>
  reason?: string               // optional, for debugging/logging
}

interface ToolResult {
  success: boolean
  output: string
  error?: string
}

class ToolExecutor {
  private registry: ToolRegistry
  private safetyGate: SafetyGate
  private mcpManager: McpManager

  async execute(call: ToolCall): Promise<ToolResult> {
    // 1. Validate against registry schema
    // 2. Check SafetyGate
    // 3. Execute tool
    // 4. Return result
  }
}
```

#### 4.6.1 Safety Gate

Config-driven confirmation for dangerous operations.

```yaml
safety:
  always_confirm:
    - git push --force
    - rm -rf
    - git reset --hard
  confirm_outside_paths:
    - src/
    - tests/
  auto_approve:
    - read_file
    - grep
    - git status
    - git log
```

Flow:

```
ToolCall → validate schema → SafetyGate → execute
                                ↓
                       (blocked → prompt user for confirmation)
```

Protects against model hallucinations, prompt injection, and unintended destructive actions.

### 4.7 Local Agent (evolved)

Produces structured JSON tool calls via Ollama JSON mode. No native function-calling.

```typescript
class LocalAgent {
  async run(prompt: string, toolRegistry: ToolDefinition[]): LocalAgentResult
}

interface LocalAgentResult {
  toolCalls: ToolCall[]
  message?: string            // optional text for user display
  inputTokens: number
  outputTokens: number
}
```

System prompt includes the tool registry as a JSON schema. Model outputs:

```jsonc
// Single tool call
{ "tool": "read_file", "args": { "path": "src/router.ts" }, "reason": "Need router for context" }

// Multiple tool calls
{ "tools": [
  { "tool": "read_file", "args": { "path": "src/router.ts" } },
  { "tool": "grep", "args": { "pattern": "classify", "path": "src/" } }
]}

// Message only (no tool needed)
{ "message": "Branch feature-auth already exists." }
```

Validation:
- `tool` must exist in registry
- `args` validated against tool's JSON schema
- Malformed JSON → retry with error message (up to 3 attempts, free local compute)
- Unknown tool name → retry with tool list reminder

### 4.8 Claude Agent (evolved)

Receives pre-curated `ContextBundle`, returns structured code changes. No tool access.

```typescript
class ClaudeAgent {
  async implement(bundle: ContextBundle): ClaudeResult
}

interface ClaudeResult {
  changes: FileChange[]
  explanation: string          // reasoning for user display
  inputTokens: number
  outputTokens: number
  rateLimitInfo: RateLimitInfo | null
}

interface FileChange {
  file: string
  action: 'create' | 'modify' | 'delete'
  content: string              // full new content or unified diff
}
```

### 4.9 Token Tracker (unchanged)

Existing tracker design is sufficient. Records per-turn usage by agent, estimates cost, optional log file output.

---

## 5. Local Model Reliability Strategy

Small models are unreliable at free-form reasoning. The architecture constrains them to succeed:

| Strategy | Mechanism |
|---|---|
| Constrained output | JSON-mode only, never free-form chat |
| Small action space | Each workflow step limits valid tools |
| Schema validation | Every output validated against tool registry |
| Cheap retries | Malformed output → retry with error (local = free) |
| No planning | Workflow engine decides steps, LLM fills args |
| Step-scoped prompts | "You are at step create_branch. Output a tool call." |

---

## 6. Speculative Execution

For interactive prompts (not workflow steps), reduce perceived latency:

```
t=0ms   Prompt arrives
        ├── Start local generation (speculative)
        ├── Run Task Classifier
        │   ├── FastPath? → execute directly, cancel speculative
        │   └── Interactive → start Router
        │
t=2ms   Router Layer 1 (heuristic) — ~1ms
        ├── HIGH confidence LOCAL → keep streaming
        ├── HIGH confidence CLAUDE → cancel local, forward to Claude
        ├── Ambiguous → continue
        │
t=5ms   Router Layer 2 (rules) — ~2ms
        ├── Match → use decision
        ├── No match → Layer 3
        │
t=50ms  Router Layer 3 (LLM) — ~50-200ms
        └── Result → cancel local if CLAUDE

t=200ms Local model streaming for 200ms
        └── If route=LOCAL, user sees instant response
```

Implementation: `AbortController` cancels the Ollama HTTP request.

---

## 7. Project Structure Evolution

```
src/
├── index.ts                          # CLI entry (add milestone commands)
├── cli/
│   ├── repl.ts                       # Interactive REPL (unchanged)
│   ├── milestone.ts                  # NEW — milestone workflow commands
│   ├── setup.ts                      # First-run wizard
│   ├── display.ts                    # Pretty printing
│   ├── benchmark.ts                  # Token benchmarking
│   └── install.ts                    # Ollama install helper
├── config/
│   ├── schema.ts                     # Zod schema (extended)
│   └── loader.ts                     # YAML loader
├── agents/
│   ├── local.ts                      # EVOLVED — JSON DSL output
│   └── claude.ts                     # EVOLVED — ContextBundle in, FileChange[] out
├── orchestrator/
│   ├── orchestrator.ts               # EVOLVED — coordinates workflow engine
│   ├── router.ts                     # EVOLVED — 3-layer + speculative execution
│   ├── task-classifier.ts            # NEW — FastPath + WorkflowStep + Interactive
│   ├── file-context-injector.ts      # Existing (feeds into Context Curator)
│   └── repo-context-loader.ts        # Existing
├── workflow/                          # NEW
│   ├── engine.ts                     # State machine runner
│   ├── state.ts                      # Workflow state persistence
│   └── templates.ts                  # Built-in workflow definitions
├── context/                           # NEW
│   ├── curator.ts                    # Context bundle builder
│   ├── chunker.ts                    # AST/line-range code chunking
│   ├── budget.ts                     # Priority-weighted token allocation
│   └── cache.ts                      # Plan cache with tree-hash invalidation
├── tools/                             # EVOLVED
│   ├── executor.ts                   # NEW — central tool executor
│   ├── registry.ts                   # NEW — tool registry + schema validation
│   ├── safety.ts                     # NEW — config-driven safety gate
│   ├── shell.ts                      # Existing (allow-list)
│   ├── git.ts                        # EVOLVED — add write operations
│   ├── readFile.ts                   # Existing
│   └── writeFile.ts                  # NEW — controlled file writes
├── mcp/
│   ├── client.ts                     # Existing MCP manager
│   └── oauth.ts                      # Existing OAuth
└── tracker/
    └── tracker.ts                    # Existing token tracker
```

New files: 10. Modified files: 5. Unchanged files: 12.

---

## 8. Configuration Evolution

```yaml
# locode.yaml — new and modified sections

# Existing (unchanged)
local_llm:
  provider: ollama
  model: qwen3:8b
  base_url: http://localhost:11434

claude:
  model: claude-sonnet-4-6
  token_threshold: 0.99

routing:
  rules:
    - pattern: "^(grep|find|ls|cat|show)"
      agent: local
    - pattern: "(implement|refactor|architect|design)"
      agent: claude
  ambiguous_resolver: local
  escalation_threshold: 0.7
  speculative_execution: true       # NEW — enable speculative local start

# NEW — task classifier fast paths
fast_paths:
  - pattern: "^git status"
    tool: git
    args: { subcommand: status }
  - pattern: "^ls\\b"
    tool: shell
    args: { command: ls }
  - pattern: "^grep\\b"
    tool: shell
    args: { command: grep }

# EVOLVED — context configuration
context:
  handoff: summary
  max_summary_tokens: 1000
  max_file_bytes: 51200
  repo_context_files: [CLAUDE.md]
  max_context_tokens: 8000          # NEW — budget for Claude context bundles
  chunking: ast                     # NEW — 'ast' | 'line-range'

# NEW — safety gate
safety:
  always_confirm:
    - git push --force
    - rm -rf
    - git reset --hard
  confirm_outside_paths:
    - src/
    - tests/
  auto_approve:
    - read_file
    - grep
    - git status
    - git log

# NEW — workflow configuration
workflows:
  milestone:
    template: default
  custom_workflows_dir: ~/.locode/workflows/

# NEW — tool write permissions
tools:
  write_enabled: true
  allowed_write_paths:
    - src/
    - tests/

# Existing (unchanged)
mcp_servers:
  linear:
    type: remote
    url: https://mcp.linear.app/sse

token_tracking:
  enabled: true
  log_file: ~/.locode/usage.log
```

---

## 9. CLI Commands Evolution

| Command | Status | Description |
|---|---|---|
| `locode chat` | Existing | Interactive REPL |
| `locode run <prompt>` | Existing | Single-shot task |
| `locode setup` | Existing | First-run wizard |
| `locode install [model]` | Existing | Ollama model install |
| `locode benchmark` | Existing | Token cost comparison |
| `locode milestone start <name>` | **NEW** | Start milestone workflow |
| `locode milestone status` | **NEW** | Show workflow progress |
| `locode milestone resume` | **NEW** | Resume interrupted workflow |
| `locode milestone list` | **NEW** | List available milestones |

---

## 10. Developer UX Features

| Feature | Description |
|---|---|
| Workflow progress | `[3/7] Implementing ticket LOC-42...` |
| Token budget display | Show estimated vs actual tokens per Claude call |
| Dry-run mode | `--dry-run` shows what workflow would do without executing |
| Context preview | `--show-context` displays what would be sent to Claude |
| Safety confirmations | Clear prompts for dangerous operations |
| Workflow resume | Pick up where you left off after interruption |

---

## 11. Follow-Up Features (v0.3+)

These are valuable but not required for the first implementation.

| Feature | Value | Complexity | Notes |
|---|---|---|---|
| Streaming patch application | High UX | Medium | Parse unified diffs from Claude stream |
| Expanded workflow DSL | High for power users | Low–Medium | Add `retry`, then `parallel`, then `condition` |
| Embedding-based context | Moderate for monorepos | Medium | Optional vector index behind config flag |
| Parallel ticket execution | High throughput | Medium | Git worktrees per ticket |
| Custom routing plugins | High extensibility | Low | Plugin interface for router layers |

---

## 12. Migration Path from v0.1

The evolution is incremental. No big-bang rewrite.

**Phase 1 — Foundation (tool executor + safety + task classifier):**
- Extract tools from LocalAgent into ToolExecutor + Registry
- Add SafetyGate
- Add TaskClassifier with FastPath
- All existing behavior preserved

**Phase 2 — Context (curator + chunker + budget + cache):**
- Build Context Curator with AST chunking
- Add Budget Manager
- Add Plan Cache
- Evolve ClaudeAgent to accept ContextBundle

**Phase 3 — Workflow (engine + state + templates):**
- Build WorkflowEngine state machine
- Add milestone CLI commands
- Add state persistence and resume

**Phase 4 — Performance (speculative execution + JSON DSL):**
- Switch LocalAgent to JSON-mode DSL
- Add speculative execution to Router
- Optimize end-to-end latency

Each phase is independently shippable and testable.

---

## 13. Versioned Config & Update Strategy

User configs at `~/.locode/locode.yaml` drift from shipped defaults when new routing rules, config fields, or defaults are added across releases. The setup wizard's `CONFIG_TEMPLATE` is a second source of drift.

### Design

Add a `config_version: N` field to `locode.yaml`. Bump it whenever defaults change meaningfully (new routing rules, new config sections, changed defaults).

```yaml
config_version: 2   # bumped when defaults change
local_llm:
  ...
```

### Behaviour on startup

```
loadConfig()
  ├── Read user config
  ├── Compare config_version against CURRENT_CONFIG_VERSION constant
  ├── If missing or older:
  │     stderr: "[locode] Your config is outdated (v1 → v2). Run `locode update-config` to see what changed."
  │     Continue with user's existing config (no forced changes)
  └── If current: proceed normally
```

### `locode update-config` command

Interactive command that:
1. Loads user config and shipped defaults
2. Diffs them section by section
3. For each new/changed section, shows the diff and asks:
   - `[A]ccept new default` — merge the new value
   - `[S]kip` — keep user's current value
   - `[V]iew` — show full context before deciding
4. Bumps `config_version` to current
5. Writes updated config

```
$ locode update-config

Config update: v1 → v2

[NEW] routing rule: greetings → local
  + pattern: "^(hi|hello|hey|thanks|...)\\b"
  + agent: local
  Accept? [Y/n] y

[NEW] context.max_file_bytes: 51200
  Accept? [Y/n] y

[NEW] context.repo_context_files: ["CLAUDE.md"]
  Accept? [Y/n] y

✓ Config updated to v2
```

### Rules

- **Never auto-modify** user config without explicit consent
- **Always warn** on version mismatch, never silently ignore
- **Single source of truth** for defaults: a `DEFAULT_CONFIG` constant in code (replaces both `locode.yaml` in repo root and `CONFIG_TEMPLATE` in setup.ts)
- **Setup wizard** uses `DEFAULT_CONFIG` + sets `config_version` to current on first run
- Bump `config_version` in the same PR that changes defaults

### Migration phase

Belongs in **Phase 1** alongside tool executor + safety, since it's foundational infrastructure that all other phases benefit from.
