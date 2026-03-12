# Local LLM Tool Calling — Learnings

Captured during v0.2 development (2026-03-11).

## Each model has different tool calling behavior

There is no universal system prompt or configuration that works across all local models. Key differences:

| Model | Structured tool_calls | Stop behavior | Known issues |
|---|---|---|---|
| **llama3.1:8b** | Native, reliable | Good — stops after results | Best overall for tool calling |
| **qwen3:8b** | Template-based (`<tool_call>` tags) | Poor — loops frequently | Hallucinated calls, truncation 500s, infinite loops |
| **qwen2.5:7b** | Template-based | Better than qwen3 | Occasional loops on complex tasks |
| **mistral:7b** | Native | Good | Stable but less code-aware |
| **codestral** | None | N/A | Returns 400 error when tools passed |
| **deepseek-coder-v2** | Unofficial only | Unknown | Requires community model for tool support |

## Model-specific pitfalls we hit

### qwen3:8b
- Emits tool calls as `<tool_call>JSON</tool_call>` text blocks in `content` instead of using Ollama's structured `tool_calls` field. Required a fallback parser.
- Returns `content: ""` on every tool call round, then `content: ""` with no tool calls as the "final" response. Required a retry-without-tools fallback.
- `think: false` parameter is qwen-specific. Passing it to other models may cause issues.
- Wraps entire responses in `<think>...</think>` tags even with `think: false`, producing empty output after stripping.
- Gets stuck retrying the same failing tool call (e.g. `tree` not installed) without trying alternatives.

### llama3.1:8b
- Native structured tool calling, well-supported by Ollama's parser.
- Does NOT support `think: false` — remove it when switching from qwen.
- `ANSWER:` prefix in system prompt caused it to emit tool calls as text JSON inside `ANSWER:` instead of using structured API. Keep prompts simple.
- Needs `num_ctx: 4096+` — tool definitions + conversation history + results overflow at 2048.

## System prompt rules for small models (7B-14B)

1. **Keep it short** — every token of prompt is context the model can't use for tool results.
2. **No multi-step workflows** — small models try to follow ALL steps sequentially instead of choosing the right one. "Use tools to gather information" is better than a numbered WORKFLOW.
3. **No response format prefixes** (ANSWER:, RESPONSE:) — models may treat these as the output format for everything, including tool calls.
4. **No abstract instructions** like "decide if you have enough" — use concrete: "After receiving a tool result, respond with your answer."
5. **Reference tool names in the prompt only via the dynamic tool list** — hardcoding names (shell, git) causes mismatches when names change.

## Prompt that works for llama3.1:8b

```
You are a coding assistant. Use the provided tools to answer questions.

TOOLS
<dynamically injected from registry>

INSTRUCTIONS
1. Use the tools above to gather information. Do not guess file contents.
2. After receiving a tool result, respond with your answer in plain text.
3. Only call another tool if the first result was insufficient.
4. You cannot modify files. Only read and explore.
5. Keep answers concise.
```

## Runtime guardrails (model-agnostic)

These protect against bad model behavior regardless of which model is used:

| Guardrail | What it does |
|---|---|
| Max tool rounds (5) | Prevents infinite tool calling loops |
| Retry without tools on empty response | Forces a text response when model returns empty after tool use |
| Consecutive failure detection | Breaks loop when same tool call fails twice |
| Text-based `<tool_call>` parser | Catches tool calls emitted as text (qwen3 behavior) |
| `--verbose` flag | Shows raw model output, tool dispatch, and results for debugging |

## Tool description matters

- Only list commands that actually exist on the target platform. `tree` is not installed on macOS by default — listing it caused the model to loop on a failing command.
- List allowed commands explicitly in the tool description: `"Allowed: ls, cat, head, tail, grep, find, wc, file, stat, pwd, du"` — the model can only use what it knows about.

## num_ctx matters

- `num_ctx: 2048` is too small for tool calling. Tool definitions (~500 tokens) + system prompt (~200 tokens) + conversation + tool results easily overflow.
- `num_ctx: 4096` is the minimum. 8192 is better for multi-round tool use.
- qwen3 with low num_ctx triggers truncated JSON → Ollama HTTP 500 errors.
