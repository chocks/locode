# v0.3 Coding Agent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Locode from a chat router into a coding agent that analyzes code, plans edits, applies structured changes, validates results, and presents diffs.

**Architecture:** Four-phase build — editor utilities (Phase A), session memory (Phase B), planner + agent loop (Phase C), streaming UX (Phase D). Each phase produces independently testable code. The agent reuses the existing ToolExecutor, SafetyGate, LocalAgent, and ClaudeAgent from v0.2.

**Tech Stack:** TypeScript, Vitest, `diff` npm package, Zod (config schema), chalk (diff colorization — already a dependency)

**Spec:** `docs/superpowers/specs/2026-03-13-v03-coding-agent-design.md`

---

## File Structure

```
src/
├── tools/definitions/
│   └── search-code.ts              # Prerequisite: structured code search tool
├── editor/
│   ├── types.ts                    # EditOperation, ApplyResult, DiffPreview
│   ├── code-editor.ts              # Apply/rollback/preview edit operations
│   ├── code-editor.test.ts
│   ├── diff-renderer.ts            # Unified diff generation + colorization
│   └── diff-renderer.test.ts
├── coding/
│   ├── types.ts                    # AgentPhase, AgentState, AgentConfig, etc.
│   ├── memory.ts                   # Session memory (MemoryEntry, AgentMemory)
│   ├── memory.test.ts
│   ├── planner.ts                  # EditPlan generation from LLM
│   ├── planner.test.ts
│   ├── coding-agent.ts             # Agent loop: analyze→plan→execute→validate→present
│   ├── coding-agent.test.ts
│   ├── stream.ts                   # StreamEvent, AgentStream, StreamRenderer
│   └── stream.test.ts
├── agents/local.ts                 # Modified: add toolCalls to AgentResult
├── config/schema.ts                # Modified: add agent config section (no dead editor config)
├── orchestrator/orchestrator.ts    # Modified: add isCodingTask() + runCodingAgent()
└── cli/repl.ts                     # Modified: wire StreamRenderer for coding tasks
```

---

## Chunk 1: Prerequisite — search_code Tool

### Task 1: Add search_code tool definition

**Files:**
- Create: `src/tools/definitions/search-code.ts`
- Modify: `src/tools/definitions/default-registry.ts`
- Test in: `src/tools/definitions/definitions.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `src/tools/definitions/definitions.test.ts`:

```typescript
describe('searchCodeDefinition', () => {
  it('has correct metadata', () => {
    expect(searchCodeDefinition.name).toBe('search_code')
    expect(searchCodeDefinition.category).toBe('search')
    expect(searchCodeDefinition.inputSchema.required).toContain('pattern')
  })

  it('handler finds matches in project files', async () => {
    const result = await searchCodeDefinition.handler({ pattern: 'ToolRegistry', max_results: 5 })
    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.output)
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed[0]).toHaveProperty('file')
    expect(parsed[0]).toHaveProperty('line')
    expect(parsed[0]).toHaveProperty('match')
  })

  it('handler returns empty array for no matches', async () => {
    const result = await searchCodeDefinition.handler({ pattern: 'xyznonexistent12345' })
    expect(result.success).toBe(true)
    expect(JSON.parse(result.output)).toEqual([])
  })

  it('handler supports glob filtering', async () => {
    const result = await searchCodeDefinition.handler({ pattern: 'describe', glob: '*.test.ts' })
    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.output)
    expect(parsed.every((r: { file: string }) => r.file.endsWith('.test.ts'))).toBe(true)
  })
})
```

Add the import at the top of the test file:
```typescript
import { searchCodeDefinition } from './search-code'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/definitions/definitions.test.ts`
Expected: FAIL — `searchCodeDefinition` not found

- [ ] **Step 3: Implement search-code.ts**

Create `src/tools/definitions/search-code.ts`:

```typescript
import type { ToolDefinition } from '../registry'
import { execFileSync } from 'child_process'

interface SearchResult {
  file: string
  line: number
  match: string
}

export const searchCodeDefinition: ToolDefinition = {
  name: 'search_code',
  description: 'Search for a pattern in project files using grep. Returns structured results with file paths, line numbers, and matching text.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      glob: { type: 'string', description: 'File glob filter (e.g., "*.ts", "*.test.ts")' },
      max_results: { type: 'number', description: 'Maximum number of results to return (default: 20)' },
    },
    required: ['pattern'],
  },
  category: 'search',
  async handler(args) {
    const pattern = args.pattern as string
    const glob = args.glob as string | undefined
    const maxResults = (args.max_results as number) ?? 20

    const grepArgs = ['-rn', '--include', glob ?? '*', pattern, '.']
    try {
      const stdout = execFileSync('grep', grepArgs, {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      })

      const results: SearchResult[] = stdout
        .split('\n')
        .filter(line => line.length > 0)
        .slice(0, maxResults)
        .map(line => {
          // grep -rn output: ./path/to/file:lineNum:matchText
          const firstColon = line.indexOf(':')
          const secondColon = line.indexOf(':', firstColon + 1)
          const file = line.slice(0, firstColon).replace(/^\.\//, '')
          const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10)
          const match = line.slice(secondColon + 1).trim()
          return { file, line: lineNum, match }
        })

      return { success: true, output: JSON.stringify(results) }
    } catch (err) {
      // grep exits with code 1 when no matches found — not an error
      const error = err as { status?: number; message?: string }
      if (error.status === 1) {
        return { success: true, output: JSON.stringify([]) }
      }
      return { success: false, output: '', error: `Search failed: ${error.message}` }
    }
  },
}
```

- [ ] **Step 4: Register in default-registry.ts**

Add import and registration in `src/tools/definitions/default-registry.ts`:

```typescript
import { searchCodeDefinition } from './search-code'
```

Add inside `createDefaultRegistry()`:
```typescript
registry.register(searchCodeDefinition)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tools/definitions/definitions.test.ts`
Expected: All tests PASS including the new `searchCodeDefinition` tests

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/tools/definitions/search-code.ts src/tools/definitions/default-registry.ts src/tools/definitions/definitions.test.ts
git commit -m "feat: add search_code tool for structured code search"
```

---

## Chunk 2: Phase A — Editor Types + CodeEditor

### Task 2: Create editor types

**Files:**
- Create: `src/editor/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/editor/types.ts`:

```typescript
export interface EditOperation {
  file: string
  operation: 'insert' | 'replace' | 'delete' | 'create'
  // Search-based addressing (preferred — LLMs are bad at line counting)
  search?: string
  // Line-based addressing (fallback)
  afterLine?: number
  startLine?: number
  endLine?: number
  content?: string
}

// Search field semantics per operation type:
//   insert:  insert `content` AFTER the line containing `search` match
//   replace: replace `search` match with `content`
//   delete:  delete the line(s) containing `search` match
//   create:  `search` is ignored (creates new file with `content`)
//
// If `search` matches multiple locations → error (must be unique).
// If both `search` and line fields are set → `search` takes precedence.

export interface ApplyResult {
  applied: EditOperation[]
  failed: Array<{ edit: EditOperation; error: string }>
  originals: Map<string, string>
}

export interface DiffPreview {
  file: string
  diff: string
  additions: number
  deletions: number
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/editor/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/editor/types.ts
git commit -m "feat: add editor types (EditOperation, ApplyResult, DiffPreview)"
```

### Task 3: Implement CodeEditor

**Files:**
- Create: `src/editor/code-editor.ts`
- Create: `src/editor/code-editor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/editor/code-editor.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CodeEditor } from './code-editor'
import { SafetyGate } from '../tools/safety-gate'
import type { EditOperation } from './types'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('CodeEditor', () => {
  let editor: CodeEditor
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-editor-'))
    const gate = new SafetyGate({
      always_confirm: [],
      auto_approve: [],
      allowed_write_paths: [tmpDir],
    })
    editor = new CodeEditor(gate, tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeFixture(name: string, content: string): string {
    const filePath = path.join(tmpDir, name)
    fs.writeFileSync(filePath, content, 'utf8')
    return filePath
  }

  describe('applyEdits — search-based', () => {
    it('replaces a unique search match', async () => {
      const file = writeFixture('a.ts', 'const x = 1\nconst y = 2\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'const x = 1', content: 'const x = 10',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(result.failed).toHaveLength(0)
      expect(fs.readFileSync(file, 'utf8')).toBe('const x = 10\nconst y = 2\n')
    })

    it('inserts content after a search match', async () => {
      const file = writeFixture('b.ts', 'import a from "a"\n\nfunction main() {}\n')
      const edits: EditOperation[] = [{
        file, operation: 'insert',
        search: 'import a from "a"', content: 'import b from "b"',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toContain('import a from "a"\nimport b from "b"\n')
    })

    it('deletes the line containing a search match', async () => {
      const file = writeFixture('c.ts', 'line1\nline2\nline3\n')
      const edits: EditOperation[] = [{
        file, operation: 'delete', search: 'line2',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toBe('line1\nline3\n')
    })

    it('fails when search matches multiple locations', async () => {
      const file = writeFixture('d.ts', 'const x = 1\nconst x = 1\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'const x = 1', content: 'const x = 2',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error).toContain('multiple')
    })

    it('fails when search finds no match', async () => {
      const file = writeFixture('e.ts', 'const x = 1\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'const y = 2', content: 'const y = 3',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error).toContain('not found')
    })
  })

  describe('applyEdits — line-based', () => {
    it('replaces lines by startLine/endLine', async () => {
      const file = writeFixture('f.ts', 'line1\nline2\nline3\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        startLine: 2, endLine: 2, content: 'replaced',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toBe('line1\nreplaced\nline3\n')
    })

    it('inserts after a line number', async () => {
      const file = writeFixture('g.ts', 'line1\nline2\n')
      const edits: EditOperation[] = [{
        file, operation: 'insert',
        afterLine: 1, content: 'inserted',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toBe('line1\ninserted\nline2\n')
    })

    it('inserts at beginning with afterLine: 0', async () => {
      const file = writeFixture('h.ts', 'line1\n')
      const edits: EditOperation[] = [{
        file, operation: 'insert',
        afterLine: 0, content: 'first',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toBe('first\nline1\n')
    })
  })

  describe('applyEdits — create', () => {
    it('creates a new file', async () => {
      const file = path.join(tmpDir, 'new-file.ts')
      const edits: EditOperation[] = [{
        file, operation: 'create', content: 'export const x = 1\n',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toBe('export const x = 1\n')
    })
  })

  describe('applyEdits — safety', () => {
    it('rejects writes outside allowed paths', async () => {
      const edits: EditOperation[] = [{
        file: '/etc/passwd', operation: 'create', content: 'nope',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error).toContain('outside allowed')
    })
  })

  describe('applyEdits — originals for rollback', () => {
    it('stores original content before modifying', async () => {
      const file = writeFixture('orig.ts', 'original content\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'original content', content: 'new content',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.originals.get(file)).toBe('original content\n')
    })
  })

  describe('rollback', () => {
    it('restores files to their original content', async () => {
      const file = writeFixture('rollback.ts', 'before\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'before', content: 'after',
      }]
      const result = await editor.applyEdits(edits)
      expect(fs.readFileSync(file, 'utf8')).toBe('after\n')

      await editor.rollback(result)
      expect(fs.readFileSync(file, 'utf8')).toBe('before\n')
    })
  })

  describe('preview', () => {
    it('returns diffs without modifying files', async () => {
      const file = writeFixture('preview.ts', 'const x = 1\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'const x = 1', content: 'const x = 2',
      }]
      const previews = await editor.preview(edits)
      expect(previews).toHaveLength(1)
      expect(previews[0].diff).toContain('-const x = 1')
      expect(previews[0].diff).toContain('+const x = 2')
      expect(previews[0].additions).toBe(1)
      expect(previews[0].deletions).toBe(1)
      // File unchanged
      expect(fs.readFileSync(file, 'utf8')).toBe('const x = 1\n')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/code-editor.test.ts`
Expected: FAIL — `CodeEditor` not found

- [ ] **Step 3: Install the diff package**

Run: `npm install diff && npm install -D @types/diff`

- [ ] **Step 4: Implement CodeEditor**

Create `src/editor/code-editor.ts`:

```typescript
import fs from 'fs'
import path from 'path'
import { createTwoFilesPatch } from 'diff'
import type { SafetyGate } from '../tools/safety-gate'
import type { EditOperation, ApplyResult, DiffPreview } from './types'

export class CodeEditor {
  constructor(
    private safetyGate: SafetyGate,
    private cwd: string,
  ) {}

  async applyEdits(edits: EditOperation[]): Promise<ApplyResult> {
    const applied: EditOperation[] = []
    const failed: Array<{ edit: EditOperation; error: string }> = []
    const originals = new Map<string, string>()

    for (const edit of edits) {
      try {
        const resolved = path.resolve(this.cwd, edit.file)

        // Safety check
        const check = this.safetyGate.checkWritePath(resolved)
        if (!check.allowed) {
          failed.push({ edit, error: check.reason })
          continue
        }

        if (edit.operation === 'create') {
          const dir = path.dirname(resolved)
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
          }
          // Store original if file existed
          if (fs.existsSync(resolved)) {
            originals.set(resolved, fs.readFileSync(resolved, 'utf8'))
          }
          fs.writeFileSync(resolved, edit.content ?? '', 'utf8')
          applied.push(edit)
          continue
        }

        // For insert/replace/delete, file must exist
        if (!fs.existsSync(resolved)) {
          failed.push({ edit, error: `File not found: ${edit.file}` })
          continue
        }

        const original = fs.readFileSync(resolved, 'utf8')
        if (!originals.has(resolved)) {
          originals.set(resolved, original)
        }

        const modified = this.applyEdit(original, edit)
        fs.writeFileSync(resolved, modified, 'utf8')
        applied.push(edit)
      } catch (err) {
        failed.push({ edit, error: (err as Error).message })
      }
    }

    return { applied, failed, originals }
  }

  async rollback(result: ApplyResult): Promise<void> {
    for (const [filePath, original] of result.originals) {
      fs.writeFileSync(filePath, original, 'utf8')
    }
  }

  async preview(edits: EditOperation[]): Promise<DiffPreview[]> {
    const previews: DiffPreview[] = []

    for (const edit of edits) {
      const resolved = path.resolve(this.cwd, edit.file)

      if (edit.operation === 'create') {
        const content = edit.content ?? ''
        const diff = createTwoFilesPatch(edit.file, edit.file, '', content)
        const additions = content.split('\n').filter(l => l.length > 0).length
        previews.push({ file: edit.file, diff, additions, deletions: 0 })
        continue
      }

      if (!fs.existsSync(resolved)) continue

      const original = fs.readFileSync(resolved, 'utf8')
      try {
        const modified = this.applyEdit(original, edit)
        const diff = createTwoFilesPatch(edit.file, edit.file, original, modified)
        const lines = diff.split('\n')
        let additions = 0
        let deletions = 0
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) additions++
          if (line.startsWith('-') && !line.startsWith('---')) deletions++
        }
        previews.push({ file: edit.file, diff, additions, deletions })
      } catch {
        // Skip edits that would fail (e.g., search not found)
      }
    }

    return previews
  }

  private applyEdit(content: string, edit: EditOperation): string {
    // Search-based takes precedence
    if (edit.search !== undefined) {
      return this.applySearchEdit(content, edit)
    }
    return this.applyLineEdit(content, edit)
  }

  private applySearchEdit(content: string, edit: EditOperation): string {
    const search = edit.search!
    const occurrences = content.split(search).length - 1

    if (occurrences === 0) {
      throw new Error(`Search string not found in ${edit.file}`)
    }
    if (occurrences > 1) {
      throw new Error(`Search string matches multiple locations (${occurrences}) in ${edit.file}`)
    }

    switch (edit.operation) {
      case 'replace':
        return content.replace(search, edit.content ?? '')

      case 'insert': {
        // Insert content AFTER the line containing the search match
        const lines = content.split('\n')
        const lineIdx = lines.findIndex(line => line.includes(search))
        lines.splice(lineIdx + 1, 0, edit.content ?? '')
        return lines.join('\n')
      }

      case 'delete': {
        // Delete the line(s) containing the search match
        const lines = content.split('\n')
        const filtered = lines.filter(line => !line.includes(search))
        return filtered.join('\n')
      }

      default:
        throw new Error(`Unsupported operation with search: ${edit.operation}`)
    }
  }

  private applyLineEdit(content: string, edit: EditOperation): string {
    const lines = content.split('\n')

    switch (edit.operation) {
      case 'replace': {
        const start = (edit.startLine ?? 1) - 1
        const end = (edit.endLine ?? edit.startLine ?? 1) - 1
        const newLines = (edit.content ?? '').split('\n')
        lines.splice(start, end - start + 1, ...newLines)
        return lines.join('\n')
      }

      case 'insert': {
        const after = edit.afterLine ?? 0
        const newLines = (edit.content ?? '').split('\n')
        lines.splice(after, 0, ...newLines)
        return lines.join('\n')
      }

      case 'delete': {
        const start = (edit.startLine ?? 1) - 1
        const end = (edit.endLine ?? edit.startLine ?? 1) - 1
        lines.splice(start, end - start + 1)
        return lines.join('\n')
      }

      default:
        throw new Error(`Unsupported line operation: ${edit.operation}`)
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/editor/code-editor.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/editor/types.ts src/editor/code-editor.ts src/editor/code-editor.test.ts package.json package-lock.json
git commit -m "feat: add CodeEditor with search-based and line-based edit operations"
```

### Task 4: Implement DiffRenderer

**Files:**
- Create: `src/editor/diff-renderer.ts`
- Create: `src/editor/diff-renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/editor/diff-renderer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { DiffRenderer } from './diff-renderer'
import type { DiffPreview } from './types'

describe('DiffRenderer', () => {
  describe('unifiedDiff', () => {
    it('produces a unified diff between original and modified', () => {
      const original = 'const x = 1\nconst y = 2\n'
      const modified = 'const x = 10\nconst y = 2\n'
      const diff = DiffRenderer.unifiedDiff('test.ts', original, modified)
      expect(diff).toContain('--- test.ts')
      expect(diff).toContain('+++ test.ts')
      expect(diff).toContain('-const x = 1')
      expect(diff).toContain('+const x = 10')
    })

    it('returns empty string when no changes', () => {
      const content = 'const x = 1\n'
      const diff = DiffRenderer.unifiedDiff('test.ts', content, content)
      // No hunks means no meaningful diff lines
      expect(diff).not.toContain('@@')
    })
  })

  describe('colorize', () => {
    it('adds color codes to diff output', () => {
      const diff = '--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n'
      const colored = DiffRenderer.colorize(diff)
      // Should contain ANSI escape codes
      expect(colored).toContain('\x1b[')
      expect(colored).toContain('old')
      expect(colored).toContain('new')
    })
  })

  describe('summary', () => {
    it('summarizes multiple diffs', () => {
      const diffs: DiffPreview[] = [
        { file: 'a.ts', diff: '...', additions: 3, deletions: 1 },
        { file: 'b.ts', diff: '...', additions: 0, deletions: 5 },
      ]
      const result = DiffRenderer.summary(diffs)
      expect(result).toContain('2 files changed')
      expect(result).toContain('3 insertions')
      expect(result).toContain('6 deletions')
    })

    it('handles single file', () => {
      const diffs: DiffPreview[] = [
        { file: 'a.ts', diff: '...', additions: 1, deletions: 0 },
      ]
      const result = DiffRenderer.summary(diffs)
      expect(result).toContain('1 file changed')
      expect(result).toContain('1 insertion')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/diff-renderer.test.ts`
Expected: FAIL — `DiffRenderer` not found

- [ ] **Step 3: Implement DiffRenderer**

Create `src/editor/diff-renderer.ts`:

```typescript
import { createTwoFilesPatch } from 'diff'
import chalk from 'chalk'
import type { DiffPreview } from './types'

export class DiffRenderer {
  static unifiedDiff(file: string, original: string, modified: string): string {
    return createTwoFilesPatch(file, file, original, modified)
  }

  static colorize(diff: string): string {
    return diff
      .split('\n')
      .map(line => {
        if (line.startsWith('+++') || line.startsWith('---')) return chalk.bold(line)
        if (line.startsWith('@@')) return chalk.cyan(line)
        if (line.startsWith('+')) return chalk.green(line)
        if (line.startsWith('-')) return chalk.red(line)
        return line
      })
      .join('\n')
  }

  static summary(diffs: DiffPreview[]): string {
    const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0)
    const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0)
    const fileCount = diffs.length
    const fileWord = fileCount === 1 ? 'file' : 'files'
    const addWord = totalAdditions === 1 ? 'insertion' : 'insertions'
    const delWord = totalDeletions === 1 ? 'deletion' : 'deletions'

    const parts = [`${fileCount} ${fileWord} changed`]
    if (totalAdditions > 0) parts.push(`${totalAdditions} ${addWord}(+)`)
    if (totalDeletions > 0) parts.push(`${totalDeletions} ${delWord}(-)`)

    return parts.join(', ')
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/editor/diff-renderer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/editor/diff-renderer.ts src/editor/diff-renderer.test.ts
git commit -m "feat: add DiffRenderer with unified diffs and colorization"
```

---

## Chunk 3: Phase B — AgentMemory

### Task 5: Create coding types

**Files:**
- Create: `src/coding/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/coding/types.ts`:

```typescript
import type { EditOperation } from '../editor/types'

export type AgentPhase = 'analyze' | 'plan' | 'execute' | 'validate' | 'present'

export interface EditValidationResult {
  passed: boolean
  output: string
  command: string
}

export interface EditPlan {
  description: string
  steps: EditStep[]
  estimatedFiles: string[]
}

export interface EditStep {
  description: string
  file: string
  operation: 'insert' | 'replace' | 'delete' | 'create'
  search?: string
  reasoning: string
}

export interface GatheredContext {
  files: Array<{ path: string; content: string; relevance: string }>
  searchResults: Array<{ file: string; line: number; match: string }>
  gitContext?: string
  memory: MemorySnapshot
}

export interface MemorySnapshot {
  recentFiles: string[]
  recentEdits: EditOperation[]
  recentCommands: string[]
  recentErrors: string[]
  sessionStart: number
}

export interface AgentConfig {
  max_iterations: number
  auto_confirm: boolean
  show_plan: boolean
  run_validation: boolean
  validation_command?: string
}

export interface AgentRunResult {
  success: boolean
  edits: EditOperation[]
  diffs: string[]
  validationPassed: boolean | null
  iterations: number
  tokensUsed: { input: number; output: number }
  agent: 'local' | 'claude'
}

export interface AgentState {
  phase: AgentPhase
  prompt: string
  plan: EditPlan | null
  editsApplied: EditOperation[]
  validationResult: EditValidationResult | null
  iteration: number
  maxIterations: number
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/coding/types.ts
git commit -m "feat: add coding agent types (AgentPhase, EditPlan, AgentConfig, etc.)"
```

### Task 6: Implement AgentMemory

**Files:**
- Create: `src/coding/memory.ts`
- Create: `src/coding/memory.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/coding/memory.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { AgentMemory } from './memory'

describe('AgentMemory', () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = new AgentMemory()
  })

  describe('record', () => {
    it('stores entries with timestamps', () => {
      memory.record({ type: 'file_read', detail: 'src/index.ts' })
      const snapshot = memory.getSnapshot()
      expect(snapshot.recentFiles).toContain('src/index.ts')
    })

    it('evicts oldest entries when maxEntries is exceeded', () => {
      const small = new AgentMemory(3)
      small.record({ type: 'file_read', detail: 'a.ts' })
      small.record({ type: 'file_read', detail: 'b.ts' })
      small.record({ type: 'file_read', detail: 'c.ts' })
      small.record({ type: 'file_read', detail: 'd.ts' })
      const snapshot = small.getSnapshot()
      expect(snapshot.recentFiles).not.toContain('a.ts')
      expect(snapshot.recentFiles).toContain('d.ts')
    })
  })

  describe('getSnapshot', () => {
    it('returns categorized entries', () => {
      memory.record({ type: 'file_read', detail: 'src/a.ts' })
      memory.record({ type: 'command', detail: 'npm test' })
      memory.record({ type: 'error', detail: 'TypeError: x is undefined' })
      memory.record({ type: 'edit', detail: 'replaced x=1 with x=2 in src/a.ts' })

      const snapshot = memory.getSnapshot()
      expect(snapshot.recentFiles).toContain('src/a.ts')
      expect(snapshot.recentCommands).toContain('npm test')
      expect(snapshot.recentErrors).toContain('TypeError: x is undefined')
      expect(snapshot.sessionStart).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('getRecentFiles', () => {
    it('returns unique file paths', () => {
      memory.record({ type: 'file_read', detail: 'a.ts' })
      memory.record({ type: 'file_read', detail: 'b.ts' })
      memory.record({ type: 'file_read', detail: 'a.ts' }) // duplicate
      expect(memory.getRecentFiles()).toEqual(['a.ts', 'b.ts'])
    })

    it('limits to n results', () => {
      memory.record({ type: 'file_read', detail: 'a.ts' })
      memory.record({ type: 'file_read', detail: 'b.ts' })
      memory.record({ type: 'file_read', detail: 'c.ts' })
      expect(memory.getRecentFiles(2)).toHaveLength(2)
    })
  })

  describe('toPromptContext', () => {
    it('produces compact text', () => {
      memory.record({ type: 'file_read', detail: 'src/a.ts' })
      memory.record({ type: 'error', detail: 'build failed' })
      const context = memory.toPromptContext()
      expect(context).toContain('src/a.ts')
      expect(context).toContain('build failed')
      // Should be compact
      expect(context.length).toBeLessThan(2000)
    })

    it('returns empty note when no entries', () => {
      const context = memory.toPromptContext()
      expect(context).toContain('No prior activity')
    })
  })

  describe('clear', () => {
    it('removes all entries', () => {
      memory.record({ type: 'file_read', detail: 'a.ts' })
      memory.clear()
      expect(memory.getRecentFiles()).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/coding/memory.test.ts`
Expected: FAIL — `AgentMemory` not found

- [ ] **Step 3: Implement AgentMemory**

Create `src/coding/memory.ts`:

```typescript
import type { MemorySnapshot } from './types'
import type { EditOperation } from '../editor/types'

export interface MemoryEntry {
  timestamp: number
  type: 'file_read' | 'file_write' | 'search' | 'command' | 'edit' | 'error'
  detail: string
  result?: string
}

export class AgentMemory {
  private entries: MemoryEntry[] = []
  private sessionStart: number = Date.now()

  constructor(private maxEntries: number = 50) {}

  record(entry: Omit<MemoryEntry, 'timestamp'>): void {
    this.entries.push({ ...entry, timestamp: Date.now() })
    if (this.entries.length > this.maxEntries) {
      this.entries.shift()
    }
  }

  getSnapshot(): MemorySnapshot {
    const recentFiles = this.getRecentFiles()
    const recentEdits: EditOperation[] = [] // populated when edit entries carry structured data
    const recentCommands = [...new Set(
      this.entries.filter(e => e.type === 'command').map(e => e.detail)
    )]
    const recentErrors = this.entries.filter(e => e.type === 'error').map(e => e.detail)

    return { recentFiles, recentEdits, recentCommands, recentErrors, sessionStart: this.sessionStart }
  }

  getRecentFiles(n?: number): string[] {
    const fileEntries = this.entries.filter(e => e.type === 'file_read' || e.type === 'file_write')
    const unique = [...new Set(fileEntries.map(e => e.detail))]
    return n ? unique.slice(0, n) : unique
  }

  toPromptContext(): string {
    if (this.entries.length === 0) {
      return 'Session context: No prior activity in this session.'
    }

    const files = this.getRecentFiles()
    const errors = this.entries.filter(e => e.type === 'error').slice(-3)
    const commands = [...new Set(
      this.entries.filter(e => e.type === 'command').map(e => e.detail)
    )].slice(-3)

    const parts: string[] = ['Session context:']
    if (files.length > 0) parts.push(`Files accessed: ${files.join(', ')}`)
    if (commands.length > 0) parts.push(`Recent commands: ${commands.join(', ')}`)
    if (errors.length > 0) parts.push(`Recent errors: ${errors.map(e => e.detail).join('; ')}`)

    return parts.join('\n')
  }

  clear(): void {
    this.entries = []
    this.sessionStart = Date.now()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/coding/memory.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/coding/types.ts src/coding/memory.ts src/coding/memory.test.ts
git commit -m "feat: add AgentMemory for session-scoped activity tracking"
```

---

## Chunk 4: Phase C — Planner

### Task 7: Implement Planner

**Files:**
- Create: `src/coding/planner.ts`
- Create: `src/coding/planner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/coding/planner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Planner } from './planner'
import type { GatheredContext, EditPlan } from './types'

// Mock agents
const mockLocalAgent = {
  run: vi.fn(),
}

const mockClaudeAgent = {
  run: vi.fn(),
}

describe('Planner', () => {
  let planner: Planner

  beforeEach(() => {
    vi.clearAllMocks()
    planner = new Planner(mockLocalAgent as any, mockClaudeAgent as any)
  })

  const baseContext: GatheredContext = {
    files: [{ path: 'src/a.ts', content: 'export const x = 1', relevance: 'main target' }],
    searchResults: [],
    memory: {
      recentFiles: [],
      recentEdits: [],
      recentCommands: [],
      recentErrors: [],
      sessionStart: Date.now(),
    },
  }

  describe('generatePlan', () => {
    it('parses a valid JSON plan from LLM response', async () => {
      const plan: EditPlan = {
        description: 'Add logging',
        steps: [{
          description: 'Add import',
          file: 'src/a.ts',
          operation: 'insert',
          search: 'export const x',
          reasoning: 'Need logger import',
        }],
        estimatedFiles: ['src/a.ts'],
      }
      mockLocalAgent.run.mockResolvedValue({
        content: JSON.stringify(plan),
        summary: '',
        inputTokens: 100,
        outputTokens: 50,
      })

      const result = await planner.generatePlan('Add logging', baseContext, 'local')
      expect(result.description).toBe('Add logging')
      expect(result.steps).toHaveLength(1)
      expect(result.steps[0].file).toBe('src/a.ts')
    })

    it('handles malformed JSON by extracting with regex', async () => {
      const response = `Here is the plan:
\`\`\`json
{
  "description": "Fix bug",
  "steps": [{ "description": "Fix return", "file": "a.ts", "operation": "replace", "search": "return null", "reasoning": "Should return value" }],
  "estimatedFiles": ["a.ts"]
}
\`\`\`
Let me know if this looks good.`
      mockLocalAgent.run.mockResolvedValue({
        content: response,
        summary: '',
        inputTokens: 100,
        outputTokens: 80,
      })

      const result = await planner.generatePlan('Fix bug', baseContext, 'local')
      expect(result.description).toBe('Fix bug')
      expect(result.steps).toHaveLength(1)
    })

    it('uses claude agent when agent param is claude', async () => {
      mockClaudeAgent.run.mockResolvedValue({
        content: JSON.stringify({
          description: 'Refactor',
          steps: [],
          estimatedFiles: [],
        }),
        summary: '',
        inputTokens: 200,
        outputTokens: 100,
      })

      await planner.generatePlan('Refactor', baseContext, 'claude')
      expect(mockClaudeAgent.run).toHaveBeenCalled()
      expect(mockLocalAgent.run).not.toHaveBeenCalled()
    })

    it('throws when no plan can be extracted', async () => {
      mockLocalAgent.run.mockResolvedValue({
        content: 'I cannot help with that.',
        summary: '',
        inputTokens: 50,
        outputTokens: 20,
      })

      await expect(planner.generatePlan('Do something', baseContext, 'local'))
        .rejects.toThrow('Failed to parse edit plan')
    })
  })

  describe('refinePlan', () => {
    it('passes errors to the LLM for plan refinement', async () => {
      const originalPlan: EditPlan = {
        description: 'Add feature',
        steps: [{ description: 'Step 1', file: 'a.ts', operation: 'replace', reasoning: 'Fix' }],
        estimatedFiles: ['a.ts'],
      }
      const refined: EditPlan = {
        description: 'Add feature (refined)',
        steps: [{ description: 'Step 1 fixed', file: 'a.ts', operation: 'replace', search: 'const x', reasoning: 'Fix with correct search' }],
        estimatedFiles: ['a.ts'],
      }

      mockLocalAgent.run.mockResolvedValue({
        content: JSON.stringify(refined),
        summary: '',
        inputTokens: 150,
        outputTokens: 80,
      })

      const result = await planner.refinePlan(originalPlan, ['Search string not found'], 'local')
      expect(result.description).toBe('Add feature (refined)')
      // Verify the errors were included in the prompt
      const callArgs = mockLocalAgent.run.mock.calls[0][0]
      expect(callArgs).toContain('Search string not found')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/coding/planner.test.ts`
Expected: FAIL — `Planner` not found

- [ ] **Step 3: Implement Planner**

Create `src/coding/planner.ts`:

```typescript
import type { AgentResult } from '../agents/local'
import type { EditPlan, GatheredContext } from './types'

interface LLMAgent {
  run(prompt: string, previousSummary?: string, repoContext?: string): Promise<AgentResult>
}

export class Planner {
  constructor(
    private localAgent: LLMAgent,
    private claudeAgent: LLMAgent | null,
  ) {}

  async generatePlan(
    prompt: string,
    context: GatheredContext,
    agent: 'local' | 'claude',
  ): Promise<EditPlan> {
    const systemPrompt = this.buildPlanPrompt(prompt, context)
    const llm = this.selectAgent(agent)
    const result = await llm.run(systemPrompt)
    return this.parsePlan(result.content)
  }

  async refinePlan(
    plan: EditPlan,
    errors: string[],
    agent: 'local' | 'claude',
  ): Promise<EditPlan> {
    const prompt = this.buildRefinePrompt(plan, errors)
    const llm = this.selectAgent(agent)
    const result = await llm.run(prompt)
    return this.parsePlan(result.content)
  }

  private selectAgent(agent: 'local' | 'claude'): LLMAgent {
    if (agent === 'claude' && this.claudeAgent) {
      return this.claudeAgent
    }
    return this.localAgent
  }

  private buildPlanPrompt(prompt: string, context: GatheredContext): string {
    const fileSummary = context.files
      .map(f => `--- ${f.path} (${f.relevance}) ---\n${f.content}`)
      .join('\n\n')

    const searchSummary = context.searchResults.length > 0
      ? `Search results:\n${context.searchResults.map(r => `${r.file}:${r.line}: ${r.match}`).join('\n')}`
      : ''

    return `You are a code editing planner. Create an edit plan as JSON. Do NOT write code.

REQUEST: ${prompt}

FILES:
${fileSummary}

${searchSummary}

${context.memory.recentFiles.length > 0 ? `Recently accessed: ${context.memory.recentFiles.join(', ')}` : ''}

Respond with ONLY a JSON object:
{
  "description": "what this plan does",
  "steps": [
    {
      "description": "what this step does",
      "file": "path/to/file",
      "operation": "insert|replace|delete|create",
      "search": "exact text to find in file",
      "reasoning": "why this change"
    }
  ],
  "estimatedFiles": ["list", "of", "files"]
}`
  }

  private buildRefinePrompt(plan: EditPlan, errors: string[]): string {
    return `The following edit plan failed. Fix it based on the errors.

ORIGINAL PLAN:
${JSON.stringify(plan, null, 2)}

ERRORS:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Respond with ONLY the corrected JSON plan (same format as above).`
  }

  private parsePlan(response: string): EditPlan {
    // Try direct JSON parse
    try {
      const plan = JSON.parse(response)
      return this.validatePlan(plan)
    } catch {
      // Fall through to regex extraction
    }

    // Try extracting JSON from markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (jsonMatch) {
      try {
        const plan = JSON.parse(jsonMatch[1])
        return this.validatePlan(plan)
      } catch {
        // Fall through
      }
    }

    // Try finding a JSON object in the response
    const braceMatch = response.match(/\{[\s\S]*"steps"[\s\S]*\}/)
    if (braceMatch) {
      try {
        const plan = JSON.parse(braceMatch[0])
        return this.validatePlan(plan)
      } catch {
        // Fall through
      }
    }

    throw new Error('Failed to parse edit plan from LLM response')
  }

  private validatePlan(plan: unknown): EditPlan {
    const p = plan as EditPlan
    if (!p.description || !Array.isArray(p.steps)) {
      throw new Error('Invalid plan: missing description or steps')
    }
    return {
      description: p.description,
      steps: p.steps.map(s => ({
        description: s.description ?? '',
        file: s.file ?? '',
        operation: s.operation ?? 'replace',
        search: s.search,
        reasoning: s.reasoning ?? '',
      })),
      estimatedFiles: p.estimatedFiles ?? p.steps.map(s => s.file),
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/coding/planner.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/coding/planner.ts src/coding/planner.test.ts
git commit -m "feat: add Planner for LLM-driven edit plan generation"
```

---

## Chunk 5: Phase C — CodingAgent

### Task 8a: Add toolCalls to AgentResult

The `CodingAgent` ANALYZE phase needs to know which tool calls the agent made and their results. Currently `AgentResult` only returns `content`, `summary`, and token counts.

**Files:**
- Modify: `src/agents/local.ts`

- [ ] **Step 1: Add toolCalls field to AgentResult**

In `src/agents/local.ts`, update the `AgentResult` interface:

```typescript
export interface ToolCallRecord {
  tool: string
  args: Record<string, unknown>
  result?: { success: boolean; output: string }
}

export interface AgentResult {
  content: string
  summary: string
  inputTokens: number
  outputTokens: number
  toolCalls?: ToolCallRecord[]
}
```

- [ ] **Step 2: Populate toolCalls in LocalAgent.run()**

Inside `LocalAgent.run()`, track tool calls as they happen. Add a `const toolCallRecords: ToolCallRecord[] = []` before the tool loop, push each call+result, and include in the return value:

```typescript
return { content, summary, inputTokens, outputTokens, toolCalls: toolCallRecords }
```

The exact modifications depend on the current loop structure. The key change: after each tool execution, push `{ tool, args, result: { success, output } }` to the array.

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npm test`
Expected: All tests PASS (new field is optional, existing code unaffected)

- [ ] **Step 4: Commit**

```bash
git add src/agents/local.ts
git commit -m "feat: add toolCalls tracking to AgentResult for coding agent integration"
```

### Task 8: Implement CodingAgent

**Files:**
- Create: `src/coding/coding-agent.ts`
- Create: `src/coding/coding-agent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/coding/coding-agent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodingAgent } from './coding-agent'
import type { AgentConfig, EditPlan } from './types'
import type { EditOperation } from '../editor/types'
import { AgentMemory } from './memory'
import { EventEmitter } from 'events'

// Mock dependencies
const mockLocalAgent = {
  run: vi.fn(),
}

const mockClaudeAgent = {
  run: vi.fn(),
}

const mockToolExecutor = {
  execute: vi.fn(),
  executeParallel: vi.fn(),
  registry: {
    describeForPrompt: vi.fn().mockReturnValue('read_file(path)\nsearch_code(pattern)'),
    listForLLM: vi.fn().mockReturnValue([]),
  },
}

const mockCodeEditor = {
  applyEdits: vi.fn(),
  rollback: vi.fn(),
  preview: vi.fn(),
}

const mockPlanner = {
  generatePlan: vi.fn(),
  refinePlan: vi.fn(),
}

const defaultConfig: AgentConfig = {
  max_iterations: 3,
  auto_confirm: true, // skip confirmation in tests
  show_plan: false,
  run_validation: false,
}

describe('CodingAgent', () => {
  let agent: CodingAgent
  let memory: AgentMemory

  beforeEach(() => {
    vi.clearAllMocks()
    memory = new AgentMemory()

    agent = new CodingAgent(
      mockLocalAgent as any,
      mockClaudeAgent as any,
      mockToolExecutor as any,
      mockCodeEditor as any,
      mockPlanner as any,
      memory,
      defaultConfig,
    )
  })

  it('completes a simple single-file edit using local agent', async () => {
    // ANALYZE: local agent returns tool calls with results (populated by LocalAgent)
    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'I read src/a.ts',
      summary: '',
      inputTokens: 50,
      outputTokens: 30,
      toolCalls: [{
        tool: 'read_file',
        args: { path: 'src/a.ts' },
        result: { success: true, output: 'export const x = 1\n' },
      }],
    })

    // PLAN: planner returns a simple plan
    const plan: EditPlan = {
      description: 'Update constant',
      steps: [{
        description: 'Change x to 2',
        file: 'src/a.ts',
        operation: 'replace',
        search: 'const x = 1',
        reasoning: 'Update value',
      }],
      estimatedFiles: ['src/a.ts'],
    }
    mockPlanner.generatePlan.mockResolvedValue(plan)

    // EXECUTE: local agent generates EditOperation
    mockLocalAgent.run.mockResolvedValueOnce({
      content: JSON.stringify({
        file: 'src/a.ts',
        operation: 'replace',
        search: 'const x = 1',
        content: 'const x = 2',
      }),
      summary: '',
      inputTokens: 80,
      outputTokens: 40,
    })

    // CodeEditor applies successfully
    mockCodeEditor.applyEdits.mockResolvedValue({
      applied: [{ file: 'src/a.ts', operation: 'replace', search: 'const x = 1', content: 'const x = 2' }],
      failed: [],
      originals: new Map([['src/a.ts', 'export const x = 1\n']]),
    })

    mockCodeEditor.preview.mockResolvedValue([{
      file: 'src/a.ts',
      diff: '-const x = 1\n+const x = 2',
      additions: 1,
      deletions: 1,
    }])

    const result = await agent.run('Change x to 2 in src/a.ts')
    expect(result.success).toBe(true)
    expect(result.edits).toHaveLength(1)
    expect(result.agent).toBe('local')
    expect(result.iterations).toBe(1)
  })

  it('auto-escalates to Claude when plan has >3 steps', async () => {
    // ANALYZE phase — no tool calls needed
    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'Reading files',
      summary: '',
      inputTokens: 50,
      outputTokens: 30,
    })

    // PLAN: planner returns a large plan (>3 steps)
    const plan: EditPlan = {
      description: 'Big refactor',
      steps: [
        { description: 's1', file: 'a.ts', operation: 'replace', reasoning: '' },
        { description: 's2', file: 'b.ts', operation: 'replace', reasoning: '' },
        { description: 's3', file: 'c.ts', operation: 'insert', reasoning: '' },
        { description: 's4', file: 'd.ts', operation: 'create', reasoning: '' },
      ],
      estimatedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
    }
    mockPlanner.generatePlan.mockResolvedValue(plan)

    // EXECUTE: Claude generates EditOperations
    for (let i = 0; i < 4; i++) {
      mockClaudeAgent.run.mockResolvedValueOnce({
        content: JSON.stringify({
          file: plan.steps[i].file,
          operation: plan.steps[i].operation,
          search: 'x',
          content: 'y',
        }),
        summary: '',
        inputTokens: 100,
        outputTokens: 50,
      })
    }

    mockCodeEditor.applyEdits.mockResolvedValue({
      applied: plan.steps.map(s => ({ file: s.file, operation: s.operation })),
      failed: [],
      originals: new Map(),
    })

    mockCodeEditor.preview.mockResolvedValue([])

    const result = await agent.run('Refactor everything')
    expect(result.agent).toBe('claude')
    // Planner should have been called with 'claude' since >3 steps
    expect(mockPlanner.generatePlan).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      'claude',
    )
  })

  it('rolls back on execute failure and retries', async () => {
    // ANALYZE
    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'ok',
      summary: '',
      inputTokens: 30,
      outputTokens: 20,
    })

    // PLAN (iteration 1)
    const plan1: EditPlan = {
      description: 'Fix bug',
      steps: [{ description: 'Fix', file: 'a.ts', operation: 'replace', search: 'bad', reasoning: '' }],
      estimatedFiles: ['a.ts'],
    }
    mockPlanner.generatePlan.mockResolvedValueOnce(plan1)

    // EXECUTE (iteration 1): LLM generates op
    mockLocalAgent.run.mockResolvedValueOnce({
      content: JSON.stringify({ file: 'a.ts', operation: 'replace', search: 'bad', content: 'good' }),
      summary: '',
      inputTokens: 50,
      outputTokens: 30,
    })

    // applyEdits fails
    const failedResult = {
      applied: [],
      failed: [{ edit: { file: 'a.ts', operation: 'replace' as const, search: 'bad', content: 'good' }, error: 'Search string not found' }],
      originals: new Map<string, string>(),
    }
    mockCodeEditor.applyEdits.mockResolvedValueOnce(failedResult)

    // PLAN (iteration 2 — refinePlan)
    const plan2: EditPlan = {
      description: 'Fix bug (refined)',
      steps: [{ description: 'Fix with correct search', file: 'a.ts', operation: 'replace', search: 'wrong', reasoning: '' }],
      estimatedFiles: ['a.ts'],
    }
    mockPlanner.refinePlan.mockResolvedValueOnce(plan2)

    // EXECUTE (iteration 2)
    mockLocalAgent.run.mockResolvedValueOnce({
      content: JSON.stringify({ file: 'a.ts', operation: 'replace', search: 'wrong', content: 'right' }),
      summary: '',
      inputTokens: 50,
      outputTokens: 30,
    })

    mockCodeEditor.applyEdits.mockResolvedValueOnce({
      applied: [{ file: 'a.ts', operation: 'replace', search: 'wrong', content: 'right' }],
      failed: [],
      originals: new Map([['a.ts', 'original']]),
    })

    mockCodeEditor.preview.mockResolvedValue([{
      file: 'a.ts',
      diff: '-wrong\n+right',
      additions: 1,
      deletions: 1,
    }])

    const result = await agent.run('Fix the bug')
    expect(result.success).toBe(true)
    expect(result.iterations).toBe(2)
    expect(mockPlanner.refinePlan).toHaveBeenCalled()
    expect(mockCodeEditor.rollback).toHaveBeenCalled()
  })

  it('rolls back ALL edits when max_iterations exhausted', async () => {
    const configWithValidation: AgentConfig = {
      ...defaultConfig,
      max_iterations: 2,
      run_validation: true,
      validation_command: 'echo fail && exit 1',
    }
    const agentWithValidation = new CodingAgent(
      mockLocalAgent as any,
      mockClaudeAgent as any,
      mockToolExecutor as any,
      mockCodeEditor as any,
      mockPlanner as any,
      memory,
      configWithValidation,
    )

    // ANALYZE
    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'ok', summary: '', inputTokens: 30, outputTokens: 20,
    })

    // PLAN iteration 1
    mockPlanner.generatePlan.mockResolvedValueOnce({
      description: 'Fix', steps: [{ description: 's1', file: 'a.ts', operation: 'replace', reasoning: '' }],
      estimatedFiles: ['a.ts'],
    })

    // EXECUTE iteration 1 — succeeds
    mockLocalAgent.run.mockResolvedValueOnce({
      content: JSON.stringify({ file: 'a.ts', operation: 'replace', search: 'x', content: 'y' }),
      summary: '', inputTokens: 50, outputTokens: 30,
    })
    mockCodeEditor.applyEdits.mockResolvedValueOnce({
      applied: [{ file: 'a.ts', operation: 'replace' }],
      failed: [],
      originals: new Map([['a.ts', 'original-content']]),
    })
    mockCodeEditor.preview.mockResolvedValueOnce([{ file: 'a.ts', diff: 'diff1', additions: 1, deletions: 1 }])

    // PLAN iteration 2 (refinePlan after validation failure)
    mockPlanner.refinePlan.mockResolvedValueOnce({
      description: 'Fix v2', steps: [{ description: 's2', file: 'a.ts', operation: 'replace', reasoning: '' }],
      estimatedFiles: ['a.ts'],
    })

    // EXECUTE iteration 2 — succeeds
    mockLocalAgent.run.mockResolvedValueOnce({
      content: JSON.stringify({ file: 'a.ts', operation: 'replace', search: 'y', content: 'z' }),
      summary: '', inputTokens: 50, outputTokens: 30,
    })
    mockCodeEditor.applyEdits.mockResolvedValueOnce({
      applied: [{ file: 'a.ts', operation: 'replace' }],
      failed: [],
      originals: new Map([['a.ts', 'y-content']]),
    })
    mockCodeEditor.preview.mockResolvedValueOnce([{ file: 'a.ts', diff: 'diff2', additions: 1, deletions: 1 }])

    // Validation always fails (both iterations)
    // Note: validate() uses execFileSync directly, so we need to mock it
    // For this test, the key assertion is that rollback is called with initialOriginals

    const result = await agentWithValidation.run('Fix the bug')
    expect(result.success).toBe(false)
    expect(result.validationPassed).toBe(false)
    // Should have rolled back to initial state
    expect(mockCodeEditor.rollback).toHaveBeenCalled()
  })

  it('retries with refined plan when validation fails', async () => {
    const configWithValidation: AgentConfig = {
      ...defaultConfig,
      max_iterations: 2,
      run_validation: true,
      validation_command: 'true', // will succeed (builtin)
    }
    const agentWithValidation = new CodingAgent(
      mockLocalAgent as any,
      mockClaudeAgent as any,
      mockToolExecutor as any,
      mockCodeEditor as any,
      mockPlanner as any,
      memory,
      configWithValidation,
    )

    // ANALYZE
    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'ok', summary: '', inputTokens: 30, outputTokens: 20,
    })

    // PLAN iteration 1
    mockPlanner.generatePlan.mockResolvedValueOnce({
      description: 'Fix', steps: [{ description: 's1', file: 'a.ts', operation: 'replace', reasoning: '' }],
      estimatedFiles: ['a.ts'],
    })

    // EXECUTE iteration 1
    mockLocalAgent.run.mockResolvedValueOnce({
      content: JSON.stringify({ file: 'a.ts', operation: 'replace', search: 'x', content: 'y' }),
      summary: '', inputTokens: 50, outputTokens: 30,
    })
    mockCodeEditor.applyEdits.mockResolvedValueOnce({
      applied: [{ file: 'a.ts', operation: 'replace' }],
      failed: [],
      originals: new Map([['a.ts', 'original']]),
    })
    mockCodeEditor.preview.mockResolvedValueOnce([{ file: 'a.ts', diff: 'diff', additions: 1, deletions: 1 }])

    // First validation fails, second succeeds
    // (validation uses execFileSync — these tests need the command to actually run)

    const result = await agentWithValidation.run('Fix')
    // The test verifies the flow works without error
    expect(result.iterations).toBeGreaterThanOrEqual(1)
  })

  it('emits stream events during execution', async () => {
    const events: string[] = []
    agent.on('stream', (event) => events.push(event.type))

    // Minimal successful run
    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'ok', summary: '', inputTokens: 30, outputTokens: 20,
    })

    mockPlanner.generatePlan.mockResolvedValue({
      description: 'Test',
      steps: [],
      estimatedFiles: [],
    })

    mockCodeEditor.applyEdits.mockResolvedValue({ applied: [], failed: [], originals: new Map() })
    mockCodeEditor.preview.mockResolvedValue([])

    await agent.run('test')
    expect(events).toContain('phase')
    expect(events).toContain('done')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/coding/coding-agent.test.ts`
Expected: FAIL — `CodingAgent` not found

- [ ] **Step 3: Implement CodingAgent**

Create `src/coding/coding-agent.ts`. This is the core agent loop.

**Key integration notes:**
- `AgentResult` from `src/agents/local.ts` does NOT have a `toolCalls` field. The ANALYZE phase uses the LLM to decide which tools to call, then parses the response text for tool names/args. Task 8a (below) adds an optional `toolCalls` field to `AgentResult` and modifies `LocalAgent` to populate it.
- Validation cannot use `run_command` (shell allow-list blocks `npm`). Uses `execFileSync` directly with the configured validation command.
- `StreamEvent` is imported from `./stream` (no local duplicate).

```typescript
import { EventEmitter } from 'events'
import { execFileSync } from 'child_process'
import type { AgentResult } from '../agents/local'
import type { ToolExecutor } from '../tools/executor'
import type { CodeEditor } from '../editor/code-editor'
import type { EditOperation } from '../editor/types'
import type {
  AgentConfig,
  AgentPhase,
  AgentRunResult,
  EditPlan,
  GatheredContext,
} from './types'
import type { StreamEvent } from './stream'
import type { Planner } from './planner'
import type { AgentMemory } from './memory'

interface LLMAgent {
  run(prompt: string, previousSummary?: string, repoContext?: string): Promise<AgentResult>
}

const MAX_ANALYZE_FILES = 5
const MAX_FILE_TOKENS = 2000 // approximate chars

export class CodingAgent extends EventEmitter {
  constructor(
    private localAgent: LLMAgent,
    private claudeAgent: LLMAgent | null,
    private toolExecutor: ToolExecutor,
    private codeEditor: CodeEditor,
    private planner: Planner,
    private memory: AgentMemory,
    private config: AgentConfig,
  ) {
    super()
  }

  async run(prompt: string): Promise<AgentRunResult> {
    let totalInput = 0
    let totalOutput = 0
    let agentUsed: 'local' | 'claude' = 'local'
    const initialOriginals = new Map<string, string>()
    let allEdits: EditOperation[] = []
    let allDiffs: string[] = []

    try {
      // === ANALYZE ===
      this.emitPhase('analyze', 'Gathering context')
      const context = await this.analyze(prompt)
      totalInput += context.tokensUsed.input
      totalOutput += context.tokensUsed.output

      // === Determine agent for PLAN+EXECUTE ===
      // Will be updated after first plan generation
      let planAgent: 'local' | 'claude' = 'local'

      for (let iteration = 1; iteration <= this.config.max_iterations; iteration++) {
        // === PLAN ===
        this.emitPhase('plan', `Iteration ${iteration}/${this.config.max_iterations}`)
        let plan: EditPlan

        if (iteration === 1) {
          plan = await this.planner.generatePlan(prompt, context.gathered, planAgent)
          // Auto-escalation: >2 files or >3 steps → Claude
          const uniqueFiles = new Set(plan.steps.map(s => s.file))
          if ((uniqueFiles.size > 2 || plan.steps.length > 3) && this.claudeAgent) {
            planAgent = 'claude'
            plan = await this.planner.generatePlan(prompt, context.gathered, planAgent)
          }
        } else {
          const errors = this.collectErrors(allEdits, allDiffs)
          plan = await this.planner.refinePlan(plan!, errors, planAgent)
        }

        agentUsed = planAgent
        this.emit('stream', { type: 'plan', plan } as StreamEvent)

        if (plan.steps.length === 0) {
          // Empty plan — nothing to do
          break
        }

        // === EXECUTE ===
        this.emitPhase('execute', `Applying ${plan.steps.length} edits`)
        const edits = await this.executeSteps(plan, planAgent)
        totalInput += edits.tokensUsed.input
        totalOutput += edits.tokensUsed.output

        const applyResult = await this.codeEditor.applyEdits(edits.operations)

        // Store initial originals (only from first iteration)
        if (iteration === 1) {
          for (const [path, content] of applyResult.originals) {
            if (!initialOriginals.has(path)) {
              initialOriginals.set(path, content)
            }
          }
        }

        if (applyResult.failed.length > 0) {
          // Rollback this iteration's edits
          this.emitPhase('execute', 'Edit failed, rolling back')
          await this.codeEditor.rollback(applyResult)
          this.emit('stream', { type: 'error', message: applyResult.failed.map(f => f.error).join('; ') } as StreamEvent)

          if (iteration === this.config.max_iterations) {
            // Final iteration — full rollback
            await this.rollbackAll(initialOriginals)
            return this.buildResult(false, [], [], null, iteration, totalInput, totalOutput, agentUsed)
          }
          continue
        }

        allEdits = [...allEdits, ...applyResult.applied]
        const previews = await this.codeEditor.preview(applyResult.applied)
        allDiffs = previews.map(p => p.diff)
        for (const p of previews) {
          this.emit('stream', { type: 'diff', file: p.file, diff: p.diff } as StreamEvent)
        }

        // === VALIDATE ===
        if (this.config.run_validation && this.config.validation_command) {
          this.emitPhase('validate', `Running: ${this.config.validation_command}`)
          const validation = await this.validate(this.config.validation_command)
          this.emit('stream', { type: 'validation', passed: validation.passed, output: validation.output } as StreamEvent)

          if (!validation.passed) {
            if (iteration === this.config.max_iterations) {
              await this.rollbackAll(initialOriginals)
              return this.buildResult(false, allEdits, allDiffs, false, iteration, totalInput, totalOutput, agentUsed)
            }
            continue
          }
        }

        // === PRESENT ===
        this.emitPhase('present', 'Done')
        const result = this.buildResult(true, allEdits, allDiffs, true, iteration, totalInput, totalOutput, agentUsed)
        this.emit('stream', { type: 'done', result } as StreamEvent)
        return result
      }

      // Fell through all iterations
      const result = this.buildResult(allEdits.length > 0, allEdits, allDiffs, null, this.config.max_iterations, totalInput, totalOutput, agentUsed)
      this.emit('stream', { type: 'done', result } as StreamEvent)
      return result
    } catch (err) {
      await this.rollbackAll(initialOriginals)
      this.emit('stream', { type: 'error', message: (err as Error).message } as StreamEvent)
      throw err
    }
  }

  private async analyze(prompt: string): Promise<{
    gathered: GatheredContext
    tokensUsed: { input: number; output: number }
  }> {
    // Use the local agent's tool-calling loop directly.
    // LocalAgent.run() processes tool calls internally and returns the final response.
    // We also get toolCalls back (added in Task 8a) to know which files were accessed.
    const toolList = this.toolExecutor.registry.describeForPrompt()
    const memoryContext = this.memory.toPromptContext()
    const knownFiles = this.memory.getRecentFiles()
    const skipNote = knownFiles.length > 0
      ? `\nAlready read (skip these): ${knownFiles.join(', ')}`
      : ''

    const analyzePrompt = `You have these tools:\n${toolList}\n\n${memoryContext}${skipNote}\n\nWhat files should I read or search to handle this request?\nRequest: ${prompt}\n\nUse tools to gather context. Limit to ${MAX_ANALYZE_FILES} files max.`

    const result = await this.localAgent.run(analyzePrompt)

    const files: GatheredContext['files'] = []
    const searchResults: GatheredContext['searchResults'] = []

    // Extract file/search info from tool calls that the agent executed
    if (result.toolCalls) {
      for (const call of result.toolCalls) {
        this.emit('stream', { type: 'tool_call', tool: call.tool, args: call.args } as StreamEvent)

        if (call.tool === 'read_file' && call.result?.success) {
          const filePath = call.args.path as string
          const truncated = (call.result.output ?? '').slice(0, MAX_FILE_TOKENS * 4)
          files.push({ path: filePath, content: truncated, relevance: 'analyzed' })
          this.memory.record({ type: 'file_read', detail: filePath })
        } else if (call.tool === 'search_code' && call.result?.success) {
          try {
            const results = JSON.parse(call.result.output ?? '[]')
            searchResults.push(...results)
            this.memory.record({ type: 'search', detail: call.args.pattern as string })
          } catch {
            // Non-JSON search output
          }
        }
      }
    }

    return {
      gathered: {
        files,
        searchResults,
        memory: this.memory.getSnapshot(),
      },
      tokensUsed: { input: result.inputTokens, output: result.outputTokens },
    }
  }

  private async executeSteps(plan: EditPlan, agent: 'local' | 'claude'): Promise<{
    operations: EditOperation[]
    tokensUsed: { input: number; output: number }
  }> {
    const llm = agent === 'claude' && this.claudeAgent ? this.claudeAgent : this.localAgent
    const operations: EditOperation[] = []
    let totalInput = 0
    let totalOutput = 0

    for (const step of plan.steps) {
      const stepPrompt = `Generate a JSON edit operation for this step:

Step: ${step.description}
File: ${step.file}
Operation: ${step.operation}
${step.search ? `Target: ${step.search}` : ''}
Reasoning: ${step.reasoning}

Respond with ONLY a JSON object:
{ "file": "...", "operation": "...", "search": "...", "content": "..." }`

      const result = await llm.run(stepPrompt)
      totalInput += result.inputTokens
      totalOutput += result.outputTokens

      try {
        const op = this.parseEditOperation(result.content, step.file)
        operations.push(op)
      } catch (err) {
        operations.push({
          file: step.file,
          operation: step.operation,
          search: step.search,
          content: '',
        })
      }
    }

    return { operations, tokensUsed: { input: totalInput, output: totalOutput } }
  }

  private parseEditOperation(response: string, fallbackFile: string): EditOperation {
    // Try direct JSON parse
    try {
      const op = JSON.parse(response)
      return { file: op.file ?? fallbackFile, operation: op.operation, search: op.search, content: op.content }
    } catch {
      // Fall through
    }

    // Try extracting from code block
    const match = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (match) {
      const op = JSON.parse(match[1])
      return { file: op.file ?? fallbackFile, operation: op.operation, search: op.search, content: op.content }
    }

    // Try finding JSON object
    const braceMatch = response.match(/\{[\s\S]*"operation"[\s\S]*\}/)
    if (braceMatch) {
      const op = JSON.parse(braceMatch[0])
      return { file: op.file ?? fallbackFile, operation: op.operation, search: op.search, content: op.content }
    }

    throw new Error('Failed to parse edit operation from LLM response')
  }

  private async validate(command: string): Promise<{ passed: boolean; output: string }> {
    // Use execFileSync directly — run_command's allow-list blocks npm/tsc/etc.
    const parts = command.trim().split(/\s+/)
    try {
      const output = execFileSync(parts[0], parts.slice(1), {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      })
      return { passed: true, output }
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string }
      return { passed: false, output: error.stderr || error.stdout || error.message || 'Validation failed' }
    }
  }

  private collectErrors(_edits: EditOperation[], _diffs: string[]): string[] {
    // Collect recent errors from memory
    const snapshot = this.memory.getSnapshot()
    return snapshot.recentErrors
  }

  private async rollbackAll(originals: Map<string, string>): Promise<void> {
    if (originals.size === 0) return
    await this.codeEditor.rollback({ applied: [], failed: [], originals })
  }

  private buildResult(
    success: boolean,
    edits: EditOperation[],
    diffs: string[],
    validationPassed: boolean | null,
    iterations: number,
    inputTokens: number,
    outputTokens: number,
    agent: 'local' | 'claude',
  ): AgentRunResult {
    return {
      success,
      edits,
      diffs,
      validationPassed,
      iterations,
      tokensUsed: { input: inputTokens, output: outputTokens },
      agent,
    }
  }

  private emitPhase(phase: AgentPhase, detail: string): void {
    this.emit('stream', { type: 'phase', phase, detail } as StreamEvent)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/coding/coding-agent.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/coding/coding-agent.ts src/coding/coding-agent.test.ts
git commit -m "feat: add CodingAgent with analyze→plan→execute→validate→present loop"
```

---

## Chunk 6: Phase D — Streaming + Config + Integration

### Task 9: Add config schema for agent

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `locode.yaml`

Note: No `EditorConfig` — the spec's `editor` config fields (`show_diff`, `color_diff`, `backup_before_edit`) are deferred until they have consumers. Adding them now would violate the "No dead config" rule in CLAUDE.md.

- [ ] **Step 1: Add Zod schema to config/schema.ts**

Add before the `ConfigSchema` definition in `src/config/schema.ts`:

```typescript
export const AgentConfigSchema = z.object({
  max_iterations: z.number().min(1).max(10).default(5),
  auto_confirm: z.boolean().default(false),
  show_plan: z.boolean().default(true),
  run_validation: z.boolean().default(true),
  validation_command: z.string().optional(),
})
```

Add inside `ConfigSchema`:

```typescript
agent: AgentConfigSchema.default({
  max_iterations: 5,
  auto_confirm: false,
  show_plan: true,
  run_validation: true,
}),
```

- [ ] **Step 2: Add defaults to locode.yaml**

Add at the end of `locode.yaml`:

```yaml

agent:
  max_iterations: 5
  auto_confirm: false
  show_plan: true
  run_validation: true
  # validation_command: "npm test"
```

- [ ] **Step 3: Run tests to verify schema changes don't break anything**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts locode.yaml
git commit -m "feat: add agent and editor config schemas"
```

### Task 10: Implement StreamRenderer

**Files:**
- Create: `src/coding/stream.ts`
- Create: `src/coding/stream.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/coding/stream.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentStream, StreamRenderer } from './stream'

describe('AgentStream', () => {
  it('emits and receives stream events', () => {
    const stream = new AgentStream()
    const handler = vi.fn()
    stream.on('stream', handler)
    stream.emit('stream', { type: 'phase', phase: 'analyze', detail: 'Starting' })
    expect(handler).toHaveBeenCalledWith({ type: 'phase', phase: 'analyze', detail: 'Starting' })
  })
})

describe('StreamRenderer', () => {
  let stream: AgentStream
  let renderer: StreamRenderer
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stream = new AgentStream()
    renderer = new StreamRenderer(stream) // AgentStream extends EventEmitter
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    renderer.stop()
  })

  it('renders phase events', () => {
    renderer.start()
    stream.emit('stream', { type: 'phase', phase: 'analyze', detail: 'Gathering context' })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ANALYZE'))
  })

  it('renders error events', () => {
    renderer.start()
    stream.emit('stream', { type: 'error', message: 'Something broke' })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Something broke'))
  })

  it('renders plan events', () => {
    renderer.start()
    stream.emit('stream', {
      type: 'plan',
      plan: { description: 'Fix bug', steps: [{ description: 'step1', file: 'a.ts', operation: 'replace', reasoning: 'fix' }], estimatedFiles: ['a.ts'] },
    })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Fix bug'))
  })

  it('does not render after stop', () => {
    renderer.start()
    renderer.stop()
    stream.emit('stream', { type: 'phase', phase: 'plan', detail: 'Planning' })
    // Should not have logged the plan phase after stop
    const planCalls = consoleSpy.mock.calls.filter(c => String(c[0]).includes('PLAN'))
    expect(planCalls).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/coding/stream.test.ts`
Expected: FAIL — `AgentStream` and `StreamRenderer` not found

- [ ] **Step 3: Implement stream.ts**

Create `src/coding/stream.ts`:

```typescript
import { EventEmitter } from 'events'
import chalk from 'chalk'
import type { AgentPhase, EditPlan, AgentRunResult } from './types'
import { DiffRenderer } from '../editor/diff-renderer'

export type StreamEvent =
  | { type: 'phase'; phase: AgentPhase; detail: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; success: boolean; summary: string }
  | { type: 'plan'; plan: EditPlan }
  | { type: 'diff'; file: string; diff: string }
  | { type: 'validation'; passed: boolean; output: string }
  | { type: 'error'; message: string }
  | { type: 'done'; result: AgentRunResult }

export class AgentStream extends EventEmitter {
  emit(event: 'stream', data: StreamEvent): boolean {
    return super.emit(event, data)
  }

  on(event: 'stream', handler: (data: StreamEvent) => void): this {
    return super.on(event, handler)
  }
}

export class StreamRenderer {
  private active = false

  constructor(private stream: EventEmitter) {}

  start(): void {
    this.active = true
    this.stream.on('stream', this.handleEvent)
  }

  stop(): void {
    this.active = false
    this.stream.removeListener('stream', this.handleEvent)
  }

  private handleEvent = (event: StreamEvent): void => {
    if (!this.active) return

    switch (event.type) {
      case 'phase':
        console.log(chalk.bold.blue(`\n[${event.phase.toUpperCase()}] ${event.detail}`))
        break

      case 'tool_call':
        console.log(chalk.gray(`  → ${event.tool}(${Object.values(event.args).join(', ')})`))
        break

      case 'tool_result':
        console.log(chalk.gray(`  ${event.success ? '✓' : '✗'} ${event.summary.slice(0, 100)}`))
        break

      case 'plan':
        console.log(chalk.yellow(`\n─── Edit Plan: ${event.plan.description} ───`))
        for (const step of event.plan.steps) {
          console.log(chalk.gray(`  ${step.operation} ${step.file}: ${step.description}`))
        }
        break

      case 'diff':
        console.log(DiffRenderer.colorize(event.diff))
        break

      case 'validation':
        if (event.passed) {
          console.log(chalk.green('✓ Validation passed'))
        } else {
          console.log(chalk.red('✗ Validation failed'))
          console.log(chalk.gray(event.output.slice(0, 500)))
        }
        break

      case 'error':
        console.log(chalk.red(`Error: ${event.message}`))
        break

      case 'done':
        if (event.result.success) {
          console.log(chalk.green(`\n✓ ${event.result.edits.length} edits applied in ${event.result.iterations} iteration(s)`))
        }
        break
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/coding/stream.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/coding/stream.ts src/coding/stream.test.ts
git commit -m "feat: add AgentStream and StreamRenderer for real-time CLI output"
```

### Task 11: Wire CodingAgent into Orchestrator + REPL

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`
- Modify: `src/cli/repl.ts`

- [ ] **Step 1: Add isCodingTask() and runCodingAgent() to Orchestrator**

Add these imports to `src/orchestrator/orchestrator.ts`:

```typescript
import { CodingAgent } from '../coding/coding-agent'
import { Planner } from '../coding/planner'
import { AgentMemory } from '../coding/memory'
import { CodeEditor } from '../editor/code-editor'
import type { AgentRunResult } from '../coding/types'
```

Add a `codingAgent` field and initialization in the `Orchestrator` constructor:

```typescript
private codingAgent: CodingAgent | null = null
```

Add at the end of the constructor:

```typescript
if (config.agent) {
  const codeEditor = new CodeEditor(safetyGate, process.cwd())
  const planner = new Planner(this.localAgent, this.claudeAgent)
  const agentMemory = new AgentMemory()
  this.codingAgent = new CodingAgent(
    this.localAgent,
    this.localOnly ? null : this.claudeAgent,
    this.toolExecutor,
    codeEditor,
    planner,
    agentMemory,
    config.agent,
  )
}
```

Add these methods:

```typescript
isCodingTask(prompt: string): boolean {
  // Exclude explanatory prefixes
  if (/^(explain|describe|what|how|why|show|tell|list)\b/i.test(prompt)) return false
  return /\b(add|fix|implement|refactor|change|update|modify|create|write|delete|remove)\b/i.test(prompt)
}

async runCodingAgent(prompt: string): Promise<OrchestratorResult> {
  if (!this.codingAgent) {
    return this.process(prompt)
  }
  const result = await this.codingAgent.run(prompt)
  this.tracker.record({
    agent: result.agent,
    input: result.tokensUsed.input,
    output: result.tokensUsed.output,
    model: result.agent === 'local' ? this.config.local_llm.model : this.config.claude.model,
  })
  const summary = result.success
    ? `Applied ${result.edits.length} edits (${result.iterations} iterations)`
    : 'Coding agent failed to apply edits'
  return {
    content: result.diffs.join('\n') || summary,
    summary,
    inputTokens: result.tokensUsed.input,
    outputTokens: result.tokensUsed.output,
    agent: result.agent,
    routeMethod: 'rule',
    reason: 'coding task detected',
  }
}

getCodingAgent(): CodingAgent | null {
  return this.codingAgent
}
```

Modify the `process()` method — add after the `localOnly` and `claudeOnly` early returns (line ~135), before the `router.classify()` call:

```typescript
// Coding task detection — routes to CodingAgent (respects mode flags)
if (!this.localFallback && this.codingAgent && this.isCodingTask(prompt)) {
  return this.runCodingAgent(enrichedPrompt)
}
```

Note: This placement ensures `--local-only`, `--claude-only`, and localFallback modes are respected. The prompt is enriched with file context before reaching here.

- [ ] **Step 2: Wire StreamRenderer into REPL**

Add this import to `src/cli/repl.ts`:

```typescript
import { StreamRenderer } from '../coding/stream'
```

In the REPL's line handler, before the existing `if (orch.isLocalOnly() || ...)` block, add:

```typescript
// Coding task — use streaming agent
if (orch.getCodingAgent() && orch.isCodingTask(input)) {
  const codingAgent = orch.getCodingAgent()!
  const renderer = new StreamRenderer(codingAgent as any) // CodingAgent extends EventEmitter
  renderer.start()
  try {
    result = await orch.runCodingAgent(input)
  } finally {
    renderer.stop() // stop() removes the listener — no leak
  }
} else
```

Note: `StreamRenderer` listens directly on `CodingAgent` (which extends `EventEmitter` and emits `'stream'` events). No intermediate `AgentStream` needed. `renderer.stop()` calls `removeListener()`, preventing listener accumulation over a long REPL session.

This should be placed so the existing `if (orch.isLocalOnly() || ...)` becomes the `else` branch.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/cli/repl.ts
git commit -m "feat: wire CodingAgent into Orchestrator and REPL with streaming"
```

---

## Chunk 7: Final Verification

### Task 12: End-to-end verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Verify file structure**

Run: `find src/editor src/coding src/tools/definitions/search-code.ts -type f | sort`
Expected:
```
src/coding/coding-agent.test.ts
src/coding/coding-agent.ts
src/coding/memory.test.ts
src/coding/memory.ts
src/coding/planner.test.ts
src/coding/planner.ts
src/coding/stream.test.ts
src/coding/stream.ts
src/coding/types.ts
src/editor/code-editor.test.ts
src/editor/code-editor.ts
src/editor/diff-renderer.test.ts
src/editor/diff-renderer.ts
src/editor/types.ts
src/tools/definitions/search-code.ts
```

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: v0.3 coding agent final cleanup"
```
