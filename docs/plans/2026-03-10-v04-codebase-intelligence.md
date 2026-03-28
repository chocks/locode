# Locode v0.4 — Codebase Intelligence

**Date:** 2026-03-10
**Status:** Proposed
**Scope:** Persistent codebase index, deterministic context retrieval, optional semantic search
**Depends on:** v0.3.5 (agent hardening + performance)

---

## 1. Goal

Make the coding agent **repo-aware**. Instead of relying on the LLM to guess what to search for, build a persistent codebase index that provides instant file discovery, symbol lookup, semantic search, and dependency awareness.

---

## 2. Design Principles

1. **Index once, query fast** — build index on first run, incrementally update on file changes
2. **Tools, not magic** — codebase intelligence is exposed as tools the agent calls (fits v0.2's registry)
3. **Fast path first** — exact path, symbol, git-local, and test-file retrieval happens before semantic search
4. **Pure JS** — web-tree-sitter (WASM) for parsing; optional **qmd** ([github.com/tobi/qmd](https://github.com/tobi/qmd)) for BM25 + vector semantic search
5. **Configurable scope** — user controls which dirs to index, which to ignore
6. **Graceful degradation** — agent works without index (falls back to ripgrep), index just makes it faster

---

## v0.4 and Model Specialization

v0.4 is the point where the optional `Model Specialization` track starts its infrastructure work. That work is complementary to codebase intelligence, not a separate milestone and not a shipping gate for v0.4.

**Model-specialization work that belongs in or alongside v0.4**
- split router config from local-executor config so routing experiments do not change executor behavior
- enrich run artifacts with session-linked traces, route confidence, tool trajectories, and latency
- tighten local tool prompts/schemas to make small models more deterministic
- build eval harnesses for routing and bounded local-tool tasks

**Why it fits here**
- v0.4 increases deterministic local context gathering, which improves the quality of local-task traces
- v0.4 retrieval and context tools create the exact usage data needed to evaluate routing and narrow local-model behavior
- this work improves the local path on weak hardware without changing v0.4's core goal of repo-aware retrieval

**Shared infrastructure note**
- v0.4's optional embedding index (qmd) could also serve the embedding-based routing classifier proposed in the model specialization memo (Phase 3b). If both are built, the embedding pipeline should be evaluated for reuse rather than building two separate vector systems.

**Constraint**
- classifier experiments and local-model fine-tuning must not block v0.4 delivery

---

## 3. Architecture

```
                    ┌────────────────────────────┐
                    │    Codebase Index           │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │ File Tree Index       │  │  ← fast file discovery
                    │  │ path, lang, size, hash│  │
                    │  └──────────────────────┘  │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │ Symbol Index          │  │  ← function/class lookup
                    │  │ name, type, file, loc │  │
                    │  │ (tree-sitter WASM)    │  │
                    │  └──────────────────────┘  │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │ Embedding Index       │  │  ← optional semantic search
                    │  │ vector, file, chunk   │  │
                    │  │ (qmd — BM25 + vector) │  │
                    │  └──────────────────────┘  │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │ Dependency Graph      │  │  ← import/require tracking
                    │  │ file → [imports]      │  │
                    │  └──────────────────────┘  │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │   Context Retriever         │
                    │                            │
                    │   1. Exact path / mentions  │
                    │   2. Symbol search          │
                    │   3. Test + sibling files   │
                    │   4. Dependency walk        │
                    │   5. Semantic search (opt.) │
                    │   6. Rank + truncate        │
                    │                            │
                    │   Output: GatheredContext   │
                    └────────────┬───────────────┘
                                 │
                                 ▼
                    CodingAgent.ANALYZE phase (v0.3)
```

---

## 4. New Files

```
src/
├── index/                              # NEW — codebase indexing
│   ├── file-index.ts                  # File tree scanner + metadata
│   ├── file-index.test.ts
│   ├── symbol-index.ts                # Tree-sitter symbol extraction
│   ├── symbol-index.test.ts
│   ├── embedding-index.ts             # Optional qmd adapter, enabled only when configured
│   ├── embedding-index.test.ts
│   ├── dependency-graph.ts            # Import/require graph builder
│   ├── dependency-graph.test.ts
│   ├── indexer.ts                     # Orchestrates all indexes, handles incremental updates
│   ├── indexer.test.ts
│   └── types.ts                       # Shared index types
├── context/                            # NEW — smart context retrieval
│   ├── context-retriever.ts           # Query analysis → ranked context
│   ├── context-retriever.test.ts
│   ├── budget-manager.ts              # Priority-weighted token allocation
│   ├── budget-manager.test.ts
│   └── types.ts
├── tools/definitions/                  # NEW tools registered in v0.2 registry
│   ├── symbol-lookup.ts               # Search symbol index
│   ├── semantic-search.ts             # Optional semantic search tool
│   └── find-references.ts            # Find files that import/use a symbol
```

**New files: 18** (including tests). **Modified: 3** (orchestrator.ts, config/schema.ts, locode.yaml).

> **Note on `embedding-index.ts`:** Rather than a full custom vector store (~200 lines of Float32Array math + persistence), this file is a thin adapter (~60 lines) delegating to the qmd TypeScript SDK. qmd handles chunk storage, BM25 + vector hybrid search, incremental index updates, and on-disk persistence. See §9 for the integration decision.

---

## 5. TypeScript Interfaces

### 5.1 Index Types

```typescript
// src/index/types.ts

export interface FileEntry {
  path: string          // relative to repo root
  language: string      // detected from extension
  size: number          // bytes
  hash: string          // content hash for change detection
  lastIndexed: number   // timestamp
}

export interface SymbolEntry {
  name: string
  type: 'function' | 'class' | 'method' | 'variable' | 'type' | 'interface' | 'enum'
  file: string
  lineStart: number
  lineEnd: number
  signature?: string     // e.g., "function foo(bar: string): boolean"
  exported: boolean
}

export interface EmbeddingEntry {
  vector: Float32Array
  file: string
  chunkStart: number    // line number
  chunkEnd: number
  content: string       // the code chunk text
}

export interface DependencyEdge {
  from: string          // file that imports
  to: string            // file being imported
  symbols: string[]     // what's imported (e.g., ['Router', 'RouteDecision'])
}
```

### 5.2 Indexes

```typescript
// src/index/file-index.ts

export class FileIndex {
  private files: Map<string, FileEntry> = new Map()

  /** Scan repo, respecting .gitignore and config ignore patterns */
  async build(repoRoot: string, config: IndexConfig): Promise<void>

  /** Incremental update — only re-index changed files */
  async update(): Promise<{ added: string[]; removed: string[]; changed: string[] }>

  /** Find files by glob pattern */
  find(glob: string): FileEntry[]

  /** Find files by language */
  findByLanguage(lang: string): FileEntry[]

  /** Get all indexed files */
  all(): FileEntry[]

  /** Persist to disk */
  async save(path: string): Promise<void>
  async load(path: string): Promise<void>
}
```

```typescript
// src/index/symbol-index.ts

export class SymbolIndex {
  private symbols: SymbolEntry[] = []

  /** Parse a file using tree-sitter WASM and extract symbols */
  async indexFile(path: string, content: string, language: string): Promise<SymbolEntry[]>

  /** Search symbols by name (fuzzy match) */
  search(query: string, opts?: { type?: SymbolEntry['type']; file?: string }): SymbolEntry[]

  /** Get all symbols in a file */
  forFile(path: string): SymbolEntry[]

  /** Get the code block for a symbol (reads file, extracts lineStart→lineEnd) */
  async getCode(symbol: SymbolEntry): Promise<string>

  async save(path: string): Promise<void>
  async load(path: string): Promise<void>
}
```

```typescript
// src/index/embedding-index.ts
// Thin adapter over the qmd SDK — no custom vector math required.

import { QmdClient } from 'qmd'  // npm package from github.com/tobi/qmd

export class EmbeddingIndex {
  private client: QmdClient
  private collection: string  // one collection per repo root (e.g., "locode-src")

  constructor(config: { storageDir: string; collection: string }) {
    this.collection = config.collection
    this.client = new QmdClient({ dataDir: config.storageDir })
  }

  /**
   * Index a file's content as searchable chunks.
   * qmd handles chunking, embedding generation, and persistence internally.
   */
  async indexFile(path: string, content: string): Promise<void>

  /**
   * Hybrid semantic + keyword search via qmd.
   * Returns ranked results with BM25 + vector scores combined.
   */
  async search(query: string, topK = 5): Promise<Array<EmbeddingEntry & { score: number }>>

  /** Remove a file from the index (called on file deletion/rename) */
  async removeFile(path: string): Promise<void>

  // save/load not needed — qmd persists to storageDir automatically
}
```

```typescript
// src/index/dependency-graph.ts

export class DependencyGraph {
  /** Build import graph by parsing import/require statements */
  async build(files: FileEntry[]): Promise<void>

  /** Get files that this file imports */
  importsOf(file: string): DependencyEdge[]

  /** Get files that import this file */
  importedBy(file: string): DependencyEdge[]

  /** Get the full dependency chain (transitive) up to depth N */
  dependencyChain(file: string, depth?: number): string[]

  async save(path: string): Promise<void>
  async load(path: string): Promise<void>
}
```

### 5.3 Indexer (Orchestrator)

```typescript
// src/index/indexer.ts

export interface IndexConfig {
  root: string                  // repo root
  ignore: string[]              // glob patterns to ignore
  languages: string[]           // languages to parse symbols for
  embedding_model: string       // Ollama model for embeddings
  chunk_size: number           // lines per embedding chunk
  storage_dir: string          // where to persist indexes
}

export class CodebaseIndexer {
  constructor(private config: IndexConfig) {}

  /** Full index build (first run) */
  async buildAll(): Promise<IndexStats>

  /** Incremental update (subsequent runs) */
  async update(): Promise<IndexStats>

  /** Check if index exists and is fresh */
  isIndexed(): boolean

  /** Access individual indexes */
  get files(): FileIndex
  get symbols(): SymbolIndex
  get embeddings(): EmbeddingIndex
  get dependencies(): DependencyGraph
}

export interface IndexStats {
  files: number
  symbols: number
  embeddings: number
  dependencies: number
  buildTimeMs: number
}
```

### 5.4 Context Retriever

```typescript
// src/context/context-retriever.ts

export interface RetrievalConfig {
  max_files: number            // default: 5
  max_tokens_per_file: number  // default: 2000
  max_total_tokens: number     // default: 8000
  strategy: 'deterministic-first' | 'semantic-first'
}

export interface RetrievedContext extends GatheredContext {
  confidence: number
  strategyUsed: Array<'mentioned-path' | 'recent-files' | 'symbol-index' | 'test-discovery' | 'dependency' | 'semantic-search'>
}

export class ContextRetriever {
  constructor(
    private indexer: CodebaseIndexer,
    private config: RetrievalConfig,
  ) {}

  /**
   * Smart context retrieval pipeline:
   * 1. Exact path and mentioned-file resolution
   * 2. Recent file / recent edit fast path
   * 3. Symbol index search
   * 4. Test-file and sibling-file expansion
   * 5. Dependency expansion (lightweight)
   * 6. Semantic search only if confidence is still low
   * 7. Rank by relevance, truncate to budget
   */
  async retrieve(query: string): Promise<RetrievedContext>
}
```

### 5.5 Context Budget Manager

```typescript
// src/context/budget-manager.ts

export interface BudgetPriority {
  source: 'direct_match' | 'symbol_match' | 'semantic_match' | 'dependency' | 'git_context'
  weight: number  // 0-1, higher = more budget
}

export class BudgetManager {
  constructor(private totalTokens: number) {}

  /**
   * Allocate tokens across files based on priority weights.
   * Higher-priority files get more of the budget.
   * Returns truncated file contents.
   */
  allocate(
    files: Array<{ path: string; content: string; priority: BudgetPriority }>,
  ): Array<{ path: string; content: string; tokensUsed: number }>
}
```

---

## 6. Integration with v0.3.5 Agent

The key integration point is the **ANALYZE phase** of the CodingAgent. In v0.3, ANALYZE asks the LLM what to search for. In v0.3.5, deterministic fast paths are added. In v0.4, the `ContextRetriever` becomes the default path and the LLM asks for more context only when retrieval confidence is low:

```typescript
// Modified ANALYZE phase in CodingAgent

async analyze(prompt: string): Promise<GatheredContext> {
  // v0.4: use deterministic retrieval first if index is available
  if (this.indexer?.isIndexed()) {
    const smartContext = await this.contextRetriever.retrieve(prompt)
    if (smartContext.confidence >= 0.7) return smartContext
    // LLM can still request additional tools if needed
    return this.analyzeWithFallback(prompt, smartContext)
  }

  // v0.3.5 fallback: deterministic fast path + bounded LLM search
  return this.analyzeFallback(prompt)
}
```

### New Tools in Registry

```typescript
// Registered in the v0.2 tool registry

const symbolLookupTool: ToolDefinition = {
  name: 'symbol_lookup',
  description: 'Find function, class, or variable definitions by name',
  category: 'search',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      type: { type: 'string', enum: ['function', 'class', 'method', 'variable'] },
    },
    required: ['name'],
  },
  handler: async (args) => {
    const results = indexer.symbols.search(String(args.name), { type: args.type as any })
    return { success: true, output: JSON.stringify(results.slice(0, 10)) }
  },
}

const semanticSearchTool: ToolDefinition = {
  name: 'semantic_search',
  // Optional: only enabled when semantic indexing is configured
  description: 'Find code by natural language description — uses keyword + semantic hybrid search',
  category: 'search',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      top_k: { type: 'number', description: 'Max results to return (default 5)' },
    },
    required: ['query'],
  },
  handler: async (args) => {
    const results = await indexer.embeddings.search(String(args.query), Number(args.top_k ?? 5))
    return { success: true, output: JSON.stringify(results) }
  },
}
```

---

## 7. Config Additions

```typescript
// Added to src/config/schema.ts

const IndexConfigSchema = z.object({
  enabled: z.boolean().default(true),
  ignore: z.array(z.string()).default([
    'node_modules', 'dist', '.git', 'coverage', '*.min.js', '*.lock'
  ]),
  languages: z.array(z.string()).default([
    'typescript', 'javascript', 'python', 'go', 'rust'
  ]),
  chunk_size: z.number().default(50),  // lines per chunk
  storage_dir: z.string().default('.locode/index'),
  auto_update: z.boolean().default(true),  // re-index on file changes
})

const ContextRetrievalSchema = z.object({
  max_files: z.number().default(5),
  max_tokens_per_file: z.number().default(2000),
  max_total_tokens: z.number().default(8000),
  strategy: z.enum(['deterministic-first', 'semantic-first']).default('deterministic-first'),
})
```

```yaml
# locode.yaml additions

index:
  enabled: true
  ignore:
    - node_modules
    - dist
    - .git
    - coverage
    - "*.min.js"
    - "*.lock"
  languages:
    - typescript
    - javascript
    - python
    - go
    - rust
  chunk_size: 50
  storage_dir: .locode/index
  auto_update: true

context_retrieval:
  max_files: 5
  max_tokens_per_file: 2000
  max_total_tokens: 8000
  strategy: deterministic-first
```

---

## 8. Delivery Phases

Ship v0.4 in phases instead of landing the whole retrieval stack at once:

1. **v0.4a: deterministic retrieval core**
   file index, symbol index, mentioned-file resolution, sibling tests, ranking, truncation
2. **v0.4b: lightweight dependency hints**
   import graph for expansion and better ranking
3. **v0.4c: optional semantic search**
   qmd integration only after measuring retrieval misses that deterministic methods do not solve

This keeps the local-first UX snappy and avoids paying embedding/indexing cost before it is justified.

---

## 9. External Dependencies

| Package | Purpose | Type |
|---|---|---|
| `web-tree-sitter` | AST parsing (WASM, no native compilation) | Pure JS |
| Tree-sitter language grammars | `.wasm` files for each language | Static assets |
| `qmd` | BM25 + vector hybrid search, chunk storage, index persistence | npm package |

### Why qmd is optional instead of mandatory

The original plan called for a custom `EmbeddingIndex` using Ollama embeddings + brute-force cosine similarity on `Float32Array`s, with manual persistence to disk. If semantic retrieval proves necessary, **qmd** ([github.com/tobi/qmd](https://github.com/tobi/qmd)) replaces all of this:

| Concern | Custom approach | qmd |
|---|---|---|
| Embedding generation | Ollama HTTP call per chunk | Built-in (local GGUF model via node-llama-cpp) |
| Search quality | Vector similarity only | **BM25 + vector hybrid** — better for code |
| Index persistence | Manual JSON/binary serialization | Automatic, handled by qmd |
| Incremental updates | Custom change detection | Built-in (filesystem scan + hash) |
| Lines of code owned | ~200 (vector math + storage) | ~60 (adapter only) |

**Trade-off:** qmd bundles its own model runtime (`node-llama-cpp`) rather than reusing Ollama. This adds startup and indexing cost, so semantic indexing should stay opt-in and lazy.

**MCP server option:** qmd also ships as an MCP server. If the user runs `qmd serve`, the `EmbeddingIndex` adapter can use qmd's MCP transport instead of the SDK, keeping the indexer process separate. This is optional — the SDK path works for single-user local use.

### Config: qmd section

```typescript
// Added to src/config/schema.ts alongside IndexConfigSchema

const QmdConfigSchema = z.object({
  collection: z.string().default('locode-codebase'),  // qmd collection name
  model: z.string().default('nomic-embed-text'),       // GGUF embedding model
  use_mcp_server: z.boolean().default(false),          // use qmd MCP server instead of SDK
  mcp_server_url: z.string().optional(),               // e.g., "http://localhost:3000"
})
```

```yaml
# locode.yaml additions

qmd:
  collection: locode-codebase
  model: nomic-embed-text
  use_mcp_server: false
  # mcp_server_url: http://localhost:3000  # uncomment to use shared qmd server
```

---

## 9. Index Lifecycle

```
First run:
  locode chat
    → detect repo root (git rev-parse)
    → check .locode/index/ for existing index
    → not found → full build (may take 10-30s for large repos)
    → save to .locode/index/

Subsequent runs:
  locode chat
    → load index from .locode/index/
    → check for changed files (git diff + file hashes)
    → incremental update (usually <1s)
    → ready

Background updates:
  During session, watch for file saves
    → re-index changed files
    → update embeddings for modified chunks
```

---

## 10. Performance Targets

| Operation | Target | Notes |
|---|---|---|
| Full index (1K files) | < 15s | File scan + tree-sitter parsing + embeddings |
| Full index (10K files) | < 60s | Parallelized per language |
| Incremental update | < 1s | Only changed files |
| Symbol search | < 10ms | In-memory map lookup |
| Semantic search | < 100ms | qmd hybrid BM25 + vector (pre-built index) |
| Context retrieval | < 200ms | Pipeline: symbol + semantic + budget |

---

## 11. CLI Commands

```bash
locode index              # Build/rebuild codebase index
locode index --status     # Show index stats
locode index --rebuild    # Force full rebuild
```

---

## 12. What This Enables

- **v0.5**: Workflow engine uses smart context retrieval to build ContextBundles for Claude automatically
- Dramatically better ANALYZE phase — agent finds relevant code instantly instead of guessing
- Token savings from precise context (send functions, not files)

---

## 13. Success Criteria

- [ ] File index scans repo respecting .gitignore
- [ ] Symbol index extracts functions/classes/types for TypeScript and JavaScript
- [ ] Embedding index delegates to qmd SDK (BM25 + vector hybrid search, automatic persistence)
- [ ] `use_mcp_server: true` routes qmd calls through MCP transport instead of SDK
- [ ] Dependency graph tracks import/require relationships
- [ ] Incremental update only re-indexes changed files
- [ ] ContextRetriever returns ranked, budget-constrained context
- [ ] New tools (symbol_lookup, semantic_search, find_references) work in agent loop
- [ ] Index persists to disk and loads on subsequent runs
- [ ] All tests pass, build succeeds
