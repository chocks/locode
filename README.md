# Locode

[![npm](https://img.shields.io/npm/v/@chocks-dev/locode)](https://www.npmjs.com/package/@chocks-dev/locode)

> **Alpha Software — Use at Your Own Risk**
> Locode is under active development and has not been validated for production use. Interfaces, configuration formats, and behaviours may change without notice between releases. It is provided as-is, without warranty of any kind. Use in critical or production environments is not recommended at this stage.

Local-first AI coding CLI. Routes simple tasks to a local LLM (Ollama), complex tasks to Claude. Saves tokens.

## Demo
![locode-demo](https://github.com/user-attachments/assets/207f4d47-f8c9-4f4c-adf3-33d0a2bdf78d)

⭐ If you find the idea interesting, please consider starring the repo. It helps a lot! 

## Quick Start

```bash
npm install -g @chocks-dev/locode
locode setup    # installs Ollama, picks a model, saves API key
locode          # start chatting
```

## Architecture
```
User CLI
   │
   ▼
Routing Logic
   │
   ├── Local LLM (fast tasks)
   │
   └── Claude (complex reasoning)
```

## Commands

| Command | Description |
|---------|-------------|
| `locode` | Interactive REPL (default) |
| `locode run "<prompt>"` | Single-shot task execution |
| `locode setup` | First-run wizard (Ollama + model + API key) |
| `locode install [model]` | Pull a specific Ollama model |
| `locode update` | Update locode to the latest version |
| `locode benchmark` | Compare token cost across routing modes |
| `locode eval-local-models` | Compare local models on tool-calling reliability |
| `locode recommend-local-model` | Pick the best evaluated local model for this machine |

### Flags

```bash
locode chat --claude-only          # skip local, send everything to Claude
locode chat --local-only           # skip Claude, use Ollama only
locode chat --config ./custom.yaml # use a custom config file
locode benchmark --prompt "build a REST API" --output report.html
```

If no `ANTHROPIC_API_KEY` is set, locode automatically runs in local-only mode.

## Config

Edit `locode.yaml` for routing rules, models, and thresholds:

- `local_llm.model` — Ollama model (default: `llama3.1:8b`)
- `routing.rules` — regex patterns that route tasks to local or Claude
- `routing.escalation_threshold` — confidence below this escalates to Claude

Type `stats` in the REPL to see token usage and estimated savings.

Current default: `llama3.1:8b` is the conservative tool-calling baseline.
There is no single recommended replacement model. Evaluate the models that make sense for your hardware, then pick the winner from your own results.

## Choosing A Local Model

Start by evaluating the models you actually want to compare:

```bash
locode eval-local-models \
  --variant llama3.1:8b \
  --variant gemma4:e4b \
  --variant qwen2.5-coder:7b
```

You can include larger options if your machine can support them:

```bash
locode eval-local-models \
  --variant llama3.1:8b \
  --variant qwen2.5-coder:14b \
  --variant devstral:24b \
  --variant mistral-small:24b
```

Structured variants also work when you want to tune context or thinking mode:

```bash
locode eval-local-models \
  --variant "label=llama-baseline,model=llama3.1:8b,num_ctx=8192" \
  --variant "label=gemma-thinking,model=gemma4:27b,thinking=true,num_ctx=16384"
```

The report is written to `.locode/evals/local-model-eval.json` by default. After running your comparison, ask Locode to recommend the best option for the current machine:

```bash
locode recommend-local-model
```

To use a different report file:

```bash
locode recommend-local-model --report /path/to/local-model-eval.json
```

The recommendation command:

- detects platform, CPU count, and total RAM
- filters out models that likely exceed the machine's memory budget
- ranks the remaining models by eval reliability first, then latency and token cost

## Telemetry (Opt-in)

Telemetry is **off by default**. To opt in, export in your shell profile:

```bash
export SENTRY_DSN="https://your-key@o123.ingest.sentry.io/456"
```

When enabled: captures unhandled exceptions and samples 20% of performance traces.
Never sent: prompts, API keys, file contents. Unset `SENTRY_DSN` to disable.

## Development

```bash
git clone https://github.com/chocks/locode && cd locode
npm install
npm run dev              # run with ts-node
npm test                 # vitest
npm run build            # tsc → dist/
```

### Project Structure

```
src/
  cli/          # REPL, setup, install, update, benchmark
  config/       # Zod schema + YAML loader
  agents/       # LocalAgent (Ollama) + ClaudeAgent (Anthropic SDK)
  orchestrator/ # Router + Orchestrator
  tools/        # readFile, shell (allow-list), git
  tracker/      # Token usage + cost estimation
```

### E2E Tests

End-to-end tests verify the full CLI pipeline by spawning locode against lightweight HTTP stub servers that mimic Ollama and Anthropic APIs. No external services required.

**Prerequisites:** Build the project first — E2E tests run the compiled CLI.

```bash
npm run build
npm run test:e2e
```

The tests verify:
- Simple prompts (e.g., `grep`) route to local LLM
- Complex prompts (e.g., `refactor`) route to Claude
- Missing API key triggers local-only fallback

### Contributing

1. Fork and branch from `main` — never commit directly
2. TDD — write failing test first, then implement
3. `npm test && npm run build` before opening a PR
4. One feature/fix per PR

### Releasing

Releases are tag-driven — CI publishes to npm on `v*` tag push.

```bash
git checkout -b release/vX.Y.Z
npm run release:patch                    # bump package.json
git add package.json package-lock.json
git commit -S -m "chore: release vX.Y.Z"
gh pr create --fill
# after merge:
git checkout main && git pull
git tag -s "vX.Y.Z" -m "Release vX.Y.Z"
git push origin "vX.Y.Z"
```
