import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CodebaseIndexer } from './indexer'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { IndexConfig } from './types'

describe('CodebaseIndexer', () => {
  let tmpDir: string
  let config: IndexConfig

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-indexer-'))
    config = {
      root: tmpDir,
      ignore: ['node_modules', 'dist', '.git', 'coverage', '*.min.js', '*.lock'],
      languages: ['typescript', 'javascript', 'python'],
      storage_dir: path.join(tmpDir, '.locode', 'index'),
      auto_update: true,
    }
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeFile(rel: string, content: string): void {
    const full = path.join(tmpDir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf8')
  }

  it('buildAll indexes files and symbols', async () => {
    writeFile('src/a.ts', 'export function foo() { return 1 }\n')
    writeFile('src/b.ts', [
      'export class Bar {',
      '  method() {}',
      '}',
    ].join('\n'))
    writeFile('README.md', '# hello\n')

    const indexer = new CodebaseIndexer(config)
    const stats = await indexer.buildAll()

    expect(stats.files).toBeGreaterThanOrEqual(3)
    expect(stats.symbols).toBeGreaterThanOrEqual(3) // foo, Bar, method
    expect(stats.buildTimeMs).toBeGreaterThanOrEqual(0)
    expect(indexer.isIndexed()).toBe(true)
  })

  it('isIndexed returns false before build', () => {
    const indexer = new CodebaseIndexer(config)
    expect(indexer.isIndexed()).toBe(false)
  })

  it('get files returns the FileIndex', async () => {
    writeFile('a.ts', '')
    const indexer = new CodebaseIndexer(config)
    await indexer.buildAll()
    expect(indexer.files.find('a.ts')).toHaveLength(1)
  })

  it('get symbols returns the SymbolIndex', async () => {
    writeFile('a.ts', 'export function foo() {}')
    const indexer = new CodebaseIndexer(config)
    await indexer.buildAll()
    expect(indexer.symbols.search('foo')).toHaveLength(1)
  })

  it('update re-indexes only changed files', async () => {
    writeFile('a.ts', 'export function foo() { return 1 }\n')
    writeFile('b.ts', 'export function bar() { return 2 }\n')

    const indexer = new CodebaseIndexer(config)
    await indexer.buildAll()
    expect(indexer.symbols.search('foo')).toHaveLength(1)
    expect(indexer.symbols.search('bar')).toHaveLength(1)

    writeFile('c.ts', 'export function baz() { return 3 }\n')
    fs.unlinkSync(path.join(tmpDir, 'b.ts'))
    writeFile('a.ts', 'export function foo() { return 999 }\n')

    const stats = await indexer.update()

    expect(stats.files).toBe(2) // a.ts changed + c.ts added
    expect(indexer.symbols.search('bar')).toHaveLength(0) // b.ts removed
    expect(indexer.symbols.search('baz')).toHaveLength(1) // c.ts added
  })

  it('save persists to storage_dir and load restores', async () => {
    writeFile('a.ts', 'export function foo() {}')
    writeFile('b.ts', 'export class Bar {}')

    const indexer = new CodebaseIndexer(config)
    await indexer.buildAll()
    await indexer.save()

    const reloaded = new CodebaseIndexer(config)
    await reloaded.load()

    expect(reloaded.isIndexed()).toBe(true)
    expect(reloaded.files.find('a.ts')).toHaveLength(1)
    expect(reloaded.symbols.search('foo')).toHaveLength(1)
    expect(reloaded.symbols.search('Bar')).toHaveLength(1)
  })

  it('only extracts symbols for configured languages', async () => {
    writeFile('a.ts', 'export function foo() {}')
    writeFile('b.go', 'package main\nfunc bar() {}')

    const indexer = new CodebaseIndexer(config)
    await indexer.buildAll()

    expect(indexer.symbols.search('foo')).toHaveLength(1)
    expect(indexer.symbols.search('bar')).toHaveLength(0) // go not in languages
  })

  it('handles empty repo gracefully', async () => {
    const indexer = new CodebaseIndexer(config)
    const stats = await indexer.buildAll()

    expect(stats.files).toBe(0)
    expect(stats.symbols).toBe(0)
    expect(indexer.isIndexed()).toBe(true)
  })

  it('update throws if called before buildAll', async () => {
    const indexer = new CodebaseIndexer(config)
    await expect(indexer.update()).rejects.toThrow()
  })
})
