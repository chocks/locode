# v0.3.5 Agent Hardening + Performance — Implementation Progress

**Started:** 2026-03-22
**Design:** [v0.3.5 Agent Hardening + Performance](2026-03-22-v035-agent-hardening-performance.md)
**Current branch:** `feat/v035-final-hardening`
**Checkpoint commit:** `50556f5`
**Approach:** Incremental slices with clean commit checkpoints

---

## Status

### Definition of Done

The `v0.3.5` milestone is complete when all of the following are checked:

- [x] Unified task classification is wired into runtime behavior
- [x] Real tool approval enforcement is wired into the executor and REPL flow
- [x] Patch-style edits with preconditions are supported end-to-end in planner, agent, and editor
- [x] Edit preview + rollback are trustworthy for create/replace/insert/delete/patch flows
- [x] Run artifacts are written for every run under `.locode/runs`
- [x] Run artifacts include enough structured data to debug a failed or successful coding run
- [x] Deterministic fast-path retrieval is in place for obvious file context
- [x] Analyze-context caching exists in memory and can persist across runs
- [x] Prompt budgeting is enforced at the run level, not only as per-file truncation
- [x] Patch generation and fallback behavior are robust enough for repeated retry flows
- [x] Persistent cache cleanup/eviction policy is implemented and bounded

### Completed

- Minimal `patch` edit operation added:
  unified diff based patch application with real hunks via the existing `diff` library
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
- Coding agent now:
  can persist analyze-context cache across runs using file hashes
- Coding agent now:
  enforces a run-level prompt budget across gathered file context and step file injections
- Run artifact storage added under `.locode/runs`
- Artifact store now writes:
  `run.json`, `prompt.txt`, `content.txt`, `summary.txt`, optional `metadata.json`
- Artifact store now also writes replay/debug helpers when structured metadata is available:
  `result.json`, `debug.json`, `edits.json`, `diffs.patch`
- Editor rollback now deletes newly created files
- Edit preconditions added:
  `fileHash`, `mustContain`
- Planner, coding-agent, and editor now understand a unified-diff `patch` edit shape
- Planner preserves edit preconditions in plan parsing
- Coding agent attaches lightweight preconditions to generated edits
- Coding agent is rebuilt after MCP tool registration so coding-mode sees updated tools
- Default repo context now includes `AGENTS.md` and `CLAUDE.md`
- Patch application now falls back to strict exact-hunk replacement when unified patch application fails
- Persistent context cache is now bounded by configurable entry-count and total-size limits

### Remaining to Finish v0.3.5

- None

### Explicitly Deferred Beyond v0.3.5

- Rich artifact replay tooling / run viewer
- Workflow intent integration beyond classification

### Verification Status

- `npm run build` passes
- `npm test` passes except existing sandbox-blocked MCP OAuth tests that write under `~/.locode/...`

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

1. Start the next milestone rather than extending `v0.3.5`
2. Leave richer artifact replay/viewer tooling and workflow-intent integration for later milestones

---

## Resume Notes

- Branch is safe to continue from directly
- Current PR for this slice: `#63`
- The current commit is a good PR checkpoint if needed
- `v0.3.5` is complete; resume from the next milestone instead of extending this slice
