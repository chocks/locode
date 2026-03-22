import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { PersistentContextCache } from './persistent-context-cache'
import type { GatheredContext } from '../coding/types'

describe('PersistentContextCache', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeContext(filePath: string, content: string): GatheredContext {
    return {
      files: [{ path: filePath, content, relevance: 'test' }],
      searchResults: [],
      memory: {
        recentFiles: [filePath],
        recentEdits: [],
        recentCommands: [],
        recentErrors: [],
        sessionStart: Date.now(),
      },
    }
  }

  it('persists and reloads gathered context when file hashes still match', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-context-cache-'))
    const cache = new PersistentContextCache(tmpDir)
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-context-proj-'))
    const filePath = path.join(projectDir, 'src.ts')
    fs.writeFileSync(filePath, 'const x = 1\n', 'utf8')

    await cache.set('fix src.ts', makeContext(filePath, 'const x = 1\n'))
    const loaded = await cache.get('fix src.ts')

    expect(loaded).not.toBeNull()
    expect(loaded?.files[0].path).toBe(filePath)
  })

  it('invalidates cached context when a cached file changes', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-context-cache-'))
    const cache = new PersistentContextCache(tmpDir)
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-context-proj-'))
    const filePath = path.join(projectDir, 'src.ts')
    fs.writeFileSync(filePath, 'const x = 1\n', 'utf8')

    await cache.set('fix src.ts', makeContext(filePath, 'const x = 1\n'))
    fs.writeFileSync(filePath, 'const x = 2\n', 'utf8')

    const loaded = await cache.get('fix src.ts')
    expect(loaded).toBeNull()
  })
})
