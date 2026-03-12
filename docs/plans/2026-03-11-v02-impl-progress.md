# v0.2 Tool Foundation — Implementation Progress

**Started:** 2026-03-11
**Design:** [v0.2 Tool Foundation](2026-03-10-v02-tool-foundation.md)
**Approach:** Incremental PRs, each independently mergeable

---

## PR Plan

| # | Branch | Scope | Status |
|---|--------|-------|--------|
| 1 | `feat/v02-tool-registry` | `ToolRegistry` + `ToolDefinition` + `ToolResult` interfaces | ✅ Done |
| 2 | — | Migrate existing tools to `definitions/` format | ⬜ Not started |
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
