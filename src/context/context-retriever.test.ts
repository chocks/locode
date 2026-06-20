import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ContextRetriever } from './context-retriever'
import { CodebaseIndexer } from '../index/indexer'
import type { RetrievalConfig, MemorySnapshot } from './types'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { IndexConfig } from '../index/types'

const EMPTY_MEMORY: MemorySnapshot = {
  recentFiles: [],
  recentEdits: [],
  recentCommands: [],
  recentErrors: [],
  sessionStart: 0,
}

describe('ContextRetriever', () => {
  let tmpDir: string
  let indexer: CodebaseIndexer
  let config: RetrievalConfig
  let indexConfig: IndexConfig

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-retriever-'))
    indexConfig = {
      root: tmpDir,
      ignore: ['node_modules', 'dist', '.git', 'coverage'],
      languages: ['typescript', 'javascript'],
      storage_dir: path.join(tmpDir, '.locode', 'index'),
      auto_update: true,
    }
    config = {
      max_files: 5,
      max_tokens_per_file: 2000,
      max_total_tokens: 8000,
      strategy: 'deterministic-first',
      confidence_threshold: 0.7,
    }
    indexer = new CodebaseIndexer(indexConfig)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeFile(rel: string, content: string): void {
    const full = path.join(tmpDir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf8')
  }

  async function buildIndex(): Promise<void> {
    await indexer.buildAll()
  }

  it('resolves files mentioned by name in the prompt', async () => {
    writeFile('src/router.ts', 'export function route() { return "local" }\n')
    await buildIndex()

    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory: EMPTY_MEMORY })
    const result = await retriever.retrieve('fix the bug in router.ts')

    expect(result.strategyUsed).toContain('mentioned-path')
    expect(result.files.some(f => f.path === 'src/router.ts')).toBe(true)
    expect(result.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('finds symbols mentioned in the prompt', async () => {
    writeFile('src/orchestrator.ts', 'export function processTask() { return null }\n')
    await buildIndex()

    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory: EMPTY_MEMORY })
    const result = await retriever.retrieve('how does processTask work?')

    expect(result.strategyUsed).toContain('symbol-index')
    expect(result.files.some(f => f.path === 'src/orchestrator.ts')).toBe(true)
  })

  it('discovers sibling test files for mentioned source files', async () => {
    writeFile('src/utils.ts', 'export function helper() { return 1 }\n')
    writeFile('src/utils.test.ts', 'import { helper } from "./utils"\n')
    await buildIndex()

    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory: EMPTY_MEMORY })
    const result = await retriever.retrieve('update utils.ts to handle edge cases')

    expect(result.strategyUsed).toContain('test-discovery')
    expect(result.files.some(f => f.path === 'src/utils.test.ts')).toBe(true)
  })

  it('includes recent files from memory', async () => {
    writeFile('src/recent.ts', 'export const x = 1\n')
    await buildIndex()

    const memory: MemorySnapshot = {
      ...EMPTY_MEMORY,
      recentFiles: ['src/recent.ts'],
    }
    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory })
    const result = await retriever.retrieve('continue working on this')

    expect(result.files.some(f => f.path === 'src/recent.ts')).toBe(true)
  })

  it('respects max_files limit', async () => {
    writeFile('a.ts', 'export const a = 1\n')
    writeFile('b.ts', 'export const b = 2\n')
    writeFile('c.ts', 'export const c = 3\n')
    await buildIndex()

    config.max_files = 2
    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory: EMPTY_MEMORY })
    const result = await retriever.retrieve('look at a.ts b.ts c.ts')

    expect(result.files.length).toBeLessThanOrEqual(2)
  })

  it('respects max_total_tokens budget', async () => {
    writeFile('big.ts', 'x'.repeat(5000))
    writeFile('big2.ts', 'y'.repeat(5000))
    await buildIndex()

    config.max_total_tokens = 100
    config.max_files = 5
    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory: EMPTY_MEMORY })
    const result = await retriever.retrieve('look at big.ts and big2.ts')

    const totalChars = result.files.reduce((sum, f) => sum + f.content.length, 0)
    expect(totalChars).toBeLessThanOrEqual(100)
  })

  it('returns low confidence when no files are found', async () => {
    writeFile('unrelated.ts', 'export const z = 0\n')
    await buildIndex()

    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory: EMPTY_MEMORY })
    const result = await retriever.retrieve('something completely unrelated')

    expect(result.confidence).toBeLessThan(config.confidence_threshold)
  })

  it('deduplicates files found by multiple strategies', async () => {
    writeFile('src/foo.ts', 'export function foo() {}\n')
    writeFile('src/foo.test.ts', 'import { foo } from "./foo"\n')
    await buildIndex()

    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory: EMPTY_MEMORY })
    const result = await retriever.retrieve('fix foo in foo.ts')

    const fooCount = result.files.filter(f => f.path === 'src/foo.ts').length
    expect(fooCount).toBe(1)
  })

  it('includes search results from symbol lookup', async () => {
    writeFile('src/api.ts', 'export function handleRequest() { return 200 }\n')
    await buildIndex()

    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory: EMPTY_MEMORY })
    const result = await retriever.retrieve('where is handleRequest defined?')

    expect(result.searchResults.length).toBeGreaterThan(0)
    expect(result.searchResults.some(s => s.match.includes('handleRequest'))).toBe(true)
  })

  it('returns empty context for empty repo', async () => {
    await buildIndex()
    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory: EMPTY_MEMORY })
    const result = await retriever.retrieve('fix the bug in main.ts')

    expect(result.files).toHaveLength(0)
    expect(result.confidence).toBeLessThan(config.confidence_threshold)
  })

  it('returns memory snapshot in gathered context', async () => {
    writeFile('a.ts', 'export const a = 1\n')
    await buildIndex()

    const memory: MemorySnapshot = {
      ...EMPTY_MEMORY,
      recentFiles: ['a.ts'],
      sessionStart: 12345,
    }
    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory })
    const result = await retriever.retrieve('look at a.ts')

    expect(result.memory).toEqual(memory)
  })

  it('marks relevance reason for each file', async () => {
    writeFile('src/router.ts', 'export function route() {}\n')
    writeFile('src/router.test.ts', 'import { route } from "./router"\n')
    await buildIndex()

    const retriever = new ContextRetriever(indexer, config, { root: tmpDir, memory: EMPTY_MEMORY })
    const result = await retriever.retrieve('fix bug in router.ts')

    const router = result.files.find(f => f.path === 'src/router.ts')
    expect(router).toBeDefined()
    expect(router!.relevance).toBeTruthy()
  })
})
