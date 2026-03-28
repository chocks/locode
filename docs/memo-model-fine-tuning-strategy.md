# Memo: Model Fine-Tuning Strategy for Locode

**Goal:** Fast, reliable task execution on low-powered devices without large models.

**Status:** Consensus areas between Claude and Codex analysis. Ready for iteration.

---

## Decision Principles

- Specialize the classifier before the generator.
- Train against Locode's actual tool loop, not generic shell or coding data.
- Optimize for measurable task completion, not just lower token use.
- Keep the local path narrow enough that a small model can be fast and reliable.
- Make fine-tuning a pluggable optimization, not a hard dependency.

**Design constraint:** Locode must continue to work well without any custom models. Fine-tuned models should be an optional upgrade path, not a requirement for core functionality.

---

## 1. Separate Router Model from Executor Model in Config

**Problem today:** `Router.defaultResolver()` in `src/orchestrator/router.ts:54` uses `this.config.local_llm.model` — the same model that handles task execution. This means you can't optimize routing and execution independently. Swapping to a smaller/faster classifier means also changing your executor, or vice versa.

**Change:** Add a dedicated classifier config block under `routing`, not just a model name. A model-only field is enough only if the classifier always runs on the same Ollama host with the same runtime assumptions as the executor. If true separation is the goal, the config should allow different host/model/options for routing.

```yaml
# locode.yaml — proposed
routing:
  classifier:
    provider: ollama
    model: locode-classifier:0.5b    # tiny, fast, purpose-built
    base_url: http://localhost:11434
    options:
      num_ctx: 1024
  rules: [...]
  escalation_threshold: 0.7

local_llm:
  model: locode-agent:1.7b         # small but tool-capable
  base_url: http://localhost:11434
```

```typescript
// src/config/schema.ts — add to routing section
routing: z.object({
  classifier: z.discriminatedUnion('provider', [
    z.object({
      provider: z.literal('ollama'),
      model: z.string(),
      base_url: z.string().url(),
      options: z.record(z.string(), z.number()).optional(),
    }),
    z.object({
      provider: z.literal('embedding'),
      model: z.string(),
      labels_path: z.string(),
      top_k: z.number().int().positive().default(3),
    }),
  ]).optional(),  // falls back to local_llm if unset
  rules: z.array(RoutingRuleSchema),
  ambiguous_resolver: z.enum(['local']),
  escalation_threshold: z.number().min(0).max(1),
}),
```

**Note on provider flexibility:** Including `embedding` as a provider option future-proofs for the non-LLM classifier alternative (open question 3). An embedding classifier would skip generative inference entirely — embed the prompt, compare against labeled clusters, return the nearest category. This may be the fastest option on constrained hardware, but the actual latency gap must be measured on target devices rather than assumed in planning.

**Cold start fallback:** If `routing.classifier` is unset, Locode should keep today's behavior: rules first, then the current local-model fallback with escalation. That preserves zero-training usability.

**Why both agree:** This is a prerequisite for everything else. You can't evaluate or train two models if the system treats them as one.

---

## 2. Enrich Trace Logging Before Any Training

**Problem today:** `RunArtifactStore` (`src/runtime/run-artifact-store.ts`) captures prompt, intent, agent, and route reason — but is missing data needed for training and evaluation:

- No tool call records (what tools were called, what args, success/fail)
- No escalation signal (did the user retry with `/claude` after a local failure?)
- No route confidence score
- No timing data (latency per round, total wall time)
- No session correlation to connect retries and escalations across runs

**Change:** Extend `RunArtifactInput` to capture training-relevant fields:

```typescript
export interface RunArtifactInput {
  sessionId: string                    // NEW — correlate retries within a conversation
  parentRunId?: string                 // NEW — link retry/escalation chains
  prompt: string
  intent: TaskIntent
  routeMethod: 'rule' | 'llm'
  routeConfidence: number             // NEW
  agent: AgentType
  reason: string
  summary: string
  content: string
  toolCalls?: ToolCallRecord[]        // NEW — from local agent
  userEscalated?: boolean             // NEW — did user retry with other agent?
  latencyMs?: number                  // NEW
  metadata?: Record<string, unknown>
}
```

**Important caveat:** `userEscalated` is only meaningful if runs can be linked. Adding a boolean without `sessionId` or parent-child linkage will not let you reliably infer escalation behavior from standalone artifacts.

**Why both agree:** You cannot evaluate routing accuracy or local model quality without this data. Training without traces is guessing. The artifact store already exists — extending it is low-effort, high-value.

**Target:** Collect 300+ labeled traces before starting any classifier training.

---

## 3. Expand Task Taxonomy Beyond Binary local/complex

**Problem today:** Two classification systems operate independently and are both too coarse:

1. **Router** (`router.ts`) produces `local | claude` — a binary agent decision
2. **TaskClassifier** (`task-classifier.ts`) produces `chat | inspect | edit | workflow` — an intent label

These overlap but don't talk to each other. The router doesn't know that "inspect" tasks are almost always safe for local. The task classifier doesn't influence confidence thresholds.

**Change:** Unify into a single taxonomy that maps to both routing risk and execution strategy:

| Category | Examples | Default route | Risk level |
|---|---|---|---|
| `read-only` | grep, search, ls, cat, git log/diff/status | local | none |
| `environment` | env detection, which, uname, pwd | local | none |
| `git-inspect` | git blame, git log with filters | local | low |
| `one-shot-edit` | rename variable, add import, fix typo | local | medium |
| `multi-step` | refactor, implement feature, fix bug | claude | high |
| `reasoning` | explain, debug, architecture | claude | high |
| `chat` | greetings, general questions | local | none |

The classifier confidence threshold should vary by category — `read-only` at 0.5 is fine, `one-shot-edit` at 0.5 should escalate.

**Current code caveat:** Today, `edit` intents are short-circuited into `CodingAgent` via `orchestrator.ts:151`. That means "one-shot-edit" is not just a classifier problem; supporting it locally also requires revisiting the current `TaskClassifier` and coding-agent gate.

**Why both agree:** The current binary split can't express "this is local-safe but needs careful handling" vs "this is trivially local." A richer taxonomy gives the classifier better training signal and gives the executor better context about what's expected.

**Caveat (Codex's point):** Don't design the full taxonomy from theory — start with `local | complex | uncertain` in the classifier, collect traces, then split categories based on observed failure patterns.

---

## 4. Tighten Tool Schemas and Prompts Before Fine-Tuning

**Problem today:** Small models fail not because they don't know what `grep` does, but because they:
- Format tool call JSON incorrectly (the `parseTextToolCalls` fallback in `local.ts:54` exists for this reason)
- Call tools with wrong argument names or types
- Loop on the same failed call (the `consecutiveFailures` guard at `local.ts:209` is a symptom)
- Don't know when to stop calling tools

**Changes (free accuracy gains, no training required):**

1. **Tighter tool descriptions** — Each tool in the registry should include 1-2 canonical examples in its description, showing exact expected input/output
2. **Explicit blocked-command guidance** — When `shell.ts` blocks a command, the error message should suggest the correct alternative (e.g., "rm is not allowed. To delete files, use the Claude agent.")
3. **Structured output enforcement** — If the Ollama model supports `format: "json"`, use it for tool-calling rounds to reduce parsing failures
4. **Reduce MAX_TOOL_ROUNDS** for read-only tasks — A `git status` should never need 5 rounds. Category-aware round limits prevent runaway loops
5. **Smaller system prompt for local agent** — The current `buildPromptHeader()` + `LOCAL_PROMPT_FOOTER` in `local.ts:24-41` is generic. For a small model on constrained hardware, every token in the system prompt competes with context window. The system prompt should be as lean as possible, with tool examples moved to the tool descriptions themselves rather than duplicated in instructions

**Why both agree:** These improvements make *any* model perform better on Locode's tool surface. They reduce how much fine-tuning is needed and ensure that when you do fine-tune, you're training against a clean, well-defined interface rather than a noisy one.

---

## 5. Classifier: Train First, Small and Separate

**Architecture:** A purpose-built classification model (0.5-1B parameters) that outputs a routing label with confidence.

**Why a separate model, not self-classification:**
- Small generative models are poorly calibrated — they confidently produce wrong answers
- A classifier trained on labeled (prompt → route) pairs has a fundamentally different loss function than a generative model rating its own ability
- Softmax over 3 classes (`local`, `complex`, `uncertain`) is more trustworthy than parsing a generative model's JSON confidence field

**Training approach:**
1. Collect 300+ traces from step 2
2. Label each trace with stronger signals than "no escalation":
   - explicit human review for a seed set
   - automated validation where possible (tool success, exit code, parse/build/test signals)
   - escalation/retry behavior as a weak signal, not ground truth
   - `unknown` for cases where correctness cannot be established confidently
3. Fine-tune with LoRA on a small base (Qwen3 0.6B or Phi-4 mini)
4. Output: `{"route": "local|complex|uncertain", "confidence": 0.0-1.0}`
5. Threshold: if no class > 0.8, treat as `uncertain` → escalate to Claude

**Eval metrics (before and after training):**
- Route precision on "safe local" tasks (true positives)
- False-local rate (complex tasks incorrectly sent to local)
- Escalation-after-local rate (user retried with Claude)
- Classification latency (must be <100ms on target hardware)

**Caveat (Codex's point):** Fine-tuned softmax is not automatically calibrated. You still need calibration testing on held-out data and threshold tuning. The `uncertain` class helps but doesn't solve calibration by itself.

---

## 6. Local Executor: Scope Narrowly, Train Last

**Scope (what the local model owns):**
- Read/search/list (grep, find, cat, ls, head, tail)
- Git inspection (log, diff, status, blame)
- Environment detection (env, which, uname, pwd)
- Deterministic one-shot edits with tight constraints

**Scope (what the local model does NOT own):**
- Multi-file edits (already routed to `CodingAgent` via `orchestrator.ts:151`)
- Complex debugging or reasoning
- Anything requiring multi-step planning

**Training approach (only after steps 1-5):**
1. Collect successful tool-use trajectories from Locode's own traces: `(prompt, [tool_call, result, tool_call, result, ...], final_answer)`
2. Fine-tune on Locode's exact tool schemas and Locode's exact error messages — not generic unix
3. The model must learn Locode's current shell allowlist in `shell.ts:3`, not all of Linux
4. Use synthetic data from Claude for coverage: generate 500+ (prompt → correct tool sequence) pairs
5. Base model: Qwen3 1.7B or similar, quantized to Q4_K_M for deployment

**Key metric:** Task completion rate on tool workflows, not "does the output sound smart"

**Quantization strategy:** Fine-tune at full precision, then quantize for distribution. Test at multiple quantization levels against your eval suite — some fine-tuned models degrade sharply at Q4 while others hold up well. The right quantization level is hardware-dependent:
- Q4_K_M: fastest, smallest, best for RPi/low-RAM — test for quality degradation
- Q5_K_M: good middle ground for laptops with 8GB RAM
- Q8_0: if the target device has 16GB+ RAM, minimal quality loss

**Memory budget consideration:** On constrained devices, keeping two models hot in memory (classifier + executor) doubles the memory pressure vs one model. Ollama's model caching helps, but on devices with <8GB RAM, model swap latency between classifier and executor could negate the speed gains from using smaller models. If this proves problematic, the embedding classifier alternative eliminates this entirely — it needs no GPU memory.

---

## Execution Order

```
Phase 0 (now)     — Separate router/executor model configs in schema
Phase 1 (1-2 wks) — Extend artifact store with trace fields, deploy, collect data
Phase 2 (ongoing) — Tighten tool schemas, prompts, error messages
Phase 3 (after 300 traces) — Build eval harness, baseline current models
Phase 3b (parallel) — Prototype embedding classifier as a fast baseline
Phase 4 (after eval) — Train LLM classifier OR adopt embedding approach, compare both
Phase 5 (after classifier) — Train local executor if evals show a gap
```

Each phase has a clear gate: don't start the next until the current one produces measurable results.

**Phase 3b rationale:** An embedding classifier (cosine similarity against labeled prompt clusters) requires no generative inference and can avoid loading a second LLM into memory. That makes it worth prototyping in parallel with the eval harness as a baseline. Benchmark targets should be validated on target hardware rather than assumed ahead of time. If it achieves acceptable routing quality and materially lower latency, the LLM classifier may not be worth the operational cost. If it doesn't, you have a clear justification for the LLM approach.

---

## Success Labeling

**Problem:** "The user did not escalate" is not the same as "the run was correct." Silent failures are common in explanation, debugging, and code-inspection tasks.

**Recommendation:**
- Treat non-escalation as a weak signal only.
- Prefer hard signals where possible:
  - tool success/failure
  - shell exit status
  - file edit validation
  - parse/build/test checks when applicable
- Use explicit human review on a seed set to calibrate your labeling policy.
- Allow `unknown` labels in the dataset instead of forcing noisy binary labels.

**Why this matters:** A noisy routing dataset will produce a confident but unreliable classifier.

---

## Cold Start and Fallback Behavior

**Problem:** New users will have zero traces and no fine-tuned models.

**Recommendation:**
- Default to today's safe baseline:
  - regex rules in `locode.yaml`
  - local-model ambiguous resolver
  - escalation threshold to Claude
- Make custom classifier and local fine-tuned models opt-in.
- Ship sensible defaults so Locode remains useful on first install without any training pipeline.

**Why this matters:** Fine-tuning should improve a working system, not be required to create one.

---

## Model Versioning and Distribution

**Problem:** Once Locode ships custom models, CLI and model compatibility become operational concerns.

**Recommendation:**
- Version models independently from the CLI, but declare compatibility ranges.
- Treat model downloads as explicit upgrades, not silent mandatory changes.
- Record model identifiers in traces and artifacts so evals remain reproducible.
- Define fallback behavior when a configured model is unavailable or out of date.

**Why this matters:** Without a versioning plan, model improvements become a support burden and make training results hard to compare across users.

---

## Open Questions

1. **Distribution:** How do users get the fine-tuned models? Custom Ollama modelfile? Hosted on HuggingFace + `ollama pull`? Consider `locode models pull` as a CLI command that handles version compatibility checks automatically.
2. **Target hardware:** What's the weakest device you want to support? (RPi, old laptop, phone via Termux?) This determines max model size and whether two models in memory is feasible.
3. **Embedding classifier alternative:** For the routing decision, is a cosine-similarity approach (no LLM at all) worth prototyping? It would be the fastest option on weak hardware. Proposed as Phase 3b above.
4. **Single model for both:** After collecting data, should we test whether one 1.7B model can handle both classification and execution before committing to two models?
5. **Base model selection timing:** The small model landscape moves fast. A new release (Qwen4, Phi-5, Gemma4) could match a fine-tuned older model for free. The eval harness and trace infrastructure are durable investments; the specific base model choice should be made as late as possible, ideally at training time, not locked in during planning.
6. **Synthetic data quality:** Section 6 proposes generating 500+ training pairs from Claude. How do you validate that Claude's "correct" tool sequences actually work in Locode? Synthetic data needs to be executed against the real tool surface, not just generated and assumed correct.
