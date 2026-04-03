# Locode — Agent Guidelines

This file describes how AI agents (Claude Code, Locode itself, or any other coding agent) should work within this repository.

## Project Overview

Locode is a TypeScript/Node.js CLI that routes coding tasks between a local Ollama LLM and Claude based on task complexity. The core value prop is token cost reduction — simple tasks (grep, file reads, shell) go to the local model; complex tasks (refactoring, code generation) go to Claude.

## Architecture

```
User Input → Orchestrator → Router → LocalAgent (Ollama) or ClaudeAgent (Anthropic SDK)
                                  ↓
                            TokenTracker → session stats
```

Key files:
- `src/orchestrator/orchestrator.ts` — main entry point for task processing
- `src/orchestrator/router.ts` — rule-based + LLM fallback routing
- `src/agents/local.ts` — Ollama client
- `src/agents/claude.ts` — Anthropic SDK client
- `src/tools/` — safe read-only tools (shell allow-list, git allow-list)
- `src/config/schema.ts` — Zod config schema (source of truth for config shape)
- `src/cli/setup.ts` — first-run wizard, API key storage

## Development Rules

### Testing
- Always follow TDD: write failing test → run to confirm → implement → confirm pass
- Run `npm test` before every commit — all tests must pass
- Run `npm run build` to catch TypeScript errors before committing
- Never mock real behavior away in tests; mock only external I/O (Ollama, Anthropic API)
- Tests must call the real function, not reimplement its logic — if a function is hard to test, make it accept parameters (e.g., `loadEnvFile(path)`) rather than duplicating its internals
- Mock names must match the actual registry (e.g., use `run_command` not `shell`)
- Assert behavior and outcomes, not implementation details

### Security
- `src/tools/shell.ts` uses an **allow-list** (`ALLOWED_COMMANDS` Set) — do NOT switch to a deny-list
- `src/tools/git.ts` uses `execFileSync` (not `execSync`) to prevent shell injection
- API keys are stored in `~/.locode/.env` with mode `0600` — never log or expose them
- Never pass user input directly to shell commands
- Path containment checks must use `path === base || path.startsWith(base + path.sep)` — bare `startsWith(base)` allows sibling-directory traversal
- Avoid regex patterns with overlapping alternations — CodeQL flags these as backtracking vulnerabilities on every PR

### Config changes
- All config changes must go through `src/config/schema.ts` (Zod schema) first — it is the single source of truth for default values
- If you add a config field, ensure it is actually read somewhere — dead config fields are not allowed
- `locode.yaml` and `setup.ts` CONFIG_TEMPLATE must agree with the Zod defaults in `schema.ts` — when changing a default, update the schema first, then sync the others

### Adding commands
- New CLI commands go in `src/cli/` and are registered in `src/index.ts`
- Follow the pattern: dedicated file per command, import and register in index

### Routing
- New task categories → add to `routing.rules` in `locode.yaml`
- Pattern format is a regex string matched case-insensitively against the user prompt
- When in doubt, route to `local` (saves tokens, safe default)

## Running the Project

```bash
npm install          # install dependencies
npm run dev          # run with ts-node (no build)
npm test             # run test suite
npm run build        # compile to dist/
node dist/index.js   # run compiled CLI
```

## What NOT to do

- Do not add new npm dependencies without considering bundle size
- Do not use `execSync` with shell strings — use `execFileSync` with arg arrays
- Do not hardcode model names — always read from `config.local_llm.model` or `config.claude.model`
- Do not break the `isLocalOnly()` fallback — it must work when `ANTHROPIC_API_KEY` is absent
- Do not add config fields that are never read
