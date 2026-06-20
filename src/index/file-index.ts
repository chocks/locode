import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { FileEntry, IndexConfig, IncrementalUpdateResult } from './types'

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.css': 'css',
  '.html': 'html',
  '.sh': 'shell',
}

const LANGUAGE_EXTENSIONS = new Set(Object.keys(EXTENSION_TO_LANGUAGE))

export class FileIndex {
  private files: Map<string, FileEntry> = new Map()
  private indexed = false
  private lastConfig: IndexConfig | null = null

  async build(config: IndexConfig): Promise<void> {
    this.files.clear()
    const ignorePatterns = this.loadIgnorePatterns(config)
    const root = config.root

    for (const filePath of this.walk(root, ignorePatterns)) {
      const rel = path.relative(root, filePath)
      const language = this.detectLanguage(rel)
      const stat = fs.statSync(filePath)
      this.files.set(rel, {
        path: rel,
        language,
        size: stat.size,
        hash: this.hashFile(filePath),
        lastIndexed: Date.now(),
      })
    }

    this.indexed = true
    this.lastConfig = config
  }

  async update(): Promise<IncrementalUpdateResult> {
    if (!this.indexed || !this.lastConfig) {
      throw new Error('FileIndex.update() called before build()')
    }
    const config = this.lastConfig
    const ignorePatterns = this.loadIgnorePatterns(config)
    const root = config.root
    const currentPaths = new Set<string>()

    const added: string[] = []
    const changed: string[] = []

    for (const filePath of this.walk(root, ignorePatterns)) {
      const rel = path.relative(root, filePath)
      const language = this.detectLanguage(rel)
      currentPaths.add(rel)
      const stat = fs.statSync(filePath)
      const hash = this.hashFile(filePath)
      const existing = this.files.get(rel)
      if (!existing) {
        added.push(rel)
        this.files.set(rel, {
          path: rel, language, size: stat.size, hash, lastIndexed: Date.now(),
        })
      } else if (existing.hash !== hash) {
        changed.push(rel)
        this.files.set(rel, {
          path: rel, language, size: stat.size, hash, lastIndexed: Date.now(),
        })
      }
    }

    const removed: string[] = []
    for (const rel of this.files.keys()) {
      if (!currentPaths.has(rel)) {
        removed.push(rel)
        this.files.delete(rel)
      }
    }

    return { added, removed, changed }
  }

  find(glob: string): FileEntry[] {
    const matcher = this.globToRegex(glob)
    return this.all().filter(e => matcher.test(e.path))
  }

  findByLanguage(lang: string): FileEntry[] {
    return this.all().filter(e => e.language === lang)
  }

  all(): FileEntry[] {
    return [...this.files.values()]
  }

  isIndexed(): boolean {
    return this.indexed
  }

  async save(dir: string): Promise<void> {
    fs.mkdirSync(dir, { recursive: true })
    const data = JSON.stringify([...this.files.values()], null, 2)
    fs.writeFileSync(path.join(dir, 'files.json'), data, 'utf8')
  }

  async load(dir: string): Promise<void> {
    const file = path.join(dir, 'files.json')
    const data = fs.readFileSync(file, 'utf8')
    const entries: FileEntry[] = JSON.parse(data)
    this.files.clear()
    for (const entry of entries) {
      this.files.set(entry.path, entry)
    }
    this.indexed = true
  }

  private loadIgnorePatterns(config: IndexConfig): string[] {
    const patterns = [...config.ignore]
    const gitignorePath = path.join(config.root, '.gitignore')
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          patterns.push(trimmed)
        }
      }
    }
    return patterns
  }

  private walk(root: string, ignorePatterns: string[]): string[] {
    const results: string[] = []
    const matchers = ignorePatterns.map(p => this.globToRegex(p))
    const stack: string[] = [root]

    while (stack.length > 0) {
      const dir = stack.pop()!
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        const rel = path.relative(root, full)
        if (matchers.some(m => m.test(rel) || m.test(entry.name))) {
          continue
        }
        if (entry.isDirectory()) {
          stack.push(full)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (LANGUAGE_EXTENSIONS.has(ext)) {
            results.push(full)
          }
        }
      }
    }
    return results
  }

  private detectLanguage(relPath: string): string {
    const ext = path.extname(relPath).toLowerCase()
    return EXTENSION_TO_LANGUAGE[ext] ?? 'unknown'
  }

  private hashFile(filePath: string): string {
    const content = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(content).digest('hex')
  }

  private globToRegex(glob: string): RegExp {
    let pattern = glob.replace(/[.+^{}()|[\]\\]/g, '\\$&')
    let result = ''
    let i = 0
    while (i < pattern.length) {
      if (pattern[i] === '*' && pattern[i + 1] === '*') {
        result += '.*'
        i += 2
      } else if (pattern[i] === '*') {
        result += '[^/]*'
        i += 1
      } else if (pattern[i] === '?') {
        result += '[^/]'
        i += 1
      } else {
        result += pattern[i]
        i += 1
      }
    }
    pattern = result
    if (!pattern.includes('/')) {
      pattern = `(^|/)${pattern}($|/)`
    } else {
      pattern = `^${pattern}$`
    }
    return new RegExp(pattern)
  }
}
