import fs from 'fs'
import path from 'path'
import type { CodebaseIndexer } from '../index/indexer'
import type { RetrievalConfig, RetrievedContext, ContextSource, BudgetPriority, MemorySnapshot, BudgetedFile } from './types'
import type { GatheredContext } from '../coding/types'
import { BudgetManager } from './budget-manager'

const FILE_EXTENSION_PATTERN = /\b([\w./-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|json|yaml|yml|md|css|html|sh))\b/g

export interface ContextRetrieverOptions {
  root: string
  memory: MemorySnapshot
}

interface CandidateFile {
  path: string
  content: string
  sources: ContextSource[]
  priority: BudgetPriority
}

export class ContextRetriever {
  constructor(
    private indexer: CodebaseIndexer,
    private config: RetrievalConfig,
    private opts: ContextRetrieverOptions,
  ) {}

  async retrieve(query: string): Promise<RetrievedContext> {
    const strategiesUsed: ContextSource[] = []
    const candidates: Map<string, CandidateFile> = new Map()

    const addCandidate = (file: string, source: ContextSource, priority: BudgetPriority, content?: string) => {
      const existing = candidates.get(file)
      if (existing) {
        if (!existing.sources.includes(source)) {
          existing.sources.push(source)
        }
        existing.priority = this.higherPriority(existing.priority, priority)
        if (!existing.content && content) {
          existing.content = content
        }
      } else {
        candidates.set(file, {
          path: file,
          content: content ?? '',
          sources: [source],
          priority,
        })
      }
    }

    const mentionedFiles = this.extractMentionedFiles(query)
    for (const file of mentionedFiles) {
      const content = this.readFileContent(file)
      if (content !== null) {
        addCandidate(file, 'mentioned-path', 'direct_match', content)
        if (!strategiesUsed.includes('mentioned-path')) {
          strategiesUsed.push('mentioned-path')
        }
      }
    }

    for (const file of mentionedFiles) {
      for (const testFile of this.findSiblingTests(file)) {
        const content = this.readFileContent(testFile)
        if (content !== null) {
          addCandidate(testFile, 'test-discovery', 'symbol_match', content)
          if (!strategiesUsed.includes('test-discovery')) {
            strategiesUsed.push('test-discovery')
          }
        }
      }
    }

    const symbolResults = this.searchSymbols(query)
    for (const result of symbolResults) {
      const content = this.readFileContent(result.file)
      if (content !== null) {
        addCandidate(result.file, 'symbol-index', 'symbol_match', content)
        if (!strategiesUsed.includes('symbol-index')) {
          strategiesUsed.push('symbol-index')
        }
      }
    }

    for (const file of this.opts.memory.recentFiles) {
      if (candidates.has(file)) continue
      const content = this.readFileContent(file)
      if (content !== null) {
        addCandidate(file, 'recent-files', 'dependency', content)
        if (!strategiesUsed.includes('recent-files')) {
          strategiesUsed.push('recent-files')
        }
      }
    }

    const candidateList = [...candidates.values()]
    if (candidateList.length === 0) {
      return {
        files: [],
        searchResults: [],
        memory: this.opts.memory,
        confidence: 0,
        strategyUsed: strategiesUsed,
      }
    }

    const budgetMgr = new BudgetManager(this.config.max_total_tokens, {
      maxPerFile: this.config.max_tokens_per_file,
      maxFiles: this.config.max_files,
    })

    const budgeted = budgetMgr.allocate(
      candidateList.map(c => ({ path: c.path, content: c.content, priority: c.priority })),
    )

    const files: GatheredContext['files'] = budgeted
      .filter((f): f is BudgetedFile => f.tokensUsed > 0)
      .map(f => {
        const candidate = candidates.get(f.path)!
        return {
          path: f.path,
          content: f.content,
          relevance: candidate.sources.join(', '),
        }
      })

    const searchResults = symbolResults.map(s => ({
      file: s.file,
      line: s.lineStart,
      match: s.signature ?? s.name,
    }))

    const confidence = this.computeConfidence(candidateList, mentionedFiles, symbolResults)

    return {
      files,
      searchResults,
      memory: this.opts.memory,
      confidence,
      strategyUsed: strategiesUsed,
    }
  }

  private extractMentionedFiles(query: string): string[] {
    const files: string[] = []
    let match
    FILE_EXTENSION_PATTERN.lastIndex = 0
    while ((match = FILE_EXTENSION_PATTERN.exec(query)) !== null) {
      const candidate = match[1]
      const resolved = this.resolveFilePath(candidate)
      if (resolved && !files.includes(resolved)) {
        files.push(resolved)
      }
    }
    return files
  }

  private resolveFilePath(candidate: string): string | null {
    if (this.fileExists(candidate)) {
      return candidate
    }
    const exactMatches = this.indexer.files.find(candidate)
    if (exactMatches.length > 0) {
      return exactMatches[0].path
    }
    const basename = path.basename(candidate)
    const matches = this.indexer.files.all().filter(e => path.basename(e.path) === basename)
    if (matches.length === 1) {
      return matches[0].path
    }
    if (matches.length > 1) {
      const ext = path.extname(candidate)
      const baseWithoutExt = path.basename(candidate, ext)
      const dirMatch = matches.find(m =>
        path.dirname(m.path).endsWith(path.dirname(candidate)) ||
        path.basename(m.path, ext) === baseWithoutExt,
      )
      if (dirMatch) return dirMatch.path
      return matches[0].path
    }
    return null
  }

  private searchSymbols(query: string): Array<{ file: string; lineStart: number; name: string; signature?: string }> {
    const tokens = this.extractSymbolTokens(query)
    const results: Array<{ file: string; lineStart: number; name: string; signature?: string }> = []
    const seen = new Set<string>()

    for (const token of tokens) {
      const symbols = this.indexer.symbols.search(token)
      for (const sym of symbols.slice(0, 5)) {
        const key = `${sym.file}:${sym.name}`
        if (!seen.has(key)) {
          seen.add(key)
          results.push({
            file: sym.file,
            lineStart: sym.lineStart,
            name: sym.name,
            signature: sym.signature,
          })
        }
      }
    }

    return results
  }

  private extractSymbolTokens(query: string): string[] {
    const words = query.match(/\b[a-z][a-zA-Z0-9_]+\b/g) ?? []
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'need', 'in', 'on', 'at',
      'to', 'for', 'of', 'with', 'by', 'from', 'as', 'and', 'or', 'not',
      'but', 'if', 'then', 'else', 'when', 'where', 'how', 'what', 'why',
      'who', 'this', 'that', 'these', 'those', 'it', 'its', 'fix', 'add',
      'update', 'change', 'modify', 'remove', 'delete', 'create', 'write',
      'read', 'get', 'set', 'put', 'show', 'find', 'look', 'see', 'check',
      'make', 'run', 'test', 'bug', 'error', 'issue', 'problem', 'work',
    ])
    return words
      .filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()))
      .slice(0, 10)
  }

  private findSiblingTests(filePath: string): string[] {
    const tests: string[] = []
    const ext = path.extname(filePath)
    const base = path.basename(filePath, ext)
    const dir = path.dirname(filePath)

    const testPatterns = [
      path.join(dir, `${base}.test${ext}`),
      path.join(dir, `${base}.spec${ext}`),
      path.join(dir, '__tests__', `${base}.test${ext}`),
      path.join(dir, `${base}_test${ext}`),
    ]

    for (const testPattern of testPatterns) {
      const resolved = this.resolveFilePath(testPattern)
      if (resolved) {
        tests.push(resolved)
      }
    }

    return tests
  }

  private readFileContent(relPath: string): string | null {
    if (this.fileExists(relPath)) {
      try {
        return fs.readFileSync(relPath, 'utf8')
      } catch {
        return null
      }
    }
    const fullPath = path.join(this.opts.root, relPath)
    try {
      return fs.readFileSync(fullPath, 'utf8')
    } catch {
      return null
    }
  }

  private fileExists(relPath: string): boolean {
    try {
      return fs.statSync(relPath).isFile()
    } catch {
      return false
    }
  }

  private higherPriority(a: BudgetPriority, b: BudgetPriority): BudgetPriority {
    const weights: Record<BudgetPriority, number> = {
      direct_match: 5,
      symbol_match: 4,
      semantic_match: 3,
      dependency: 2,
      git_context: 1,
    }
    return weights[a] >= weights[b] ? a : b
  }

  private computeConfidence(
    candidates: CandidateFile[],
    mentionedFiles: string[],
    symbolResults: Array<{ file: string; name: string }>,
  ): number {
    if (candidates.length === 0) return 0

    let confidence = 0
    if (mentionedFiles.length > 0) confidence = Math.max(confidence, 0.7)
    if (symbolResults.length > 0) confidence = Math.max(confidence, 0.5)
    if (candidates.some(c => c.sources.includes('test-discovery'))) confidence = Math.max(confidence, 0.6)
    if (candidates.some(c => c.sources.includes('recent-files'))) confidence = Math.max(confidence, 0.3)
    if (candidates.length >= 3) confidence = Math.min(1, confidence + 0.1)

    return confidence
  }
}
