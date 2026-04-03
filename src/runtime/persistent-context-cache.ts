import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { GatheredContext } from '../coding/types'

interface CachedContextRecord {
  prompt: string
  gathered: GatheredContext
  fileHashes: Record<string, string>
}

interface PersistentContextCacheOptions {
  maxEntries: number
  maxBytes: number
}

export class PersistentContextCache {
  constructor(
    private baseDir: string,
    private options: PersistentContextCacheOptions = {
      maxEntries: 200,
      maxBytes: 5 * 1024 * 1024,
    },
  ) {}

  async get(prompt: string): Promise<GatheredContext | null> {
    const filePath = this.cacheFile(prompt)
    if (!fs.existsSync(filePath)) return null

    try {
      const cached = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CachedContextRecord
      for (const [targetPath, cachedHash] of Object.entries(cached.fileHashes)) {
        if (!fs.existsSync(targetPath)) return null
        const currentHash = this.hashFile(targetPath)
        if (currentHash !== cachedHash) return null
      }
      return cached.gathered
    } catch {
      return null
    }
  }

  async set(prompt: string, gathered: GatheredContext): Promise<void> {
    fs.mkdirSync(this.baseDir, { recursive: true })
    const fileHashes: Record<string, string> = {}
    for (const file of gathered.files) {
      if (fs.existsSync(file.path)) {
        fileHashes[file.path] = this.hashFile(file.path)
      }
    }

    const payload: CachedContextRecord = {
      prompt,
      gathered,
      fileHashes,
    }
    fs.writeFileSync(this.cacheFile(prompt), JSON.stringify(payload, null, 2))
    this.evictIfNeeded()
  }

  private cacheFile(prompt: string): string {
    const key = crypto.createHash('sha256').update(prompt.trim()).digest('hex')
    return path.join(this.baseDir, `${key}.json`)
  }

  private hashFile(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath, 'utf8')).digest('hex')
  }

  private evictIfNeeded(): void {
    const entries = this.listEntries()

    while (entries.length > this.options.maxEntries) {
      const evicted = entries.shift()
      if (!evicted) break
      fs.rmSync(evicted.path, { force: true })
    }

    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
    while (entries.length > 1 && totalBytes > this.options.maxBytes) {
      const evicted = entries.shift()
      if (!evicted) break
      fs.rmSync(evicted.path, { force: true })
      totalBytes -= evicted.size
    }
  }

  private listEntries(): Array<{ path: string; size: number; mtimeMs: number }> {
    if (!fs.existsSync(this.baseDir)) return []

    return fs.readdirSync(this.baseDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const entryPath = path.join(this.baseDir, file)
        const stat = fs.statSync(entryPath)
        return {
          path: entryPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        }
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path))
  }
}
