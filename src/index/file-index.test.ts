import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileIndex } from './file-index'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { IndexConfig } from './types'

describe('FileIndex', () => {
  let tmpDir: string
  let index: FileIndex
  let config: IndexConfig

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-findex-'))
    config = {
      root: tmpDir,
      ignore: ['node_modules', 'dist', '.git', 'coverage', '*.min.js', '*.lock'],
      languages: ['typescript', 'javascript', 'python', 'go', 'rust'],
      storage_dir: path.join(tmpDir, '.locode', 'index'),
      auto_update: true,
    }
    index = new FileIndex()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeFile(rel: string, content: string): void {
    const full = path.join(tmpDir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf8')
  }

  it('scans files and records path, language, size, hash', async () => {
    writeFile('src/a.ts', 'export const x = 1\n')
    writeFile('src/b.js', 'module.exports = 2\n')
    writeFile('README.md', '# hello\n')

    await index.build(config)

    const all = index.all()
    expect(all.length).toBeGreaterThanOrEqual(3)
    const a = index.find('src/a.ts')[0]
    expect(a).toBeDefined()
    expect(a!.language).toBe('typescript')
    expect(a!.size).toBe(Buffer.byteLength('export const x = 1\n'))
    expect(a!.hash).toHaveLength(64) // sha-256 hex
    expect(a!.lastIndexed).toBeGreaterThan(0)
  })

  it('detects language from file extension', async () => {
    writeFile('a.ts', '')
    writeFile('b.js', '')
    writeFile('c.py', '')
    writeFile('d.go', '')
    writeFile('e.rs', '')
    writeFile('f.json', '{}')

    await index.build(config)

    expect(index.find('a.ts')[0]?.language).toBe('typescript')
    expect(index.find('b.js')[0]?.language).toBe('javascript')
    expect(index.find('c.py')[0]?.language).toBe('python')
    expect(index.find('d.go')[0]?.language).toBe('go')
    expect(index.find('e.rs')[0]?.language).toBe('rust')
    expect(index.find('f.json')[0]?.language).toBe('json')
  })

  it('respects ignore patterns (directory names)', async () => {
    writeFile('src/main.ts', 'export const x = 1\n')
    writeFile('node_modules/lib.ts', 'export const y = 2\n')
    writeFile('dist/build.js', 'var z = 3\n')

    await index.build(config)

    const paths = index.all().map(e => e.path)
    expect(paths).toContain('src/main.ts')
    expect(paths).not.toContain('node_modules/lib.ts')
    expect(paths).not.toContain('dist/build.js')
  })

  it('respects glob ignore patterns (*.min.js, *.lock)', async () => {
    writeFile('app.min.js', 'var a=1\n')
    writeFile('package.lock', '{}')
    writeFile('app.js', 'var b=2\n')

    await index.build(config)

    const paths = index.all().map(e => e.path)
    expect(paths).toContain('app.js')
    expect(paths).not.toContain('app.min.js')
    expect(paths).not.toContain('package.lock')
  })

  it('respects .gitignore in the repo root', async () => {
    writeFile('.gitignore', 'secrets/\n*.env\n')
    writeFile('src/index.ts', 'export const x = 1\n')
    writeFile('secrets/key.txt', 'SECRET\n')
    writeFile('.env', 'TOKEN=abc\n')

    await index.build(config)

    const paths = index.all().map(e => e.path)
    expect(paths).toContain('src/index.ts')
    expect(paths).not.toContain('secrets/key.txt')
    expect(paths).not.toContain('.env')
  })

  it('find by glob pattern', async () => {
    writeFile('src/a.ts', '')
    writeFile('src/b.ts', '')
    writeFile('src/sub/c.ts', '')
    writeFile('src/d.js', '')

    await index.build(config)

    const tsFiles = index.find('src/*.ts')
    expect(tsFiles.map(e => e.path).sort()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('findByLanguage returns files of a given language', async () => {
    writeFile('a.ts', '')
    writeFile('b.ts', '')
    writeFile('c.js', '')

    await index.build(config)

    const ts = index.findByLanguage('typescript')
    expect(ts.map(e => e.path).sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('update detects added, removed, and changed files', async () => {
    writeFile('a.ts', 'export const x = 1\n')
    writeFile('b.ts', 'export const y = 2\n')

    await index.build(config)
    expect(index.all()).toHaveLength(2)

    writeFile('c.ts', 'export const z = 3\n')
    fs.unlinkSync(path.join(tmpDir, 'b.ts'))
    writeFile('a.ts', 'export const x = 999\n')

    const result = await index.update()

    expect(result.added).toEqual(['c.ts'])
    expect(result.removed).toEqual(['b.ts'])
    expect(result.changed).toEqual(['a.ts'])
    expect(index.all()).toHaveLength(2)
  })

  it('save and load round-trips the index', async () => {
    writeFile('a.ts', 'export const x = 1\n')
    writeFile('b.js', 'var y = 2\n')

    await index.build(config)
    await index.save(config.storage_dir)

    const reloaded = new FileIndex()
    await reloaded.load(config.storage_dir)

    expect(reloaded.all().map(e => e.path).sort()).toEqual(['a.ts', 'b.js'])
    expect(reloaded.find('a.ts')[0]?.hash).toBe(index.find('a.ts')[0]?.hash)
  })

  it('isIndexed returns false before build, true after', async () => {
    expect(index.isIndexed()).toBe(false)
    writeFile('a.ts', '')
    await index.build(config)
    expect(index.isIndexed()).toBe(true)
  })

  it('indexes all known file types regardless of languages config (languages filters symbols, not files)', async () => {
    config.languages = ['typescript']
    writeFile('a.ts', '')
    writeFile('b.js', '')
    writeFile('c.md', '')

    await index.build(config)

    const paths = index.all().map(e => e.path)
    expect(paths).toContain('a.ts')
    expect(paths).toContain('b.js')
    expect(paths).toContain('c.md')
  })
})
