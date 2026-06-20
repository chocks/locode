import fs from 'fs'
import path from 'path'
import { FileIndex } from './file-index'
import { SymbolIndex } from './symbol-index'
import type { IndexConfig, IndexStats, IncrementalUpdateResult } from './types'

export class CodebaseIndexer {
  private fileIndex: FileIndex
  private symbolIndex: SymbolIndex
  private indexed = false

  constructor(private config: IndexConfig) {
    this.fileIndex = new FileIndex()
    this.symbolIndex = new SymbolIndex(config.languages)
  }

  async buildAll(): Promise<IndexStats> {
    const start = Date.now()
    await this.fileIndex.build(this.config)

    this.symbolIndex = new SymbolIndex(this.config.languages)
    for (const entry of this.fileIndex.all()) {
      if (!this.config.languages.includes(entry.language)) continue
      const fullPath = path.join(this.config.root, entry.path)
      try {
        const content = fs.readFileSync(fullPath, 'utf8')
        await this.symbolIndex.indexFile(entry.path, content, entry.language)
      } catch {
        // file may have been deleted between scan and read
      }
    }

    this.indexed = true
    return {
      files: this.fileIndex.all().length,
      symbols: this.symbolIndex.all().length,
      buildTimeMs: Date.now() - start,
    }
  }

  async update(): Promise<IndexStats> {
    if (!this.indexed) {
      throw new Error('CodebaseIndexer.update() called before buildAll()')
    }
    const start = Date.now()
    const changes: IncrementalUpdateResult = await this.fileIndex.update()

    for (const relPath of changes.removed) {
      this.symbolIndex.removeFile(relPath)
    }

    for (const relPath of [...changes.added, ...changes.changed]) {
      const entry = this.fileIndex.find(relPath)[0]
      if (!entry || !this.config.languages.includes(entry.language)) continue
      const fullPath = path.join(this.config.root, relPath)
      try {
        const content = fs.readFileSync(fullPath, 'utf8')
        await this.symbolIndex.indexFile(relPath, content, entry.language)
      } catch {
        // file may have been deleted between scan and read
      }
    }

    return {
      files: this.fileIndex.all().length,
      symbols: this.symbolIndex.all().length,
      buildTimeMs: Date.now() - start,
    }
  }

  isIndexed(): boolean {
    return this.indexed
  }

  get files(): FileIndex {
    return this.fileIndex
  }

  get symbols(): SymbolIndex {
    return this.symbolIndex
  }

  async save(): Promise<void> {
    await this.fileIndex.save(this.config.storage_dir)
    await this.symbolIndex.save(this.config.storage_dir)
  }

  async load(): Promise<void> {
    await this.fileIndex.load(this.config.storage_dir)
    await this.symbolIndex.load(this.config.storage_dir)
    this.indexed = true
  }
}
