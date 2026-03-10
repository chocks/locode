# Locode v0.2 — Tool Foundation

**Date:** 2026-03-10
**Status:** Proposed
**Scope:** Extract ad-hoc tool dispatch into a modular registry + executor with safety checks
**Depends on:** v0.1 (current — routing CLI)

---

## 1. Goal

Replace the hardcoded `dispatchTool()` switch/case in `LocalAgent` with a proper tool system that v0.3's coding agent can build on. No new user-facing features — this is infrastructure.

---

## 2. What Changes

| Before (v0.1) | After (v0.2) |
|---|---|
| Tools defined inline in `local.ts` as Ollama schemas | Tools are self-contained modules in `src/tools/definitions/` |
| Tool dispatch via switch/case in `dispatchTool()` | Central `ToolExecutor` dispatches via `ToolRegistry` |
| No safety checks on tool execution | `SafetyGate` validates before execution |
| Shell allow-list is the only protection | Config-driven safety: per-tool confirmation, path restrictions |
| MCP tools registered separately in `McpManager` | MCP tools register into the same `ToolRegistry` |

---

## 3. Architecture

```
ToolCall (from LLM or agent)
    │
    ▼
┌──────────────────────┐
│   Tool Executor       │
│                       │
│   1. Validate args    │ ← against ToolDefinition.inputSchema
│   2. Safety check     │ ← SafetyGate (config-driven)
│   3. Execute handler  │ ← ToolDefinition.handler()
│   4. Return result    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│   Tool Registry       │
│                       │
│   Built-in tools:     │
│   ├── search_code     │ ← ripgrep wrapper (NEW)
│   ├── read_file       │ ← from readFile.ts
│   ├── list_files      │ ← NEW
│   ├── run_command     │ ← from shell.ts
│   ├── git_query       │ ← from git.ts
│   └── write_file      │ ← NEW (gated by safety)
│                       │
│   MCP tools:          │
│   └── mcp__*          │ ← dynamic from McpManager
└──────────────────────┘
```

---

## 4. New Files

```
src/tools/
├── registry.ts           # ToolRegistry class
├── registry.test.ts
├── executor.ts           # ToolExecutor class
├── executor.test.ts
├── safety-gate.ts        # SafetyGate class
├── safety-gate.test.ts
├── definitions/          # Individual tool modules
│   ├── search-code.ts    # ripgrep wrapper
│   ├── read-file.ts      # migrated from readFile.ts
│   ├── list-files.ts     # directory listing
│   ├── write-file.ts     # controlled file writes
│   ├── run-command.ts    # migrated from shell.ts
│   └── git-query.ts      # migrated from git.ts
├── index.ts              # Barrel export (updated)
├── shell.ts              # KEPT — re-exports for backward compat
├── git.ts                # KEPT — re-exports for backward compat
└── readFile.ts           # KEPT — re-exports for backward compat
```

**New files: 12** (including tests). **Modified files: 3** (local.ts, orchestrator.ts, index.ts barrel).

---

## 5. TypeScript Interfaces

### 5.1 Tool Definition

```typescript
// src/tools/registry.ts

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>  // JSON Schema
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
  category: 'read' | 'write' | 'search' | 'git' | 'shell'
  requiresConfirmation?: boolean
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

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  register(tool: ToolDefinition): void
  get(name: string): ToolDefinition | undefined
  list(): ToolDefinition[]
  listForLLM(): OllamaToolSchema[]  // Convert to Ollama function-call format
  validate(name: string, args: Record<string, unknown>): ValidationResult
}

export function createDefaultRegistry(): ToolRegistry
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

  async execute(call: ToolCall): Promise<ToolResult>
  async executeParallel(calls: ToolCall[]): Promise<ToolResult[]>
}
```

### 5.3 Safety Gate

```typescript
// src/tools/safety-gate.ts

export interface SafetyConfig {
  always_confirm: string[]       // tool names that always need confirmation
  auto_approve: string[]         // tool names that never need confirmation
  allowed_write_paths: string[]  // restrict file writes to these dirs
}

export interface SafetyDecision {
  allowed: boolean
  reason: string
  requiresConfirmation: boolean
}

export class SafetyGate {
  constructor(private config: SafetyConfig) {}

  check(call: ToolCall): SafetyDecision
  async confirm(call: ToolCall, reason: string): Promise<boolean>
}
```

---

## 6. Config Schema Additions

```typescript
// Added to src/config/schema.ts

const SafetyConfigSchema = z.object({
  always_confirm: z.array(z.string()).default([]),
  auto_approve: z.array(z.string()).default([
    'read_file', 'search_code', 'list_files', 'git_query'
  ]),
  allowed_write_paths: z.array(z.string()).default(['.']),
})
```

```yaml
# locode.yaml additions

safety:
  always_confirm: []
  auto_approve:
    - read_file
    - search_code
    - list_files
    - git_query
  allowed_write_paths:
    - "."
```

---

## 7. Integration Points

### LocalAgent

```typescript
// src/agents/local.ts — modified

class LocalAgent {
  constructor(
    private config: Config,
    private toolExecutor?: ToolExecutor,  // NEW: optional for backward compat
  ) {}

  private async dispatchTool(name: string, args: Record<string, string>): Promise<string> {
    if (this.toolExecutor) {
      const result = await this.toolExecutor.execute({ tool: name, args })
      return result.success ? result.output : `Error: ${result.error}`
    }
    // Existing switch/case fallback (removed in v0.3)
    switch (name) { /* ... */ }
  }
}
```

### Orchestrator

```typescript
// src/orchestrator/orchestrator.ts — modified

class Orchestrator {
  private toolExecutor: ToolExecutor  // NEW

  constructor(config: Config) {
    const registry = createDefaultRegistry()
    const safetyGate = new SafetyGate(config.safety)
    this.toolExecutor = new ToolExecutor(registry, safetyGate)
    this.localAgent = new LocalAgent(config, this.toolExecutor)
    // ... rest unchanged
  }
}
```

### MCP Integration

```typescript
// In orchestrator.initMcp()
const mcpTools = await mcpManager.discoverTools()
for (const tool of mcpTools) {
  this.toolExecutor.registry.register({
    name: `mcp__${tool.serverName}__${tool.name}`,
    description: tool.description,
    inputSchema: tool.inputSchema,
    category: 'read',
    handler: (args) => mcpManager.executeTool(tool.serverName, tool.name, args),
  })
}
```

---

## 8. Tool Migration Plan

| Old Location | New Location | Changes |
|---|---|---|
| `src/tools/shell.ts` → `shellTool()` | `src/tools/definitions/run-command.ts` | Wrap in `ToolDefinition` format |
| `src/tools/git.ts` → `gitTool()` | `src/tools/definitions/git-query.ts` | Wrap in `ToolDefinition` format |
| `src/tools/readFile.ts` → `readFileTool()` | `src/tools/definitions/read-file.ts` | Wrap in `ToolDefinition` format |
| Inline Ollama tool schemas in `local.ts` | Generated by `registry.listForLLM()` | Delete inline schemas |

Old files kept as re-exports so any external consumers don't break. Removed in v0.3.

---

## 9. Testing Strategy

| Module | What to Test |
|---|---|
| `ToolRegistry` | register, get, list, listForLLM, validate (valid + invalid args) |
| `ToolExecutor` | dispatch to correct handler, handle validation failure, handle safety block |
| `SafetyGate` | auto_approve allows, always_confirm blocks, path restriction works |
| Each tool definition | Handler returns expected output for known input |
| Integration | LocalAgent → ToolExecutor → Registry → handler chain works end-to-end |

All external deps (filesystem, child_process, Ollama) mocked with `vi.mock()`.

---

## 10. What This Enables

v0.2 is pure infrastructure. No new user-facing behavior. But it unblocks:

- **v0.3**: CodingAgent uses `ToolExecutor` for all tool calls during plan→edit→validate
- **v0.4**: Codebase indexer registers `index_search` and `symbol_lookup` as tools
- **v0.5**: Workflow engine uses `ToolExecutor` with per-step tool restrictions

---

## 11. Success Criteria

- [ ] All existing tests pass (zero regressions)
- [ ] `npm run build` succeeds
- [ ] `LocalAgent` dispatches tools through `ToolExecutor` when provided
- [ ] `SafetyGate` blocks `write_file` outside configured paths
- [ ] `ToolRegistry.listForLLM()` produces valid Ollama function-call schemas
- [ ] MCP tools register into the same registry
- [ ] New `search_code` tool wraps ripgrep successfully
