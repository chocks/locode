# Router Confidence Fix + Pre-Execution Confirmation

## Problem

1. Router hardcodes confidence to `0.6` — since escalation threshold is `0.7`, every unmatched prompt always escalates to Claude, making the LLM classifier dead code.
2. No user confirmation before agent execution — users can't review or override routing decisions.

## Changes

### 1. LLM Confidence via JSON (`src/orchestrator/router.ts`)

- Change `AmbiguousResolver` return type from `AgentType` to `{ agent: AgentType; confidence: number }`
- Update `defaultResolver` prompt to request JSON: `{"agent": "local", "confidence": 0.85}`
- Parse JSON response with fallback (`{ agent: 'local', confidence: 0.5 }` on parse failure)
- Use parsed confidence in `classify()` instead of hardcoded `0.6`
- Rule-matched routes keep `confidence: 1.0`

### 2. Split Orchestrator Route/Execute (`src/orchestrator/orchestrator.ts`)

- Extract routing logic from `process()` into `route(prompt): Promise<RouteDecision>`
- Extract agent execution into `execute(prompt, agent, previousSummary?): Promise<OrchestratorResult>`
- `process()` remains as a convenience that calls both (used by `run` command)

### 3. Pre-Execution Confirmation (`src/cli/repl.ts`)

- After `route()` returns, display decision to user
- Prompt: `Proceed? [Y/n/s(witch)]`
  - Enter/Y: proceed with chosen agent
  - n: cancel, return to prompt
  - s: switch to the other agent
- Skip confirmation for `--local-only` and `--claude-only` modes
- Skip confirmation for rule-matched routes (confidence 1.0)

### 4. Out of Scope

- Per-tool-call confirmation (future work)
- Changes to token tracking, fallback, MCP
- Changes to `locode.yaml` schema
