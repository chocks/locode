# v0.2 Tool Foundation — Implementation Progress

**Started:** 2026-03-11
**Design:** [v0.2 Tool Foundation](2026-03-10-v02-tool-foundation.md)
**Approach:** Incremental PRs, each independently mergeable

---

## PR Plan

| # | Branch | Scope | Status |
|---|--------|-------|--------|
| 1 | `feat/v02-tool-registry` | `ToolRegistry` + `ToolDefinition` + `ToolResult` interfaces | ✅ Done |
| 2 | `feat/v02-tool-definitions` | Migrate existing tools to `definitions/` format | ✅ Done |
| 3 | `feat/v02-safety-gate` | `SafetyGate` + config schema additions | ✅ Done |
| 4 | `feat/v02-tool-executor` | `ToolExecutor` (ties registry + safety) | ✅ Done |
| 5 | `feat/v02-wire-executor` | Wire into `LocalAgent` + `Orchestrator` | ✅ Done |
| 6 | `feat/v02-list-files` | `list_files` tool (`search_code` dropped — `grep -rn` too slow, agents can use `run_command`) | ✅ Done |

---

## PR 1: ToolRegistry + Interfaces

**Files:**
- `src/tools/registry.ts` — `ToolRegistry` class, `ToolDefinition`, `ToolResult`, `ValidationResult` interfaces
- `src/tools/registry.test.ts` — unit tests

**Interfaces:**
- `ToolDefinition` — name, description, inputSchema, handler, category
- `ToolResult` — success, output, error, metadata
- `ValidationResult` — valid, errors[]
- `ToolRegistry` — register, get, list, listForLLM, listForClaude, validate

**Notes:**
- Pure additions — nothing imports these yet
- `listForLLM()` outputs Ollama function-call format
- `listForClaude()` outputs Anthropic tool format
- `validate()` checks required fields from inputSchema

## PR 2: Migrate Existing Tools to Definitions

**Files:**
- `src/tools/definitions/read-file.ts` — wraps `readFileTool`
- `src/tools/definitions/run-command.ts` — wraps `shellTool`
- `src/tools/definitions/git-query.ts` — wraps `gitTool`
- `src/tools/definitions/write-file.ts` — wraps `writeFileTool`
- `src/tools/definitions/edit-file.ts` — wraps `editFileTool`
- `src/tools/definitions/default-registry.ts` — `createDefaultRegistry()` factory
- `src/tools/definitions/definitions.test.ts` — handler tests
- `src/tools/definitions/default-registry.test.ts` — factory tests

**Approach:**
- Each definition delegates to the existing tool function (no logic duplication)
- Returns `ToolResult` instead of plain strings
- Write tools (`write_file`, `edit_file`) have `requiresConfirmation: true`
- Original tool files kept — removed when agents switch to registry (PR 5)
- `createDefaultRegistry()` registers all 5 built-in tools

## PR 3: SafetyGate + Config Schema

**Files:**
- `src/tools/safety-gate.ts` — `SafetyGate` class, `SafetyConfig`, `SafetyDecision` interfaces
- `src/tools/safety-gate.test.ts` — 8 unit tests
- `src/config/schema.ts` — added `safety` section with defaults
- `src/config/schema.test.ts` — 2 new tests for safety config defaults

**Behavior:**
- `check(call)` — decides if a tool call needs confirmation based on `auto_approve`/`always_confirm` lists
- `checkWritePath(path)` — validates file write targets against `allowed_write_paths`
- `always_confirm` takes precedence over `auto_approve`
- `"."` in `allowed_write_paths` means project root (cwd)
- Config defaults to sensible values — read tools auto-approved, write paths restricted to project

## PR 4: ToolExecutor

**Files:**
- `src/tools/executor.ts` — `ToolExecutor` class, `ToolCall` interface
- `src/tools/executor.test.ts` — 7 unit tests

**Behavior:**
- `execute(call)` — validate args → check safety → run handler → return result
- `executeParallel(calls)` — runs multiple tool calls concurrently via `Promise.all`
- Write-category tools have their path checked against `SafetyGate.checkWritePath()`
- Handler errors are caught and returned as `ToolResult` failures (never throws)

## PR 5: Wire into LocalAgent + ClaudeAgent + Orchestrator

**Modified files:**
- `src/agents/local.ts` — accepts optional `ToolExecutor`, uses it for schemas + dispatch
- `src/agents/claude.ts` — accepts optional `ToolExecutor`, uses it for schemas + dispatch
- `src/orchestrator/orchestrator.ts` — creates registry → safety gate → executor, passes to agents
- `src/tools/executor.ts` — made `registry` readonly public for schema access

**Wiring:**
- Orchestrator creates `createDefaultRegistry()` → `SafetyGate(config.safety)` → `ToolExecutor`
- Passes executor to both `LocalAgent` and `ClaudeAgent`
- MCP tools now register into the shared registry (instead of separate McpManager path)
- Old inline `dispatchTool()` + `TOOLS` constants kept as fallback when no executor
- `ToolResult` → string adapter: `result.success ? result.output : \`Error: \${result.error}\``

**Tool name changes (when executor active):**
- `shell` → `run_command`
- `git` → `git_query`
- `read_file`, `write_file`, `edit_file` — unchanged

## PR 6: list_files Tool

**Files:**
- `src/tools/definitions/list-files.ts` — `listFilesDefinition` using `fs.readdirSync`
- `src/tools/definitions/definitions.test.ts` — 4 new tests
- `src/tools/definitions/default-registry.ts` — registers `list_files`
- `src/tools/definitions/default-registry.test.ts` — updated count to 6

**Scope change:** `search_code` (ripgrep wrapper) was dropped — `grep -rn` is too slow for agent tool loops, and agents can already use `grep` via `run_command`. May revisit with `rg` as optional dep in v0.3+.

**Also cleaned up:** removed `search_code` from `auto_approve` defaults in `src/config/schema.ts` since the tool doesn't exist.
