# Gemma 4 as Local Model

Exploration notes from 2026-04-02.

## Summary

Gemma 4 works with the existing Ollama integration — no code changes required for basic use. Switch by changing `local_llm.model` in `locode.yaml`. The main additions in this exploration are:

- `thinking` config flag to control Ollama's `think` parameter (on by default it was silently unset, causing thinking models to burn tokens on every tool round)
- `num_ctx` raised from 4096 → 8192 in the default config (Gemma 4's native window is 128k; 4096 was leaving quality on the table)

## Model Options

| Model | Ollama tag | RAM (4-bit) | Notes |
|---|---|---|---|
| Gemma 4 E2B | `gemma4:2b` | ~3 GB | Fast; may struggle with multi-step tool use |
| Gemma 4 E4B | `gemma4:4b` | ~4 GB | Good for simple routing/search tasks |
| Gemma 4 9B | `gemma4:9b` | ~7 GB | **Recommended** — best quality/speed trade-off |
| Gemma 4 27B | `gemma4:27b` | ~18 GB | Near-Claude quality locally; supports thinking mode |

Unsloth GGUF variants are available on Hugging Face (`unsloth/gemma-4-31B-it-GGUF`) and can be loaded into Ollama via a custom Modelfile pointing to the `.gguf` file.

## Switching to Gemma 4

```bash
ollama pull gemma4:9b
```

Then in `locode.yaml`:

```yaml
local_llm:
  model: gemma4:9b
  options:
    num_ctx: 8192   # or higher if RAM allows; Gemma 4 supports up to 128k
```

For the thinking-capable 27B variant:

```yaml
local_llm:
  model: gemma4:27b
  thinking: true    # enables extended reasoning; <think> blocks are stripped automatically
  options:
    num_ctx: 16384
```

## Why `thinking: false` by Default

Ollama's `think` parameter enables chain-of-thought tokens that are hidden from the final response. Before this change the main tool loop omitted `think` entirely — Ollama interprets that as the model's default, which for thinking-capable models means reasoning tokens are generated (and counted) on every round. Setting `think: false` explicitly suppresses them unless opted in via `thinking: true` in config.

## Comparison vs llama3.1:8b (Previous Default)

| | llama3.1:8b | gemma4:9b |
|---|---|---|
| RAM (4-bit) | ~6 GB | ~7 GB |
| Context window | 8k native | 128k native |
| Tool calling | Native, reliable | Native, reliable |
| Code quality | Good | Better on most benchmarks |
| Thinking mode | No | Yes (opt-in) |
| Ollama support | Mature | Available as of Gemma 4 release |

`gemma4:9b` is a straightforward upgrade at similar resource cost. The 2B variant is viable for pure routing/search tasks where Claude handles the heavy lifting.

## Known Unknowns

- Tool calling reliability across the Gemma 4 family hasn't been tested as thoroughly as llama3.1:8b (see `learnings-local-llm-tool-calling.md` for methodology)
- The `thinking: true` path strips `<think>` blocks from output but thinking tokens still count toward Ollama's `eval_count` — check `locode stats` if token usage seems high
- Unsloth GGUF dynamic quantization (`Dynamic 2.0`) claims better accuracy at lower bit-width than standard GGUF; worth testing on memory-constrained hardware
