import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSymbolLookupTool } from './symbol-lookup'
import { CodebaseIndexer } from '../../index/indexer'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { IndexConfig } from '../../index/types'

describe('createSymbolLookupTool', () => {
  let tmpDir: string
  let indexer: CodebaseIndexer

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-symtool-'))
    const config: IndexConfig = {
      root: tmpDir,
      ignore: ['node_modules', 'dist', '.git'],
      languages: ['typescript'],
      storage_dir: path.join(tmpDir, '.locode', 'index'),
      auto_update: true,
    }
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export function foo() { return 1 }\nexport class Bar { method() {} }\n')
    indexer = new CodebaseIndexer(config)
    await indexer.buildAll()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds symbols by name', async () => {
    const tool = createSymbolLookupTool(indexer)
    const result = await tool.handler({ name: 'foo' })
    expect(result.success).toBe(true)
    const symbols = JSON.parse(result.output)
    expect(symbols).toHaveLength(1)
    expect(symbols[0].name).toBe('foo')
    expect(symbols[0].type).toBe('function')
  })

  it('filters by type', async () => {
    const tool = createSymbolLookupTool(indexer)
    const result = await tool.handler({ name: 'Bar', type: 'class' })
    expect(result.success).toBe(true)
    const symbols = JSON.parse(result.output)
    expect(symbols).toHaveLength(1)
    expect(symbols[0].type).toBe('class')
  })

  it('returns empty array when no matches', async () => {
    const tool = createSymbolLookupTool(indexer)
    const result = await tool.handler({ name: 'nonexistent' })
    expect(result.success).toBe(true)
    expect(JSON.parse(result.output)).toEqual([])
  })

  it('returns error when index is not built', async () => {
    const emptyIndexer = new CodebaseIndexer({
      root: tmpDir,
      ignore: [],
      languages: ['typescript'],
      storage_dir: path.join(tmpDir, 'idx'),
      auto_update: true,
    })
    const tool = createSymbolLookupTool(emptyIndexer)
    const result = await tool.handler({ name: 'foo' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not built')
  })

  it('has correct tool metadata', () => {
    const tool = createSymbolLookupTool(indexer)
    expect(tool.name).toBe('symbol_lookup')
    expect(tool.category).toBe('search')
    expect(tool.requiresConfirmation).toBe(false)
    expect(tool.inputSchema.required).toEqual(['name'])
  })
})
