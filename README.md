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

Compare token usage between Locode and using Claude for everything:

```bash
npx ts-node benchmark/runner.ts
```

Opens an HTML report showing % of tasks handled locally and cost savings.
