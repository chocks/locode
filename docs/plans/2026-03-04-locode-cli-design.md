# Locode CLI — Design Document
**Date:** 2026-03-04

## Overview

Locode is a local-first AI coding CLI that routes tasks between a local LLM (Ollama) and Claude based on task complexity. The primary goal is measurable token cost reduction while maintaining a developer experience on par with Claude Code.

---

## Goals

- Route simple tasks (file ops, grep, shell, repo exploration) to a local LLM
- Route complex tasks (refactoring, architecture, code generation) to Claude
- Provide a REPL-first interface identical in feel to Claude Code
- Track token usage per session and prove cost savings via a benchmark harness

---

## Architecture: Thin Orchestrator

```
User Input (REPL / single-shot)
        │
        ▼
  ┌─────────────┐
  │ Orchestrator│  ← reads locode.yaml
  │   Router    │  ← YAML rules first, local LLM resolves ambiguous tasks
  └──────┬──────┘
         │
   ┌─────┴──────┐
   ▼            ▼
Local Agent   Claude Agent
(Ollama)      (Anthropic SDK)
read + shell  full tools
   │            │
   └─────┬──────┘
         ▼
  Token Tracker
  (logs per-turn usage)
         │
         ▼
  REPL Output + Session Stats
```

**Context handoff:** Local agent runs the task and produces a structured summary. If escalated to Claude, that summary is prepended as context — not the raw conversation — to minimize tokens sent.

---

## Project Structure

```
locode/
├── src/
│   ├── cli/          # REPL entry point, single-shot mode
│   ├── orchestrator/ # Router, YAML config loader, escalation logic
│   ├── agents/
│   │   ├── local.ts  # Ollama client
│   │   └── claude.ts # Anthropic SDK client
│   ├── tools/        # File read, shell commands, git (local agent only)
│   ├── tracker/      # Token usage logger
│   └── config/       # locode.yaml schema + defaults
├── benchmark/
│   ├── runner.ts     # Runs task against Claude Code + Locode
│   ├── tasks/        # Benchmark task definitions (e.g. todo-webapp.md)
│   ├── parsers/
│   │   ├── claudecode.ts
│   │   └── locode.ts
│   └── report/
│       ├── template.html
│       └── generate.ts
├── locode.yaml       # Default config
├── package.json
└── tsconfig.json
```

---

## Routing Config (`locode.yaml`)

```yaml
local_llm:
  provider: ollama
  model: qwen2.5-coder:7b
  base_url: http://localhost:11434

claude:
  model: claude-sonnet-4-6

routing:
  rules:
    - pattern: "find|grep|search|ls|cat|read|explore|where is"
      agent: local
    - pattern: "git log|git diff|git status|git blame"
      agent: local
    - pattern: "refactor|architect|design|explain|review|generate|write tests"
      agent: claude
  ambiguous_resolver: local   # local LLM decides when no rule matches
  escalation_threshold: 0.7   # confidence below this → escalate to Claude

context:
  handoff: summary            # local summarizes before escalating
  max_summary_tokens: 500

token_tracking:
  enabled: true
  log_file: ~/.locode/usage.log
```

---

## Agent Capabilities

| Capability | Local Agent | Claude Agent |
|---|---|---|
| File read | ✓ | ✓ |
| Shell commands | ✓ | ✓ |
| Git queries | ✓ | ✓ |
| File write | ✗ | ✓ |
| Code generation | limited | ✓ |
| Refactoring | ✗ | ✓ |

---

## Benchmark & Measurement Framework

**Benchmark task:** Build a simple todo webapp (React + Express) — deterministic enough for fair comparison.

**Runner:** Executes the same task prompt via Claude Code CLI and Locode CLI in sequence, capturing stdout and token metadata per turn.

**Report (static HTML):**

| Metric | Claude Code | Locode | Saved |
|---|---|---|---|
| Input tokens | — | — | — |
| Output tokens | — | — | — |
| Estimated cost ($) | — | — | — |
| Tasks routed local | — | x/total | — |

Report saved to `./locode-benchmark-report.html` and auto-opens in browser on completion.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| Runtime | Node.js |
| Local LLM | Ollama (`ollama` npm client) |
| Claude | `@anthropic-ai/sdk` |
| CLI framework | TBD (Ink or Commander) |
| Config | YAML (`js-yaml`) |
| Report templating | Handlebars |
| Distribution | npm (`npx locode`) |

---

## Success Metric

Primary: **% of tasks routed to local LLM** and **total token cost reduction** vs. using Claude for everything, measured via the benchmark harness.
