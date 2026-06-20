# Locode v0.4a — Deterministic Retrieval Core — Implementation Progress

**Started:** 2026-06-20
**Branch:** `feat/v04a-deterministic-retrieval`
**Design:** [v0.4 — Codebase Intelligence](2026-03-10-v04-codebase-intelligence.md)
**Scope:** v0.4 phase A only — file index, symbol index, indexer, context retriever, budget manager, `symbol_lookup` tool. No embedding index, no dependency graph (those are v0.4b/v0.4c).

---

## Definition of Done

- [ ] `index` + `context_retrieval` config sections in schema with defaults synced to `locode.yaml`
- [ ] `FileIndex` scans a repo respecting `.gitignore` + config ignore patterns, records path/lang/size/hash
- [ ] `SymbolIndex` extracts functions/classes/types/interfaces/enums for TypeScript + JavaScript (+ Python)
- [ ] `CodebaseIndexer` orchestrates file + symbol indexes, supports incremental updates via file hashes
- [ ] `BudgetManager` allocates a token budget across files by priority weight
- [ ] `ContextRetriever` pipeline: mentioned files → symbol search → sibling tests → rank → truncate to budget
- [ ] `symbol_lookup` tool registered in the default tool registry
- [ ] `ContextRetriever` optionally wired into `CodingAgent.ANALYZE` (backwards-compatible — no-op when index absent)
- [ ] Index persists to disk and loads on subsequent runs
- [ ] All tests pass, `npm run build` succeeds, lint clean

---

## Implementation Decisions

### Symbol extraction: regex-based, not tree-sitter (for now)

The v0.4 design spec calls for `web-tree-sitter` (WASM) for AST-based symbol extraction. This v0.4a slice ships a **regex-based extractor** instead, behind a `SymbolExtractor` interface so `web-tree-sitter` can be swapped in later without changing `SymbolIndex`'s API.

**Why:**
- Keeps the bundle small (AGENTS.md: don't add deps without considering bundle size). `web-tree-sitter` + per-language `.wasm` grammars add ~2-5 MB of static assets.
- Regex extraction is fully testable without loading WASM, and covers the common cases (top-level functions, classes, interfaces, exported symbols) that the agent needs for `symbol_lookup`.
- The `SymbolExtractor` interface means the tree-sitter adapter is a drop-in replacement later — no API churn.

**Trade-off:** regex extraction misses nested scopes, overloaded signatures, and some edge cases. Acceptable for v0.4a's "fast path first" goal; the LLM-driven ANALYZE fallback still covers complex cases.

### `find_references` tool deferred to v0.4b

The design spec lists `find_references` as a v0.4 tool, but it depends on the dependency graph (import tracking) which is v0.4b. Shipping `symbol_lookup` only in v0.4a.

---

## Findings / Things to Improve

Observed while implementing v0.4a. Not blocking; captured for future work.

### 1. Config defaults: `.default({})` does not recursively apply inner defaults in Zod

`SomeSchema.default({})` sets the default to a literal `{}`, NOT the schema-parsed result. Inner field defaults are NOT applied. The fix is `.default(SomeSchema.parse({}))` (or reuse a pre-parsed `DEFAULT_X` constant).

**Impact:** Any future config section added with `.default({})` will silently produce empty objects instead of defaulted ones. The existing `runtime`, `performance`, and `agent` sections all pass explicit default objects, which masks this. Consider a helper or a lint rule.

**Location:** `src/config/schema.ts` — `index` and `context_retrieval` now use `DEFAULT_INDEX_CONFIG` / `DEFAULT_CONTEXT_RETRIEVAL_CONFIG`.

### 2. `CONFIG_TEMPLATE` in `src/cli/setup.ts` is a third source of truth (known)

Already noted in `docs/plans/misc-todos.md` under "Config template duplication". The template is intentionally minimal (only required fields), so new defaulted sections like `index` and `context_retrieval` don't need to be added — schema defaults cover them. But the duplication risk remains for any future *required* config field. The proposed fix (single `DEFAULT_CONFIG` constant) would resolve this.

### 3. `CodingAgent.analyze` fast-path is ripe for `ContextRetriever` integration

The existing `analyze()` in `src/coding/coding-agent.ts:219` already does mentioned-file extraction + sibling-test discovery + LLM fallback — essentially a hand-rolled mini-retriever. v0.4a's `ContextRetriever` generalizes this. Once the retriever is wired in, the agent's `extractMentionedFiles` / `findLikelyTestFiles` / `pushBudgetedFile` logic could be delegated to it, reducing duplication. Deferred to avoid changing working behavior in this slice.

---

## Verification Status

- `npm test` passes — 398 tests (60 new for v0.4a)
- `npm run build` passes
- `npm run lint` passes

