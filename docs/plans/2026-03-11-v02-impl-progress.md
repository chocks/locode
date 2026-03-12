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
| 5 | — | Wire into `LocalAgent` + `Orchestrator` | ⬜ Not started |
| 6 | — | New tools (`search_code`, `list_files`) | ⬜ Not started |

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
