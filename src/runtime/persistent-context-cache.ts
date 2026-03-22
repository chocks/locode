import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { GatheredContext } from '../coding/types'

interface CachedContextRecord {
  prompt: string
  gathered: GatheredContext
  fileHashes: Record<string, string>
}

export class PersistentContextCache {
  constructor(private baseDir: string) {}

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
  }

  private cacheFile(prompt: string): string {
    const key = crypto.createHash('sha256').update(prompt.trim()).digest('hex')
    return path.join(this.baseDir, `${key}.json`)
  }

  private hashFile(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath, 'utf8')).digest('hex')
  }
}
