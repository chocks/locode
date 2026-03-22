# Locode v0.3.5 — Agent Hardening + Performance

**Date:** 2026-03-22
**Status:** Proposed
**Scope:** Make the coding agent safe, consistent, and fast enough to support repo intelligence and workflows
**Depends on:** v0.3 (coding agent)

---

## 1. Goal

Bridge the gap between "agent loop exists" and "agent loop is trustworthy". This milestone hardens mutation safety, unifies task routing, and optimizes for local-model latency on laptops.

---

## 2. Design Principles

1. **One intent decision** — one classifier decides `chat | inspect | edit | workflow`; the REPL and orchestrator do not maintain separate heuristics
2. **Safety must be real** — approval policy is enforced in the executor, not implied by docs or config
3. **Patch with preconditions** — edits carry anchors or file hashes so Locode can detect stale context before mutating files
4. **Artifacts over mystery** — every run stores plan, tool calls, edits, diffs, validation, and approvals in `.locode/runs/`
5. **Fast path first** — deterministic file/symbol/path retrieval happens before expensive LLM loops
6. **Optimize for laptops** — reuse context, warm indexes, parallelize reads, and minimize large prompts

---

## 3. Main Deliverables

- `TaskClassifier` replacing duplicate coding-task regex checks in CLI/orchestrator
- `ApprovalPolicy` wired into `ToolExecutor` for actual confirmation enforcement
- `PatchOperation` / `EditPrecondition` replacing loose substring-only edits as the preferred mutation format
- `RunArtifactStore` for replayable execution logs and diff bundles
- `RetrievalFastPath` for mentioned files, path hints, sibling tests, recent edits, and git-local context
- `PerformanceBudget` settings for max parallel reads, prompt budget, and index warm-up

---

## 4. Performance Improvements

### Local LLM latency

- Cache tool schemas and rendered tool prompts once per session
- Avoid round-tripping through the model for obvious retrieval:
  mentioned files, exact paths, recently edited files, sibling tests, and direct symbol hits
- Read files in parallel with strict caps
- Prefer summaries and bounded snippets over full-file injection
- Reuse validated context across iterations instead of rebuilding the full ANALYZE prompt

### Retrieval speed

- Maintain a cheap file manifest even before full indexing
- Track file hashes so unchanged files are not re-read or re-ranked
- Warm the file tree and symbol index on startup when enabled
- Keep semantic search optional and lazy; only invoke it when deterministic retrieval confidence is low

### Mutation speed and safety

- Preview diffs from original-to-modified buffers before writing
- Use a journaled apply/rollback path so failed runs revert cleanly, including newly created files
- Validate only the impacted scope when possible:
  targeted test command, lint-on-file, then full-project validation when needed

---

## 5. Config Additions

```yaml
runtime:
  artifacts_dir: .locode/runs
  approval_mode: prompt   # prompt | auto | read-only
  classifier: unified     # unified | legacy

performance:
  parallel_reads: 4
  warm_index_on_startup: true
  cache_context: true
  max_prompt_chars: 24000
  lazy_semantic_search: true
```

---

## 6. Exit Criteria

- Tool confirmations are enforced by runtime behavior, not only config shape
- Coding mode behavior is identical across REPL, single-shot CLI, and future workflow entrypoints
- Diffs and rollback are correct for create, replace, insert, delete, and retry flows
- Every run writes an artifact bundle the user can inspect
- Median local-agent "analyze + plan" latency drops materially through deterministic fast paths and caching

---

## 7. Why This Milestone Exists

v0.4 and v0.5 both assume a stable execution core. Without that, better retrieval and more automation mostly amplify failure modes:

- bad routing wastes local-model time
- weak edit preconditions create incorrect patches
- silent approval gaps are unsafe
- missing artifacts make failures hard to debug
- workflow automation compounds all of the above

This milestone is the foundation for "snappy, safe, developer-trustworthy" behavior.
