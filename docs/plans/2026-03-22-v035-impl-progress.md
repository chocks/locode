# v0.3.5 Agent Hardening + Performance — Implementation Progress

**Started:** 2026-03-22
**Design:** [v0.3.5 Agent Hardening + Performance](2026-03-22-v035-agent-hardening-performance.md)
**Current branch:** `feat/v035-minimal-patch`
**Checkpoint commit:** `ea2d44f` (`feat: add minimal patch edit support`)
**Approach:** Incremental slices with clean commit checkpoints

---

## Status

### Completed in current checkpoint

- Minimal `patch` edit operation added:
  exact `{ before, after }` block replacement
- Unified task classification via `TaskClassifier`
- Real tool approval enforcement in `ToolExecutor`
- REPL approval prompts wired into runtime
- Runtime config added:
  `runtime.artifacts_dir`, `runtime.approval_mode`, `runtime.classifier`
- Performance config added:
  `performance.parallel_reads`, `cache_context`, `max_prompt_chars`, etc.
- Coding agent now:
  deterministic fast-path reads for mentioned files and likely sibling tests
- Coding agent now:
  preview-before-apply flow for more trustworthy diffs
- Coding agent now:
  basic in-memory analyze-context cache
- Run artifact storage added under `.locode/runs`
- Artifact store now writes:
  `run.json`, `prompt.txt`, `content.txt`, `summary.txt`, optional `metadata.json`
- Editor rollback now deletes newly created files
- Edit preconditions added:
  `fileHash`, `mustContain`
- Planner, coding-agent, and editor now understand the minimal `patch` edit shape
- Planner preserves edit preconditions in plan parsing
- Coding agent attaches lightweight preconditions to generated edits
- Coding agent is rebuilt after MCP tool registration so coding-mode sees updated tools
- Default repo context now includes `AGENTS.md` and `CLAUDE.md`

### Verified at checkpoint

- `npm run build` passes
- `npm test` passes except existing sandbox-blocked MCP OAuth tests that write under `~/.locode/...`

### Known non-goals / not finished yet

- Full patch/hunk-based edit model beyond exact block replacement
- Persistent cross-run context cache
- Rich artifact replay tooling / run viewer
- Whole-run prompt budgeting beyond current per-file truncation
- Workflow intent integration beyond classification

---

## Files Added

- `src/orchestrator/task-classifier.ts`
- `src/orchestrator/task-classifier.test.ts`
- `src/runtime/run-artifact-store.ts`
- `src/runtime/run-artifact-store.test.ts`

---

## Files Updated

- `src/orchestrator/orchestrator.ts`
- `src/cli/repl.ts`
- `src/tools/executor.ts`
- `src/tools/executor.test.ts`
- `src/config/schema.ts`
- `src/config/schema.test.ts`
- `src/editor/types.ts`
- `src/editor/code-editor.ts`
- `src/editor/code-editor.test.ts`
- `src/coding/types.ts`
- `src/coding/planner.ts`
- `src/coding/planner.test.ts`
- `src/coding/coding-agent.ts`
- `src/coding/coding-agent.test.ts`

---

## Recommended Next Slice

1. Replace the current minimal exact-block `patch` edit with a true patch/hunk model
2. Persist context cache across runs using file hashes
3. Expand artifacts into a replay/debug bundle
4. Add prompt-budget accounting at the run level, not just content truncation

---

## Resume Notes

- Branch is safe to continue from directly
- Current PR for the follow-up patch slice: `#55`
- The current commit is a good PR checkpoint if needed
- If resuming later, start with the true patch/hunk edit model; that is the biggest remaining safety improvement in `v0.3.5`
