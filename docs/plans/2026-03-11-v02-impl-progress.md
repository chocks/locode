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
| 3 | — | `SafetyGate` + config schema additions | ⬜ Not started |
| 4 | — | `ToolExecutor` (ties registry + safety) | ⬜ Not started |
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
