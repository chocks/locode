# Locode

Local-first AI coding CLI. Routes simple tasks to a local LLM (Ollama), complex tasks to Claude. Saves tokens.

## Requirements

- Node.js 18+

That's it — run `locode setup` to handle the rest.

## Install

```bash
npm install -g locode
```

## First-run Setup

```bash
locode setup
```

The setup wizard will:
1. Install Ollama if not present (macOS via Homebrew, Linux via install script)
2. Let you choose a local LLM model from a curated list
3. Pull the selected model
4. Optionally save your Anthropic API key to `~/.locode/.env`
5. Update `locode.yaml` with your chosen model

You can also install/update a model any time:

```bash
locode install                      # installs model from locode.yaml
locode install deepseek-coder:6.7b  # installs a specific model
```

## Usage

```bash
# Interactive REPL (default)
locode

# Single-shot
locode run "grep for all TODO comments in src/"

# Custom config
locode chat --config ./my-locode.yaml

# Run benchmark
npx ts-node benchmark/runner.ts
```

## Local-only Mode

If no `ANTHROPIC_API_KEY` is set (or the API is unreachable), Locode automatically falls back to routing all tasks to the local LLM — no crash, no config change needed.

```
[local-only mode] ANTHROPIC_API_KEY not set — all tasks routed to local LLM
```

## Config (`locode.yaml`)

Edit routing rules, model names, and Ollama base URL. See `locode.yaml` for defaults.

Key settings:
- `local_llm.model` — Ollama model name (default: `qwen2.5-coder:7b`)
- `routing.rules` — regex patterns that determine which agent handles a task
- `routing.escalation_threshold` — confidence below this escalates to Claude

## Token Tracking

Type `stats` in the REPL or press Ctrl+C to see token usage breakdown and estimated cost savings.

## Benchmark

Compare Claude token cost across 3 modes — run the same task and see exactly how much locode saves:

```bash
# Run default benchmark (todo webapp task)
locode benchmark

# Benchmark a custom prompt
locode benchmark --prompt "build a REST API with Express"

# Benchmark with a task file
locode benchmark --task ./my-task.md

# Run multiple prompts
locode benchmark --prompt "grep for all TODOs" --prompt "refactor the auth module"

# Save report to custom path
locode benchmark --output ./reports/$(date +%Y-%m-%d).html
```

Opens an HTML report showing Claude token usage and estimated cost across:
- **claude-only** — baseline (everything goes to Claude)
- **hybrid** — default mode (local handles simple tasks)
- **local-only** — zero Claude cost

Example output: `claude-only: $0.52 → hybrid: $0.08 → saved: 85%`

## Local Development

```bash
git clone https://github.com/your-org/locode
cd locode
npm install
```

**Run in dev mode** (no build step, uses `ts-node`):
```bash
npm run dev
```

**Run a single-shot command in dev mode:**
```bash
npx ts-node src/index.ts run "grep for TODOs in src/"
```

**Run tests:**
```bash
npm test           # run once
npm run test:watch # watch mode
```

**Build:**
```bash
npm run build      # outputs to dist/
```

**Try the built CLI locally:**
```bash
npm run build && node dist/index.js
```

**Project structure:**
```
src/
  cli/          # REPL, display, setup wizard, install command
  config/       # Zod schema + YAML loader
  agents/       # LocalAgent (Ollama) + ClaudeAgent (Anthropic SDK)
  orchestrator/ # Router (rule-based + LLM fallback) + Orchestrator
  tools/        # readFile, shell (allow-list), git tools
  tracker/      # Token usage + cost estimation
benchmark/
  tasks/        # Benchmark task definitions
  parsers/      # Stats parsers
  report/       # HTML report generator
docs/plans/     # Design doc + implementation plan
```

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork and branch** — create a feature branch from `main`
2. **Follow TDD** — write failing tests before implementation
3. **Keep it focused** — one feature or fix per PR, no scope creep
4. **Run the full suite** before opening a PR:
   ```bash
   npm test && npm run build
   ```
5. **Routing rules** — if adding new task categories, update `locode.yaml` defaults and document the pattern
6. **Security** — the shell tool uses an allow-list; do not switch to a deny-list approach
7. **No new dependencies** without discussion — bundle size matters for a CLI tool

### Adding a new agent backend

1. Implement the `AgentResult` interface from `src/agents/local.ts`
2. Add a new entry to the config schema in `src/config/schema.ts`
3. Wire it into `src/orchestrator/orchestrator.ts`
4. Add routing rules to `locode.yaml`

### Reporting issues

Open an issue with:
- Locode version (`locode --version`)
- OS and Node.js version
- The task prompt that caused unexpected routing
- Which agent was used vs. which you expected
