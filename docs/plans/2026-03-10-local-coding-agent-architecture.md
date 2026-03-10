# Locode v0.4 — Local Coding Agent Architecture

**Date:** 2026-03-10
**Status:** Proposed
**Scope:** Cursor-style coding agent with structured edits, tool registry, agent memory, diff output, and streaming UX — all optimized for local LLMs on laptops.

---

## 1. Design Philosophy

1. **Tools before reasoning** — use deterministic systems (ripgrep, file reads, git) before asking the LLM to think
2. **Plan before edit** — generate an edit plan, then apply structured changes (never rewrite whole files)
3. **Structured output only** — local LLMs produce JSON tool calls and edit operations, never free-form code blocks
4. **Session memory** — track recent files, edits, and commands to avoid redundant retrieval
5. **Diff-first display** — show unified diffs, not full files, for every code change
6. **Stream everything** — stream reasoning steps and token output for responsive CLI UX
7. **Local-first, cloud-assisted** — local LLM handles the agent loop; Claude only for complex code generation

---

## 2. What's In Scope (v0.4) vs Deferred (v0.5)

| Capability | v0.4 | v0.5 |
|---|---|---|
| Coding agent workflow (plan→edit→validate) | Yes | — |
| Tool registry with schema validation | Yes | — |
| Structured code editing (insert/replace/delete) | Yes | — |
| Diff-based output | Yes | — |
| Agent memory (session-level) | Yes | — |
| Streaming UX | Yes | — |
| Edit planning before code generation | Yes | — |
| Codebase file tree index | — | Yes |
| Symbol index (tree-sitter) | — | Yes |
| Embedding-based semantic search | — | Yes |
| Dependency graph | — | Yes |
| Smart context retrieval pipeline | — | Yes |
| Context budget manager | — | Yes |

v0.4 builds the **agent runtime** that v0.5's intelligence layer plugs into.

---

## 3. Architecture Overview

```
User Request (CLI)
    │
    ▼
┌──────────────────────┐
│   Intent Classifier   │ ← regex fast-paths + existing Router
│   (routing.ts)        │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│   Agent Loop          │ ← NEW: iterative plan→execute→validate
│   (coding-agent.ts)   │
│                       │
│  ┌─────────────────┐ │
│  │ 1. Analyze       │ │  ← understand intent, gather context
│  │ 2. Plan          │ │  ← generate structured edit plan
│  │ 3. Execute       │ │  ← apply edits via tool system
│  │ 4. Validate      │ │  ← run tests/lint, check results
│  │ 5. Present       │ │  ← show diffs, ask confirmation
│  └─────────────────┘ │
│                       │
│  Agent Memory ◄───────┤  ← tracks files, edits, commands
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│   Tool Executor       │ ← NEW: central dispatch with safety
│   (tool-executor.ts)  │
│                       │
│   Tool Registry ◄────┤  ← search_code, read_file, write_file,
│   (tool-registry.ts)  │    apply_edit, run_command, git_*
│                       │
│   Safety Gate ◄───────┤  ← confirm destructive operations
│   (safety-gate.ts)    │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│   Code Editor         │ ← NEW: structured edit application
│   (code-editor.ts)    │
│                       │
│   Diff Renderer ◄────┤  ← unified diff output
│   (diff-renderer.ts)  │
└──────────────────────┘
```

---

## 4. New Module Structure

```
src/
├── index.ts                              # CLI entry (add `agent` command)
├── agent/                                 # NEW — coding agent runtime
│   ├── coding-agent.ts                   # Agent loop: analyze→plan→execute→validate
│   ├── coding-agent.test.ts
│   ├── planner.ts                        # Edit plan generation
│   ├── planner.test.ts
│   ├── memory.ts                         # Session memory (files, edits, commands)
│   ├── memory.test.ts
│   ├── types.ts                          # Shared agent types/interfaces
│   └── stream.ts                         # Streaming output helpers
├── editor/                                # NEW — structured code editing
│   ├── code-editor.ts                    # Apply structured edits to files
│   ├── code-editor.test.ts
│   ├── diff-renderer.ts                  # Generate unified diffs
│   ├── diff-renderer.test.ts
│   └── types.ts                          # Edit operation types
├── tools/                                 # EVOLVED — modular tool system
│   ├── registry.ts                       # NEW — tool registry + schema validation
│   ├── registry.test.ts
│   ├── executor.ts                       # NEW — central tool dispatch + safety
│   ├── executor.test.ts
│   ├── safety-gate.ts                    # NEW — config-driven safety checks
│   ├── safety-gate.test.ts
│   ├── definitions/                       # NEW — individual tool definitions
│   │   ├── search-code.ts               # ripgrep-based code search
│   │   ├── read-file.ts                 # read file (evolved from readFile.ts)
│   │   ├── write-file.ts               # controlled file writes
│   │   ├── apply-edit.ts               # apply structured edit operations
│   │   ├── run-command.ts              # allow-list shell execution (evolved from shell.ts)
│   │   ├── git-query.ts               # git read operations (evolved from git.ts)
│   │   ├── git-mutate.ts              # git write operations (commit, branch)
│   │   └── list-files.ts              # directory listing
│   ├── index.ts                          # Barrel export
│   ├── shell.ts                          # DEPRECATED — migrated to definitions/
│   ├── git.ts                            # DEPRECATED — migrated to definitions/
│   └── readFile.ts                       # DEPRECATED — migrated to definitions/
├── orchestrator/                          # EVOLVED
│   ├── orchestrator.ts                   # Add CodingAgent integration
│   ├── router.ts                         # Unchanged
│   ├── file-context-injector.ts          # Unchanged
│   └── repo-context-loader.ts           # Unchanged
├── agents/                                # Existing (minor changes)
│   ├── local.ts                          # Wire to ToolExecutor instead of direct dispatch
│   └── claude.ts                         # Unchanged
├── config/
│   ├── schema.ts                         # Add agent, editor, safety config sections
│   └── loader.ts                         # Unchanged
├── tracker/
│   └── tracker.ts                        # Unchanged
├── cli/
│   ├── repl.ts                           # EVOLVED — integrate agent mode
│   └── ...                               # Other CLI files unchanged
└── mcp/
    ├── client.ts                         # Unchanged
    └── oauth.ts                          # Unchanged
```

**New files: 18** (including tests). **Modified files: 5**. **Deprecated: 3** (old tool files kept as re-exports for backward compat during transition).

---

## 5. TypeScript Interfaces

### 5.1 Tool System

```typescript
// src/tools/registry.ts

/** Every tool must implement this interface */
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>  // JSON Schema for args
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
  category: 'read' | 'write' | 'search' | 'git' | 'shell'
  requiresConfirmation?: boolean  // override safety gate
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
  metadata?: {
    filesRead?: string[]
    filesWritten?: string[]
    linesChanged?: number
  }
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  register(tool: ToolDefinition): void
  get(name: string): ToolDefinition | undefined
  list(): ToolDefinition[]
  listForLLM(): OllamaToolSchema[]  // convert to Ollama function-call format
  validate(name: string, args: Record<string, unknown>): ValidationResult
}
```

### 5.2 Tool Executor

```typescript
// src/tools/executor.ts

export interface ToolCall {
  tool: string
  args: Record<string, unknown>
  reason?: string  // LLM's explanation (for logging)
}

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private safetyGate: SafetyGate,
  ) {}

  /** Execute a single tool call with validation and safety checks */
  async execute(call: ToolCall): Promise<ToolResult>

  /** Execute multiple independent tool calls in parallel */
  async executeParallel(calls: ToolCall[]): Promise<ToolResult[]>
}
```

### 5.3 Safety Gate

```typescript
// src/tools/safety-gate.ts

export interface SafetyConfig {
  always_confirm: string[]       // patterns that always need confirmation
  auto_approve: string[]         // tools that never need confirmation
  allowed_write_paths: string[]  // restrict file writes to these dirs
}

export class SafetyGate {
  constructor(private config: SafetyConfig) {}

  /** Returns true if the tool call is safe to execute without confirmation */
  check(call: ToolCall): SafetyDecision

  /** Prompt user for confirmation via CLI */
  async confirm(call: ToolCall, reason: string): Promise<boolean>
}

export interface SafetyDecision {
  allowed: boolean
  reason: string
  requiresConfirmation: boolean
}
```

### 5.4 Coding Agent

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
  maxIterations: number  // default: 5
}

export interface AgentConfig {
  max_iterations: number      // max plan→execute→validate cycles
  auto_confirm: boolean       // skip user confirmation for edits
  show_plan: boolean          // display plan before executing
  run_validation: boolean     // run tests/lint after edits
  validation_command?: string // e.g., "npm test"
}

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

  /**
   * Main agent loop. Returns when edits are confirmed or max iterations reached.
   *
   * Flow:
   * 1. ANALYZE — gather context using tools (read files, search code)
   * 2. PLAN — generate structured edit plan
   * 3. EXECUTE — apply edits via CodeEditor
   * 4. VALIDATE — run tests/lint if configured
   * 5. PRESENT — show diffs, get user confirmation
   *
   * On validation failure: loop back to PLAN with error context
   */
  async run(prompt: string): Promise<AgentRunResult>

  /** Stream progress events for CLI display */
  on(event: 'phase', handler: (phase: AgentPhase, detail: string) => void): void
  on(event: 'tool_call', handler: (call: ToolCall) => void): void
  on(event: 'diff', handler: (diff: string) => void): void
}

export interface AgentRunResult {
  success: boolean
  edits: EditOperation[]
  diffs: string[]           // unified diffs per file
  validationPassed: boolean | null
  iterations: number
  tokensUsed: { input: number; output: number }
  agent: 'local' | 'claude' | 'hybrid'
}
```

### 5.5 Edit Planning

```typescript
// src/agent/planner.ts

export interface EditPlan {
  description: string        // human-readable summary
  steps: EditStep[]
  estimatedFiles: string[]   // files that will be modified
}

export interface EditStep {
  description: string
  file: string
  operation: 'insert' | 'replace' | 'delete' | 'create'
  target?: string            // function name, line range, or search pattern
  reasoning: string          // why this change is needed
}

export class Planner {
  /**
   * Generate an edit plan from user prompt + gathered context.
   * Uses local LLM for simple edits, Claude for complex ones.
   */
  async generatePlan(
    prompt: string,
    context: GatheredContext,
    agent: 'local' | 'claude',
  ): Promise<EditPlan>

  /**
   * Refine a plan after validation failure.
   * Adds error context and asks LLM to adjust.
   */
  async refinePlan(
    plan: EditPlan,
    errors: string[],
    agent: 'local' | 'claude',
  ): Promise<EditPlan>
}

export interface GatheredContext {
  files: Array<{ path: string; content: string; relevance: string }>
  searchResults: Array<{ file: string; line: number; match: string }>
  gitContext?: string
  memory: MemorySnapshot
}
```

### 5.6 Structured Code Editing

```typescript
// src/editor/types.ts

export interface EditOperation {
  file: string
  operation: 'insert' | 'replace' | 'delete' | 'create'
  // For insert:
  afterLine?: number         // insert after this line (0 = beginning)
  // For replace:
  startLine?: number
  endLine?: number
  search?: string            // alternative: find-and-replace by content
  // For all mutations:
  content?: string           // new code to insert/replace with
}

// src/editor/code-editor.ts

export class CodeEditor {
  /**
   * Apply a list of edit operations to the filesystem.
   * Returns the original file contents for rollback.
   */
  async applyEdits(edits: EditOperation[]): Promise<ApplyResult>

  /**
   * Rollback edits by restoring original file contents.
   */
  async rollback(result: ApplyResult): Promise<void>

  /**
   * Generate unified diffs for a set of edits WITHOUT applying them.
   * Used for preview/confirmation.
   */
  async preview(edits: EditOperation[]): Promise<DiffPreview[]>
}

export interface ApplyResult {
  applied: EditOperation[]
  failed: Array<{ edit: EditOperation; error: string }>
  originals: Map<string, string>  // file path → original content (for rollback)
}

export interface DiffPreview {
  file: string
  diff: string      // unified diff format
  additions: number
  deletions: number
}
```

### 5.7 Diff Renderer

```typescript
// src/editor/diff-renderer.ts

export class DiffRenderer {
  /**
   * Generate a unified diff between original and modified content.
   */
  static unifiedDiff(file: string, original: string, modified: string): string

  /**
   * Render a diff with ANSI colors for terminal display.
   */
  static colorize(diff: string): string

  /**
   * Render a compact summary: "3 files changed, 12 insertions, 4 deletions"
   */
  static summary(diffs: DiffPreview[]): string
}
```

### 5.8 Agent Memory

```typescript
// src/agent/memory.ts

export interface MemoryEntry {
  timestamp: number
  type: 'file_read' | 'file_write' | 'search' | 'command' | 'edit' | 'error'
  detail: string           // file path, search query, command, etc.
  result?: string          // truncated result for context
}

export interface MemorySnapshot {
  recentFiles: string[]           // last N files accessed
  recentEdits: EditOperation[]    // last N edits applied
  recentCommands: string[]        // last N commands run
  recentErrors: string[]          // last N errors encountered
  sessionStart: number
}

export class AgentMemory {
  private entries: MemoryEntry[] = []
  private maxEntries: number = 50

  record(entry: Omit<MemoryEntry, 'timestamp'>): void
  getSnapshot(): MemorySnapshot
  getRecentFiles(n?: number): string[]

  /**
   * Generate a compact context string for inclusion in LLM prompts.
   * Example: "Recently accessed: src/router.ts, src/agent.ts. Last edit: added logging to auth.ts:42"
   */
  toPromptContext(): string

  clear(): void
}
```

### 5.9 Streaming Output

```typescript
// src/agent/stream.ts

import { EventEmitter } from 'events'

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

/**
 * CLI renderer that subscribes to AgentStream and renders
 * colored, formatted output to the terminal.
 */
export class StreamRenderer {
  constructor(private stream: AgentStream) {}
  start(): void  // begin listening and rendering
  stop(): void   // stop rendering
}
```

---

## 6. Agent Loop — Detailed Flow

### 6.1 The Five Phases

```
┌─────────────────────────────────────────────────────────────┐
│                        CODING AGENT                          │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ ANALYZE  │───►│  PLAN    │───►│ EXECUTE  │              │
│  │          │    │          │    │          │              │
│  │ • search │    │ • gen    │    │ • apply  │              │
│  │ • read   │    │   edit   │    │   edits  │              │
│  │ • git    │    │   plan   │    │ • record │              │
│  │ • memory │    │ • show   │    │   memory │              │
│  └──────────┘    │   plan   │    └────┬─────┘              │
│                  └──────────┘         │                     │
│                       ▲               ▼                     │
│                       │          ┌──────────┐              │
│                       │          │ VALIDATE │              │
│                       │          │          │              │
│                       │          │ • run    │              │
│                       └──────────│   tests  │              │
│                     (on failure) │ • check  │              │
│                                  │   output │              │
│                                  └────┬─────┘              │
│                                       │                     │
│                                       ▼                     │
│                                  ┌──────────┐              │
│                                  │ PRESENT  │              │
│                                  │          │              │
│                                  │ • show   │              │
│                                  │   diffs  │              │
│                                  │ • confirm│              │
│                                  └──────────┘              │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Phase Details

#### Phase 1: ANALYZE

The agent gathers context about the user's request using tools — no LLM reasoning yet.

```typescript
// Pseudocode for analyze phase
async analyze(prompt: string): Promise<GatheredContext> {
  const context: GatheredContext = { files: [], searchResults: [], memory: this.memory.getSnapshot() }

  // 1. Check memory for recently accessed files
  const recentFiles = this.memory.getRecentFiles(3)

  // 2. Use local LLM to determine what to search for
  const searchPlan = await this.localAgent.generate({
    prompt: `Given this request: "${prompt}"
What files and code should I search for? Respond with tool calls.`,
    tools: ['search_code', 'read_file', 'list_files', 'git_query']
  })

  // 3. Execute the search tool calls
  for (const call of searchPlan.toolCalls) {
    const result = await this.toolExecutor.execute(call)
    this.memory.record({ type: 'search', detail: call.tool + ': ' + JSON.stringify(call.args) })

    if (call.tool === 'read_file') {
      context.files.push({ path: call.args.path, content: result.output, relevance: 'direct' })
    } else if (call.tool === 'search_code') {
      // Parse ripgrep results into structured search results
      context.searchResults.push(...parseSearchResults(result.output))
    }
  }

  // 4. Limit context size (max 5 files, max 2000 tokens per file)
  context.files = context.files.slice(0, 5)
  for (const f of context.files) {
    f.content = truncateToTokens(f.content, 2000)
  }

  return context
}
```

#### Phase 2: PLAN

Generate a structured edit plan. The LLM sees gathered context + memory, outputs a plan — not code.

```typescript
async plan(prompt: string, context: GatheredContext): Promise<EditPlan> {
  const planPrompt = `
You are a code editing planner. Given the user's request and the code context below,
create an edit plan. Do NOT write code — just describe what changes are needed.

Request: ${prompt}

${context.memory.toPromptContext()}

Files:
${context.files.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}

Respond with JSON:
{
  "description": "brief summary of changes",
  "steps": [
    {
      "description": "what to do",
      "file": "path/to/file.ts",
      "operation": "insert|replace|delete|create",
      "target": "function name or line range",
      "reasoning": "why this change"
    }
  ]
}`

  const result = await this.localAgent.generate({ prompt: planPrompt, jsonMode: true })
  return parsePlan(result.content)
}
```

Benefits of planning first:
- **Smaller prompts**: the code generation step only sees the plan + target file, not the full context
- **Fewer hallucinations**: the LLM commits to a strategy before writing code
- **User review**: user can approve/reject the plan before any code is generated
- **Retry efficiency**: on failure, refine the plan (cheap) rather than regenerate all code

#### Phase 3: EXECUTE

Convert each plan step into a concrete `EditOperation` and apply it.

```typescript
async execute(plan: EditPlan, context: GatheredContext): Promise<EditOperation[]> {
  const edits: EditOperation[] = []

  for (const step of plan.steps) {
    // Read the target file (may already be in context)
    const fileContent = context.files.find(f => f.path === step.file)?.content
      ?? await this.readFile(step.file)

    // Ask LLM to generate the specific edit operation
    const editPrompt = `
Generate a structured code edit for this file.

File: ${step.file}
Current content:
${fileContent}

Change needed: ${step.description}
Target: ${step.target}
Operation: ${step.operation}

Respond with JSON:
{
  "file": "${step.file}",
  "operation": "${step.operation}",
  "startLine": <number>,
  "endLine": <number>,
  "content": "<new code>"
}`

    const result = await this.localAgent.generate({ prompt: editPrompt, jsonMode: true })
    const edit = parseEditOperation(result.content)
    edits.push(edit)
  }

  // Preview diffs before applying
  const previews = await this.codeEditor.preview(edits)
  this.stream.emit('stream', { type: 'diff', file: 'all', diff: previews.map(p => p.diff).join('\n') })

  // Apply edits
  const applyResult = await this.codeEditor.applyEdits(edits)

  // Record in memory
  for (const edit of applyResult.applied) {
    this.memory.record({ type: 'edit', detail: `${edit.operation} in ${edit.file}` })
  }

  return applyResult.applied
}
```

#### Phase 4: VALIDATE

Run configured validation (tests, lint, type check) and check results.

```typescript
async validate(config: AgentConfig): Promise<ValidationResult> {
  if (!config.run_validation || !config.validation_command) {
    return { passed: null, output: 'validation skipped' }
  }

  const result = await this.toolExecutor.execute({
    tool: 'run_command',
    args: { command: config.validation_command }
  })

  return {
    passed: result.success,
    output: result.output
  }
}
```

On failure, the agent loops back to PLAN with the error output as additional context. Max iterations prevent infinite loops.

#### Phase 5: PRESENT

Show diffs, summary, and ask for confirmation.

```
─────────────────────────────────────────
  Edit Plan: Add logging to auth middleware
─────────────────────────────────────────

  Step 1: Insert logger import
  Step 2: Add logging statement to authenticate()

─────────────────────────────────────────
  Changes:
─────────────────────────────────────────

  --- src/middleware/auth.ts
  +++ src/middleware/auth.ts
  @@ -1,4 +1,5 @@
   import { Request, Response, NextFunction } from 'express'
  +import { logger } from '../utils/logger'

   export function authenticate(req: Request, res: Response, next: NextFunction) {
  @@ -8,6 +9,7 @@
   export function authenticate(req: Request, res: Response, next: NextFunction) {
     const token = req.headers.authorization
  +  logger.info('Auth request received', { path: req.path })
     if (!token) {

  1 file changed, 2 insertions(+)

  ✓ Tests passed (npm test)

  Apply changes? [Y/n/edit]
```

---

## 7. Tool System Design

### 7.1 Tool Definition Format

Each tool is a self-contained module exporting a `ToolDefinition`:

```typescript
// src/tools/definitions/search-code.ts

import { ToolDefinition, ToolResult } from '../registry'
import { execFileSync } from 'child_process'

export const searchCodeTool: ToolDefinition = {
  name: 'search_code',
  description: 'Search code using ripgrep. Returns matching lines with file paths and line numbers.',
  category: 'search',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (regex supported)' },
      path: { type: 'string', description: 'Directory or file to search in', default: '.' },
      file_type: { type: 'string', description: 'File type filter (e.g., "ts", "py")' },
      max_results: { type: 'number', description: 'Maximum results to return', default: 20 },
    },
    required: ['pattern'],
  },

  async handler(args): Promise<ToolResult> {
    const rgArgs = ['--line-number', '--no-heading', '--max-count', String(args.max_results ?? 20)]

    if (args.file_type) rgArgs.push('--type', String(args.file_type))
    rgArgs.push(String(args.pattern), String(args.path ?? '.'))

    try {
      const output = execFileSync('rg', rgArgs, { encoding: 'utf-8', maxBuffer: 1024 * 1024 })
      return { success: true, output }
    } catch (err: unknown) {
      // rg exits with code 1 when no matches found
      if ((err as { status?: number }).status === 1) {
        return { success: true, output: 'No matches found.' }
      }
      return { success: false, output: '', error: String(err) }
    }
  },
}
```

### 7.2 Built-in Tools

| Tool | Category | Description |
|---|---|---|
| `search_code` | search | Ripgrep-based code search |
| `read_file` | read | Read file contents (with optional line range) |
| `list_files` | read | List directory contents (recursive optional) |
| `write_file` | write | Write content to a file |
| `apply_edit` | write | Apply a structured edit operation |
| `run_command` | shell | Execute allow-listed shell commands |
| `git_query` | git | Read-only git operations (log, diff, status, blame) |
| `git_mutate` | git | Write git operations (commit, branch, checkout) |

### 7.3 Tool Registration

```typescript
// src/tools/registry.ts — initialization

export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(searchCodeTool)
  registry.register(readFileTool)
  registry.register(listFilesTool)
  registry.register(writeFileTool)
  registry.register(applyEditTool)
  registry.register(runCommandTool)
  registry.register(gitQueryTool)
  registry.register(gitMutateTool)
  return registry
}
```

### 7.4 MCP Tool Integration

MCP tools from connected servers are registered dynamically at startup:

```typescript
// In orchestrator initialization
const mcpTools = await mcpManager.discoverTools()
for (const tool of mcpTools) {
  registry.register({
    name: `mcp__${tool.serverName}__${tool.name}`,
    description: tool.description,
    inputSchema: tool.inputSchema,
    category: 'read',  // MCP tools are read-only by default
    handler: (args) => mcpManager.executeTool(tool.serverName, tool.name, args),
  })
}
```

---

## 8. Model Routing for Agent Phases

Different phases have different complexity requirements. The agent selects the appropriate model per phase:

| Phase | Default Model | Rationale |
|---|---|---|
| ANALYZE (tool selection) | Local (small) | Structured output, small action space |
| PLAN (edit planning) | Local (medium) or Claude | Depends on task complexity |
| EXECUTE (code generation) | Local (medium) or Claude | Route based on plan complexity |
| VALIDATE | No LLM | Deterministic (run tests) |
| PRESENT | No LLM | Deterministic (render diffs) |

### Routing Rules for Agent Phases

```typescript
// Within CodingAgent
private selectModelForPhase(phase: AgentPhase, plan?: EditPlan): 'local' | 'claude' {
  // ANALYZE always uses local — just tool selection
  if (phase === 'analyze') return 'local'

  // VALIDATE and PRESENT don't use LLMs
  if (phase === 'validate' || phase === 'present') return 'local'

  // PLAN and EXECUTE: route based on complexity
  if (plan) {
    // Multi-file changes or >3 steps → Claude
    const uniqueFiles = new Set(plan.steps.map(s => s.file))
    if (uniqueFiles.size > 2 || plan.steps.length > 3) return 'claude'
  }

  // Use existing router for the original prompt
  return this.routeDecision.agent
}
```

This means most simple edits (single file, 1-2 changes) stay fully local, while complex multi-file refactors automatically escalate to Claude.

---

## 9. Config Schema Additions

```typescript
// Additions to src/config/schema.ts

const AgentConfigSchema = z.object({
  max_iterations: z.number().min(1).max(10).default(5),
  auto_confirm: z.boolean().default(false),
  show_plan: z.boolean().default(true),
  run_validation: z.boolean().default(true),
  validation_command: z.string().optional(),  // e.g., "npm test"
})

const SafetyConfigSchema = z.object({
  always_confirm: z.array(z.string()).default([]),
  auto_approve: z.array(z.string()).default(['read_file', 'search_code', 'list_files', 'git_query']),
  allowed_write_paths: z.array(z.string()).default(['.']),
})

const EditorConfigSchema = z.object({
  show_diff: z.boolean().default(true),
  color_diff: z.boolean().default(true),
  backup_before_edit: z.boolean().default(true),
})

// Added to main ConfigSchema
const ConfigSchema = z.object({
  // ... existing fields ...
  agent: AgentConfigSchema.default({}),
  safety: SafetyConfigSchema.default({}),
  editor: EditorConfigSchema.default({}),
})
```

```yaml
# locode.yaml additions

agent:
  max_iterations: 5
  auto_confirm: false
  show_plan: true
  run_validation: true
  validation_command: "npm test"

safety:
  always_confirm:
    - git_mutate
    - write_file
  auto_approve:
    - read_file
    - search_code
    - list_files
    - git_query
  allowed_write_paths:
    - src/
    - tests/

editor:
  show_diff: true
  color_diff: true
  backup_before_edit: true
```

---

## 10. Integration with Existing Code

### 10.1 Orchestrator Changes

The `Orchestrator` gains a new mode: when the routing decision indicates a coding task, it delegates to `CodingAgent` instead of directly calling `LocalAgent` or `ClaudeAgent`.

```typescript
// src/orchestrator/orchestrator.ts — modified process()

async process(prompt: string, previousSummary?: string): Promise<OrchestratorResult> {
  // ... existing routing logic ...

  const route = await this.router.classify(enrichedPrompt)

  // NEW: check if this is an agent-mode task
  if (this.isCodingTask(prompt, route)) {
    return this.runCodingAgent(prompt, route)
  }

  // ... existing agent dispatch ...
}

private isCodingTask(prompt: string, route: RouteDecision): boolean {
  // Coding tasks: modify code, add features, fix bugs, refactor
  // Non-coding tasks: questions, explanations, git queries, searches
  const codingPatterns = /\b(add|fix|implement|refactor|change|update|modify|create|write|delete|remove)\b/i
  return codingPatterns.test(prompt)
}

private async runCodingAgent(prompt: string, route: RouteDecision): Promise<OrchestratorResult> {
  const agent = new CodingAgent(
    this.localAgent,
    this.localOnly ? null : this.claudeAgent,
    this.toolExecutor,
    this.codeEditor,
    this.memory,
    this.config.agent,
  )

  const result = await agent.run(prompt)

  // Track tokens
  this.tracker.record({
    agent: result.agent,
    inputTokens: result.tokensUsed.input,
    outputTokens: result.tokensUsed.output,
    model: result.agent === 'local' ? this.config.local_llm.model : this.config.claude.model,
  })

  return {
    content: result.diffs.join('\n'),
    summary: `Applied ${result.edits.length} edits to ${new Set(result.edits.map(e => e.file)).size} files`,
    inputTokens: result.tokensUsed.input,
    outputTokens: result.tokensUsed.output,
    agent: result.agent as AgentType,
    routeMethod: route.method,
    reason: route.reason,
  }
}
```

### 10.2 LocalAgent Changes

The `LocalAgent` gains a dependency on `ToolExecutor` instead of directly dispatching tools:

```typescript
// src/agents/local.ts — modified constructor

constructor(
  private config: Config,
  private toolExecutor?: ToolExecutor,  // NEW: optional, backward-compatible
) {}

// Modified tool dispatch
private async dispatchTool(name: string, args: Record<string, string>): Promise<string> {
  if (this.toolExecutor) {
    const result = await this.toolExecutor.execute({ tool: name, args })
    return result.output
  }
  // ... existing switch/case fallback for backward compatibility ...
}
```

### 10.3 REPL Integration

The REPL detects coding tasks and enters "agent mode" with streaming output:

```typescript
// src/cli/repl.ts — modified processInput()

if (isCodingTask(input)) {
  // Agent mode: show streaming progress
  const renderer = new StreamRenderer(agent.stream)
  renderer.start()
  const result = await orchestrator.process(input, previousSummary)
  renderer.stop()
} else {
  // Chat mode: existing behavior
  const result = await orchestrator.process(input, previousSummary)
  console.log(result.content)
}
```

---

## 11. Example Workflows

### 11.1 Simple Local Edit

```
User: "Add logging to the auth middleware"

Phase: ANALYZE (local LLM, ~200ms)
  → search_code("auth.*middleware", file_type: "ts")
  → Found: src/middleware/auth.ts
  → read_file("src/middleware/auth.ts")

Phase: PLAN (local LLM, ~500ms)
  Plan:
  1. Insert logger import at top of file
  2. Add logging statement in authenticate()

Phase: EXECUTE (local LLM, ~800ms)
  → apply_edit({ file: "src/middleware/auth.ts", operation: "insert", afterLine: 1,
     content: "import { logger } from '../utils/logger'" })
  → apply_edit({ file: "src/middleware/auth.ts", operation: "insert", afterLine: 10,
     content: "logger.info('Auth request', { path: req.path })" })

Phase: VALIDATE (~2s)
  → run_command("npm test") → ✓ passed

Phase: PRESENT
  → Show unified diff
  → "Apply changes? [Y/n]"

Total: ~3.5s, 0 Claude tokens
```

### 11.2 Complex Multi-File Refactor (Escalates to Claude)

```
User: "Refactor the tool system to use a registry pattern"

Phase: ANALYZE (local LLM, ~300ms)
  → search_code("tool|dispatch", file_type: "ts")
  → read_file("src/tools/shell.ts")
  → read_file("src/tools/git.ts")
  → read_file("src/agents/local.ts")  — contains dispatchTool()
  → git_query("log --oneline -5 src/tools/")

Phase: PLAN (Claude, ~2s) — escalated due to multi-file scope
  Plan:
  1. Create src/tools/registry.ts with ToolRegistry class
  2. Create tool definition files for each existing tool
  3. Modify local.ts to use ToolExecutor
  4. Update orchestrator to initialize registry

Phase: EXECUTE (Claude, ~5s) — 4 files, complex changes
  → create "src/tools/registry.ts"
  → create "src/tools/definitions/shell.ts"
  → create "src/tools/definitions/git.ts"
  → modify "src/agents/local.ts" — replace dispatchTool

Phase: VALIDATE (~3s)
  → run_command("npm test") → ✗ failed
  → Error: "Cannot find module '../tools/registry'"

  Loop back to PLAN (iteration 2):
  → Fix: update import path

Phase: EXECUTE (iteration 2)
  → modify import in local.ts

Phase: VALIDATE
  → run_command("npm test") → ✓ passed

Phase: PRESENT
  → Show diffs for 4 files
  → "Apply changes? [Y/n]"

Total: ~12s, Claude used for plan + execute only
```

### 11.3 Question (Non-Agent Path)

```
User: "How does the router work?"

→ Router classifies as "local" (question pattern)
→ NOT a coding task — no agent mode
→ Direct to LocalAgent chat (existing behavior)
→ Response: explanation of router logic

Total: ~1s, existing path unchanged
```

---

## 12. Performance Considerations for Local LLMs

### 12.1 Prompt Size Management

Local LLMs have small context windows (2048-4096 tokens typical for Qwen 8B). Every prompt must be compact.

| Phase | Max Prompt Tokens | Strategy |
|---|---|---|
| ANALYZE | ~500 | Short system prompt + user request + tool list |
| PLAN | ~1500 | Request + truncated file contents + memory summary |
| EXECUTE | ~1000 | Plan step + target file section only |
| Total per iteration | ~3000 | Well within 4096 context window |

```typescript
// Prompt budget constants
const PROMPT_BUDGETS = {
  analyze: { system: 200, user: 200, tools: 100 },   // ~500 total
  plan: { system: 200, context: 1000, memory: 100, user: 200 },  // ~1500 total
  execute: { system: 200, plan: 200, file: 500, user: 100 },     // ~1000 total
} as const
```

### 12.2 Latency Optimization

```
Target: <3s for simple edits, <10s for complex multi-file changes

Techniques:
├── Parallel tool execution in ANALYZE phase
│   search + read can run concurrently → saves ~200ms
│
├── Small, focused prompts per phase
│   Each LLM call gets minimal context → faster generation
│
├── JSON mode for structured output
│   Constrains generation, reduces output tokens → ~30% faster
│
├── Memory-based context reuse
│   Skip re-reading files already in memory → saves I/O + tokens
│
├── Early termination
│   If plan has 0 steps → skip EXECUTE/VALIDATE → instant response
│
└── Streaming
    User sees progress immediately → perceived latency near zero
```

### 12.3 Token Budget Tracking

Every agent iteration tracks tokens consumed:

```typescript
interface IterationTokens {
  phase: AgentPhase
  model: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
}
```

Logged to the existing `TokenTracker` for cost analysis. The agent emits per-phase token counts so users can see exactly where tokens are spent.

### 12.4 Caching

```
Cache Layer          What's Cached              Lifetime
─────────────────────────────────────────────────────────
AgentMemory          Recent file contents        Session
                     Recent search results       Session
                     Recent edit history          Session
```

v0.5 will add persistent caching (file tree index, symbol index, embeddings). For v0.4, session-level memory is sufficient.

---

## 13. Implementation Phases

### Phase 1: Tool System Foundation (Week 1)

**Goal:** Extract tools from LocalAgent into a proper registry + executor.

Files:
- `src/tools/registry.ts` + test
- `src/tools/executor.ts` + test
- `src/tools/safety-gate.ts` + test
- `src/tools/definitions/*.ts` (migrate existing tools)

Integration:
- Wire `ToolExecutor` into `LocalAgent` (backward-compatible)
- All existing tests must pass

### Phase 2: Code Editor + Diff Renderer (Week 2)

**Goal:** Structured edit application and diff display.

Files:
- `src/editor/code-editor.ts` + test
- `src/editor/diff-renderer.ts` + test
- `src/editor/types.ts`

Dependencies: None (pure TypeScript, use built-in `diffLines` or minimal diff library)

### Phase 3: Agent Memory + Planner (Week 2-3)

**Goal:** Session memory and edit planning.

Files:
- `src/agent/memory.ts` + test
- `src/agent/planner.ts` + test
- `src/agent/types.ts`

### Phase 4: Coding Agent + Streaming (Week 3-4)

**Goal:** The full agent loop with streaming output.

Files:
- `src/agent/coding-agent.ts` + test
- `src/agent/stream.ts`

Integration:
- Modify `Orchestrator.process()` to detect coding tasks
- Modify `repl.ts` for agent mode rendering

### Phase 5: Config + Polish (Week 4)

**Goal:** Config schema additions, locode.yaml defaults, documentation.

Files:
- Update `src/config/schema.ts`
- Update `locode.yaml`
- Update `CLAUDE.md` with new architecture notes

---

## 14. External Dependencies

| Dependency | Purpose | Type |
|---|---|---|
| `diff` (npm) | Generate unified diffs | Pure JS, lightweight |
| `chalk` (already installed) | Colorize diff output | Already in project |

No new native dependencies. Tree-sitter (WASM) and embedding models are deferred to v0.5.

Ripgrep (`rg`) is used via `execFileSync` — it's expected to be installed on the developer's machine (standard dev tool). The `search_code` tool falls back to `grep` if `rg` is not available.

---

## 15. Testing Strategy

Each module has co-located tests using vitest + vi.mock():

| Module | Test Strategy |
|---|---|
| `ToolRegistry` | Unit: register, get, validate, listForLLM |
| `ToolExecutor` | Unit: mock registry + safety gate, test dispatch |
| `SafetyGate` | Unit: test allow/deny decisions against config |
| `CodeEditor` | Unit: apply edits to in-memory strings, verify output |
| `DiffRenderer` | Unit: known input → expected diff output |
| `AgentMemory` | Unit: record, getSnapshot, toPromptContext, max entries |
| `Planner` | Unit: mock LLM responses, verify plan parsing |
| `CodingAgent` | Integration: mock LLM + tools, test full loop |

External dependencies (Ollama, Anthropic SDK, filesystem for writes) are mocked. The `CodeEditor` tests use temporary directories for filesystem integration tests.

---

## 16. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Local LLM generates invalid edit JSON | High | Medium | Schema validation + 3 retries (free compute) |
| Edit applies to wrong line (off-by-one) | Medium | High | Content-based matching as fallback; backup + rollback |
| Agent loops indefinitely | Low | High | Max iterations config (default 5) |
| Large files exceed context window | Medium | Medium | Truncation to 2000 tokens per file; line-range extraction |
| Tests fail after valid edit | Medium | Low | Show error, loop back to plan (up to max iterations) |

---

## 17. Success Metrics

| Metric | Target |
|---|---|
| Simple edit latency (single file) | < 3s end-to-end |
| Complex edit latency (multi-file) | < 15s end-to-end |
| Edit success rate (no validation failures) | > 80% for single-file edits |
| Token savings vs. direct Claude | > 60% for simple edits |
| Zero Claude tokens for simple edits | 100% of single-file, single-change tasks |
