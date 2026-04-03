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

  async function tick(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 5))
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

  it('evicts the oldest cache entries when maxEntries is exceeded', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-context-cache-'))
    const cache = new PersistentContextCache(tmpDir, { maxEntries: 2, maxBytes: 1024 * 1024 })
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-context-proj-'))
    const a = path.join(projectDir, 'a.ts')
    const b = path.join(projectDir, 'b.ts')
    const c = path.join(projectDir, 'c.ts')
    fs.writeFileSync(a, 'a\n', 'utf8')
    fs.writeFileSync(b, 'b\n', 'utf8')
    fs.writeFileSync(c, 'c\n', 'utf8')

    await cache.set('prompt a', makeContext(a, 'a\n'))
    await tick()
    await cache.set('prompt b', makeContext(b, 'b\n'))
    await tick()
    await cache.set('prompt c', makeContext(c, 'c\n'))

    expect(await cache.get('prompt a')).toBeNull()
    expect(await cache.get('prompt b')).not.toBeNull()
    expect(await cache.get('prompt c')).not.toBeNull()
  })

  it('evicts old entries until total cache size is within maxBytes', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-context-cache-'))
    const cache = new PersistentContextCache(tmpDir, { maxEntries: 10, maxBytes: 1000 })
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-context-proj-'))
    const a = path.join(projectDir, 'large-a.ts')
    const b = path.join(projectDir, 'large-b.ts')
    const c = path.join(projectDir, 'large-c.ts')
    const content = 'x'.repeat(120)
    fs.writeFileSync(a, content, 'utf8')
    fs.writeFileSync(b, content, 'utf8')
    fs.writeFileSync(c, content, 'utf8')

    await cache.set('prompt a', makeContext(a, content))
    await tick()
    await cache.set('prompt b', makeContext(b, content))
    await tick()
    await cache.set('prompt c', makeContext(c, content))

    const files = fs.readdirSync(tmpDir).filter(file => file.endsWith('.json'))
    const totalBytes = files.reduce((sum, file) => sum + fs.statSync(path.join(tmpDir, file)).size, 0)

    expect(totalBytes).toBeLessThanOrEqual(1000)
    expect(await cache.get('prompt a')).toBeNull()
    expect(await cache.get('prompt b')).toBeNull()
    expect(await cache.get('prompt c')).not.toBeNull()
  })
})
