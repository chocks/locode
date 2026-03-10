# Locode — Misc TODOs

Backlog items that don't belong to a specific version milestone. Pick these up opportunistically or slot them into the next release.

---

## Config & Setup

### User config drift (`locode.yaml`)

`~/.locode/locode.yaml` doesn't auto-update when shipped defaults change (new routing rules, new config sections, changed defaults). The setup wizard's `CONFIG_TEMPLATE` is a second source of truth that can also drift.

**Proposed fix:** Versioned config with `locode update-config` command.

1. Add `config_version: N` to `locode.yaml`
2. On startup, compare against `CURRENT_CONFIG_VERSION` constant
3. If outdated, warn: `"Your config is outdated (v1 → v2). Run locode update-config."`
4. `locode update-config` diffs sections, lets user accept/skip each change
5. Single source of truth: `DEFAULT_CONFIG` constant in code (replaces both `locode.yaml` in repo root and `CONFIG_TEMPLATE` in setup.ts)
6. Bump `config_version` in the same PR that changes defaults

Rules:
- Never auto-modify user config without consent
- Always warn on version mismatch
- Setup wizard uses `DEFAULT_CONFIG` + sets `config_version` on first run

**Priority:** Medium — becomes more important as config grows with v0.2+ additions.

---

### Config template duplication

`CONFIG_TEMPLATE` in `src/cli/setup.ts` and `locode.yaml` in repo root define the same defaults in two places. Consolidate into a single `DEFAULT_CONFIG` constant exported from `src/config/schema.ts`.

**Priority:** Low — annoying but not breaking.

---

## Benchmarking

### No real Claude Code baseline

The benchmark command's "Claude only" cost is estimated, not measured. Getting a real baseline requires Claude Code CLI installed and parsing its output.

**Priority:** Low — estimation is good enough for now.

---

## Performance

### Speculative local execution

For interactive prompts, start local LLM generation speculatively while routing runs. If route = local, user sees instant response. If route = Claude, cancel local via `AbortController`.

```
t=0ms   Prompt arrives → start local generation (speculative)
t=2ms   Router heuristic layer → HIGH confidence LOCAL → keep streaming
t=5ms   Router regex layer → match → use decision
t=50ms  Router LLM layer → result → cancel local if CLAUDE
```

**Priority:** Medium — nice UX win, but requires AbortController support in Ollama client.

---

### Prompt caching for local LLM

Ollama supports prompt caching (KV cache) when the prompt prefix is identical. Structure system prompts so the static portion comes first, maximizing cache hits.

**Priority:** Low — Ollama handles this automatically for the most part.

---

## CLI

### `locode update` self-update

Current self-update logic exists but may not handle all edge cases (global vs npx installs, permission errors). Needs testing across install methods.

**Priority:** Low.

---

### Task classifier fast-paths

Regex patterns that map directly to tool execution with zero LLM involvement: `grep`, `ls`, `git status`, `show files`. Executes immediately.

```typescript
interface ClassificationResult {
  type: 'fast_path' | 'workflow_step' | 'interactive'
  toolCall?: ToolCall
  assignedAgent?: AgentType
}
```

**Priority:** Medium — good latency win for common operations. Slot into v0.2 or v0.3.

---

## Local LLM

### JSON DSL mode

Switch local agent from Ollama native function-calling to constrained JSON output. Benefits: faster generation, works with more models, easier validation.

```jsonc
{ "tool": "read_file", "args": { "path": "src/router.ts" }, "reason": "Need router context" }
```

With schema validation + retry on malformed output (up to 3 attempts, free compute).

**Priority:** Medium — prerequisite for reliable agent loops. Slot into v0.3.

---

### Model-per-task routing

Use different model sizes for different operations:

| Task | Model Size |
|---|---|
| Classification / tool selection | Small (e.g., qwen3:1.5b) |
| Planning / code generation | Medium (e.g., qwen3:8b) |
| Complex reasoning | Cloud (Claude) |

Requires config support for multiple local models.

**Priority:** Low — current single-model approach works. Revisit when agent loop (v0.3) is running.

---

## Future Ideas (unplanned)

- **Parallel ticket execution** — git worktrees per ticket for concurrent implementation
- **Custom routing plugins** — plugin interface for adding router layers
- **Streaming patch application** — parse unified diffs from Claude stream as they arrive
- **Expanded workflow DSL** — add `retry`, `parallel`, `condition` to workflow templates
