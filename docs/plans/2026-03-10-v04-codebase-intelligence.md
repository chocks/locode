# Locode v0.4 — Codebase Intelligence

**Date:** 2026-03-10
**Status:** Proposed
**Scope:** Persistent codebase index, symbol parsing, embeddings, smart context retrieval
**Depends on:** v0.3 (coding agent — agent loop, tool executor, code editor)

---

## 1. Goal

Make the coding agent **repo-aware**. Instead of relying on the LLM to guess what to search for, build a persistent codebase index that provides instant file discovery, symbol lookup, semantic search, and dependency awareness.

---

## 2. Design Principles

1. **Index once, query fast** — build index on first run, incrementally update on file changes
2. **Tools, not magic** — codebase intelligence is exposed as tools the agent calls (fits v0.2's registry)
3. **Pure JS** — web-tree-sitter (WASM) for parsing, Ollama embeddings for vectors, no native deps
4. **Configurable scope** — user controls which dirs to index, which to ignore
5. **Graceful degradation** — agent works without index (falls back to ripgrep), index just makes it faster

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
                    │  │ Embedding Index       │  │  ← semantic search
                    │  │ vector, file, chunk   │  │
                    │  │ (Ollama embeddings)   │  │
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
                    │   1. Analyze query          │
                    │   2. Symbol search          │
                    │   3. Semantic search        │
                    │   4. Dependency walk        │
                    │   5. Rank + truncate        │
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
│   ├── embedding-index.ts             # Ollama embedding generation + vector store
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
│   ├── semantic-search.ts             # Search embedding index
│   └── find-references.ts            # Find files that import/use a symbol
```

**New files: 18** (including tests). **Modified: 3** (orchestrator.ts, config/schema.ts, locode.yaml).

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

export class EmbeddingIndex {
  /** Generate embeddings for code chunks using Ollama */
  async indexFile(path: string, content: string): Promise<void>

  /** Semantic search: find code chunks most similar to query */
  async search(query: string, topK?: number): Promise<Array<EmbeddingEntry & { score: number }>>

  async save(path: string): Promise<void>
  async load(path: string): Promise<void>
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
}

export class ContextRetriever {
  constructor(
    private indexer: CodebaseIndexer,
    private config: RetrievalConfig,
  ) {}

  /**
   * Smart context retrieval pipeline:
   * 1. Extract keywords/symbols from query
   * 2. Symbol index search
   * 3. Semantic search (embeddings)
   * 4. Dependency expansion (files that import matched files)
   * 5. Rank by relevance, truncate to budget
   */
  async retrieve(query: string): Promise<GatheredContext>
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

## 6. Integration with v0.3 Agent

The key integration point is the **ANALYZE phase** of the CodingAgent. In v0.3, ANALYZE asks the LLM what to search for. In v0.4, the `ContextRetriever` does most of the work before the LLM is involved:

```typescript
// Modified ANALYZE phase in CodingAgent

async analyze(prompt: string): Promise<GatheredContext> {
  // v0.4: use ContextRetriever if index is available
  if (this.indexer?.isIndexed()) {
    const smartContext = await this.contextRetriever.retrieve(prompt)
    // LLM can still request additional tools if needed
    return smartContext
  }

  // v0.3 fallback: LLM-driven search
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
  description: 'Find code semantically similar to a natural language description',
  category: 'search',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  handler: async (args) => {
    const results = await indexer.embeddings.search(String(args.query), 5)
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
  embedding_model: z.string().default('nomic-embed-text'),
  chunk_size: z.number().default(50),  // lines per chunk
  storage_dir: z.string().default('.locode/index'),
  auto_update: z.boolean().default(true),  // re-index on file changes
})

const ContextRetrievalSchema = z.object({
  max_files: z.number().default(5),
  max_tokens_per_file: z.number().default(2000),
  max_total_tokens: z.number().default(8000),
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
  embedding_model: nomic-embed-text
  chunk_size: 50
  storage_dir: .locode/index
  auto_update: true

context_retrieval:
  max_files: 5
  max_tokens_per_file: 2000
  max_total_tokens: 8000
```

---

## 8. External Dependencies

| Package | Purpose | Type |
|---|---|---|
| `web-tree-sitter` | AST parsing (WASM, no native compilation) | Pure JS |
| Tree-sitter language grammars | `.wasm` files for each language | Static assets |
| Ollama embedding API | Vector generation via existing Ollama connection | Already installed |

No new native dependencies. Embeddings use the existing Ollama connection with a dedicated embedding model (e.g., `nomic-embed-text`).

### Vector Storage

For v0.4, use a simple brute-force cosine similarity search on in-memory Float32Arrays. This is fast enough for repos up to ~10K files. If needed later, add `hnswlib-node` for approximate nearest neighbor search.

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
| Semantic search | < 100ms | Brute-force cosine similarity |
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
- [ ] Embedding index generates and searches vectors via Ollama
- [ ] Dependency graph tracks import/require relationships
- [ ] Incremental update only re-indexes changed files
- [ ] ContextRetriever returns ranked, budget-constrained context
- [ ] New tools (symbol_lookup, semantic_search, find_references) work in agent loop
- [ ] Index persists to disk and loads on subsequent runs
- [ ] All tests pass, build succeeds
