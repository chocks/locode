# Local Model Tool-Calling Evaluation

This repo now includes a fixed evaluation harness for comparing local Ollama models on the `locode` tool loop.

## Why this exists

Token cost and raw benchmark quality are not enough for `locode`.
The local model has to:

- choose valid tools
- stop after getting useful results
- recover from blocked or failing tool calls
- produce a final plain-text answer instead of looping

That makes tool-calling reliability the main gating metric for changing the default local model.

## Current product stance

- Current default: `llama3.1:8b`
- Recommended upgrade to evaluate: `gemma4:9b`
- Do not flip the hard default to Gemma 4 until it performs well on the task suite below

## Command

```bash
locode eval-local-models
```

This runs the default comparison:

- `llama3.1:8b`
- `gemma4:9b`

and writes a JSON report to:

```bash
.locode/evals/local-model-eval.json
```

## Custom variants

Bare model names:

```bash
locode eval-local-models \
  --variant llama3.1:8b \
  --variant gemma4:9b
```

Structured variants:

```bash
locode eval-local-models \
  --variant "label=llama-baseline,model=llama3.1:8b,num_ctx=8192" \
  --variant "label=gemma-27b-thinking,model=gemma4:27b,thinking=true,num_ctx=16384"
```

## Methodology

The harness uses the real `LocalAgent` tool loop with a read-only tool registry:

- `read_file`
- `run_command`
- `git_query`
- `list_files`
- `search_code`

Each variant is run against the same fixed inspect-oriented task suite:

1. Read package scripts
2. Find `executeParallel`
3. Use git to check whether `src/cli/setup.ts` is tracked
4. Recover from a blocked or unavailable command (`tree`)
5. Find the Claude local-fallback threshold wiring

Each task is scored on:

- content correctness against simple regex expectations
- whether the model used at least one appropriate tool
- whether it hallucinated invalid tools
- whether it repeated the same failing call
- whether it returned a non-empty final answer

## General practice for this kind of eval

- Use a fixed task suite, not ad hoc prompts
- Keep hardware and Ollama settings stable
- Run multiple trials per model
- Score both tool-call behavior and final answer quality
- Separate "better model" from "safer default"

For `locode`, the safer default should optimize for:

- valid tool selection
- low loop rate
- reliable final answers

not just general code quality.
