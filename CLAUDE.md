# Locode — Claude Code Instructions

## Project

TypeScript CLI that routes tasks between Ollama (local LLM) and Claude based on task complexity. Goal: measurable token savings.

## Essential Commands

```bash
npm install          # install deps
npm test             # run vitest (must pass before any commit)
npm run build        # tsc compile → dist/
npm run dev          # ts-node src/index.ts (no build needed)
./dist/src/index.js  # run compiled CLI (after build)
```

## Dev Workflow

All changes go through a branch + PR:
```bash
git checkout -b fix/<issue>   # or feat/<feature>
# make changes, npm test, npm run build
git push -u origin <branch>
gh pr create --fill
```

Never commit directly to `main`. PRs require passing tests (`prepublishOnly` enforces this on publish).

## Release Process

Releases are **tag-driven**. CI never commits to `main`. The publish workflow fires on any `v*` tag push.

```bash
# 1. Create a release branch from clean main
git checkout main && git pull
git checkout -b release/vX.Y.Z

# 2. Bump version in package.json only (no commit, no tag)
npm run release:patch   # or release:minor / release:major

# 3. Commit the version bump and open a PR
git add package.json package-lock.json
git commit -S -m "chore: release vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --fill

# 4. After PR is merged, push a signed tag from local main
git checkout main && git pull
VERSION="v$(node -p "require('./package.json').version")"
git tag -s "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"
```

Key rules:
- **Never run `npm version` without `--no-git-tag-version`** in the bump step — the tag must be created after merge, not before
- **Never push the tag before the PR is merged** — the tag should point to the commit on `main`
- The publish workflow (`.github/workflows/publish.yml`) handles build, test, npm publish, and GitHub Release creation automatically

## Non-negotiable Rules

1. **TDD always** — write failing test, run it, implement, confirm pass, commit
2. **All tests must pass** before committing — run `npm test`
3. **Build must succeed** — run `npm run build` and fix TypeScript errors
4. **No shell strings** — use `execFileSync(cmd, args[])` not `execSync('cmd args')`
5. **Shell allow-list** — `src/tools/shell.ts` uses `ALLOWED_COMMANDS` Set; never switch to deny-list
6. **Config-driven models** — never hardcode `'qwen3:8b'` or `'claude-sonnet-4-6'`; use `config.local_llm.model` and `config.claude.model`
7. **No dead config** — if you add a field to `src/config/schema.ts`, wire it up somewhere
8. **Never commit directly to `main`** — always create a branch (`git checkout -b feat/<name>` or `fix/<name>`), make changes there, then open a PR with `gh pr create`

## Key Files

| File | Purpose |
|---|---|
| `src/config/schema.ts` | Zod schema — source of truth for config shape |
| `src/orchestrator/orchestrator.ts` | Wires router + agents + tracker; local-only fallback lives here |
| `src/orchestrator/router.ts` | Regex rules → LLM fallback routing |
| `src/agents/local.ts` | Ollama client |
| `src/agents/claude.ts` | Anthropic SDK client |
| `src/tools/shell.ts` | Allow-list shell execution |
| `src/tools/git.ts` | Allow-list git queries |
| `src/cli/setup.ts` | First-run wizard + `loadEnvFile()` |
| `src/index.ts` | CLI entry — Commander commands registered here |
| `locode.yaml` | Default config (routing rules, models, thresholds) |

## Architecture in One Paragraph

`src/index.ts` calls `loadEnvFile()` on startup (loads `~/.locode/.env`). CLI commands create an `Orchestrator` which holds a `Router`, `LocalAgent`, `ClaudeAgent`, and `TokenTracker`. `process(prompt)` calls `router.classify()` which matches regex rules from config; ambiguous tasks call Ollama to self-classify. If `ANTHROPIC_API_KEY` is absent, `localOnly=true` and all tasks go to `LocalAgent`. Claude call failures also fall back to local. Token usage is recorded per turn; `getStats()` returns per-agent and total breakdowns.

## Test Structure

Each module has a co-located test file (`*.test.ts`). External dependencies (Ollama, Anthropic SDK) are mocked with `vi.mock()`. Tests live in `src/` — `dist/` is excluded via `vitest.config.ts`.

## Adding Features

- New CLI command → create `src/cli/<command>.ts`, export the handler, register in `src/index.ts`
- New config field → add to schema in `src/config/schema.ts`, update `locode.yaml`, wire it up
- New routing rule → add pattern to `locode.yaml` under `routing.rules`
- New agent backend → implement `AgentResult` interface, add config section, wire in `Orchestrator`

## Known TODOs (not bugs, planned work)

- **User config drift** — `~/.locode/locode.yaml` doesn't auto-update when default routing rules improve. Need a strategy for merging new defaults into existing user configs (e.g., version the config, auto-merge non-customized fields, or `locode update-config` command)
- **Streaming responses** — Claude agent uses non-streaming `messages.create()`. Switch to `client.messages.stream()` so users see real-time output during multi-step tool loops instead of waiting for the entire loop to finish
