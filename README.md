# Locode

Local-first AI coding CLI. Routes simple tasks to a local LLM (Ollama), complex tasks to Claude. Saves tokens.

## Requirements

- Node.js 18+
- [Ollama](https://ollama.ai) running locally with `qwen2.5-coder:7b` pulled: `ollama pull qwen2.5-coder:7b`
- `ANTHROPIC_API_KEY` environment variable set

## Install

```bash
npm install -g locode
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

Opens a HTML report showing % of tasks handled locally and cost savings.
