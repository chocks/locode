import fs from 'fs'
import path from 'path'
import type { SymbolEntry, SymbolType } from './types'

export interface SymbolExtractor {
  extract(file: string, content: string, language: string): SymbolEntry[]
}

export class RegexSymbolExtractor implements SymbolExtractor {
  extract(file: string, content: string, language: string): SymbolEntry[] {
    if (language === 'typescript' || language === 'javascript') {
      return this.extractTsJs(file, content)
    }
    if (language === 'python') {
      return this.extractPython(file, content)
    }
    return []
  }

  private extractTsJs(file: string, content: string): SymbolEntry[] {
    const symbols: SymbolEntry[] = []
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNum = i + 1
      if (this.isComment(line)) continue

      this.matchExportedFunction(file, line, lineNum, symbols)
      this.matchFunction(file, line, lineNum, symbols)
      this.matchArrowConst(file, line, lineNum, symbols)
      this.matchClass(file, line, lineNum, symbols)
      this.matchMethod(file, line, lineNum, symbols)
      this.matchInterface(file, line, lineNum, symbols)
      this.matchType(file, line, lineNum, symbols)
      this.matchEnum(file, line, lineNum, symbols)
      this.matchCommonJSExport(file, line, lineNum, symbols)
    }

    return symbols
  }

  private matchExportedFunction(
    file: string, line: string, lineNum: number, symbols: SymbolEntry[],
  ): void {
    const m = line.match(/^export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/)
    if (m) {
      symbols.push({
        name: m[1], type: 'function', file, lineStart: lineNum,
        lineEnd: lineNum,
        signature: `function ${m[1]}(${m[2]})`, exported: true,
      })
    }
  }

  private matchFunction(
    file: string, line: string, lineNum: number, symbols: SymbolEntry[],
  ): void {
    const m = line.match(/^(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/)
    if (m && !line.startsWith('export')) {
      symbols.push({
        name: m[1], type: 'function', file, lineStart: lineNum,
        lineEnd: lineNum,
        signature: `function ${m[1]}(${m[2]})`, exported: false,
      })
    }
  }

  private matchArrowConst(
    file: string, line: string, lineNum: number, symbols: SymbolEntry[],
  ): void {
    const m = line.match(/^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/)
    if (m) {
      symbols.push({
        name: m[1], type: 'function', file, lineStart: lineNum, lineEnd: lineNum,
        signature: `const ${m[1]} = (${m[2]}) =>`, exported: true,
      })
    }
  }

  private matchClass(
    file: string, line: string, lineNum: number, symbols: SymbolEntry[],
  ): void {
    const m = line.match(/^(export\s+)?(?:abstract\s+)?class\s+(\w+)/)
    if (m) {
      symbols.push({
        name: m[2], type: 'class', file, lineStart: lineNum, lineEnd: lineNum,
        exported: !!m[1],
      })
    }
  }

  private matchMethod(
    file: string, line: string, lineNum: number, symbols: SymbolEntry[],
  ): void {
    const m = line.match(/^\s*(?:public|private|protected|static|async|readonly|\s)*(\w+)\s*\(([^)]*)\)\s*[:{]/)
    if (m && !line.includes('function') && !line.startsWith('export')) {
      const name = m[1]
      if (['if', 'for', 'while', 'switch', 'catch', 'return', 'throw'].includes(name)) return
      symbols.push({
        name, type: 'method', file, lineStart: lineNum, lineEnd: lineNum,
        signature: `${name}(${m[2]})`, exported: false,
      })
    }
  }

  private matchInterface(
    file: string, line: string, lineNum: number, symbols: SymbolEntry[],
  ): void {
    const m = line.match(/^(export\s+)?interface\s+(\w+)/)
    if (m) {
      symbols.push({
        name: m[2], type: 'interface', file, lineStart: lineNum, lineEnd: lineNum,
        exported: !!m[1],
      })
    }
  }

  private matchType(
    file: string, line: string, lineNum: number, symbols: SymbolEntry[],
  ): void {
    const m = line.match(/^(export\s+)?type\s+(\w+)\s*=/)
    if (m) {
      symbols.push({
        name: m[2], type: 'type', file, lineStart: lineNum, lineEnd: lineNum,
        exported: !!m[1],
      })
    }
  }

  private matchEnum(
    file: string, line: string, lineNum: number, symbols: SymbolEntry[],
  ): void {
    const m = line.match(/^(export\s+)?enum\s+(\w+)/)
    if (m) {
      symbols.push({
        name: m[2], type: 'enum', file, lineStart: lineNum, lineEnd: lineNum,
        exported: !!m[1],
      })
    }
  }

  private matchCommonJSExport(
    file: string, line: string, lineNum: number, symbols: SymbolEntry[],
  ): void {
    const m = line.match(/^module\.exports\s*=\s*function\s+(\w+)/)
    if (m) {
      symbols.push({
        name: m[1], type: 'function', file, lineStart: lineNum, lineEnd: lineNum,
        exported: true,
      })
    }
  }

  private extractPython(file: string, content: string): SymbolEntry[] {
    const symbols: SymbolEntry[] = []
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNum = i + 1
      if (line.trim().startsWith('#')) continue

      const fnMatch = line.match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/)
      if (fnMatch) {
        const isMethod = this.isInsideClass(symbols, lineNum)
        symbols.push({
          name: fnMatch[1], type: isMethod ? 'method' : 'function', file,
          lineStart: lineNum, lineEnd: lineNum,
          signature: `def ${fnMatch[1]}(${fnMatch[2]})`, exported: !isMethod,
        })
        continue
      }

      const classMatch = line.match(/^class\s+(\w+)/)
      if (classMatch) {
        symbols.push({
          name: classMatch[1], type: 'class', file, lineStart: lineNum, lineEnd: lineNum,
          exported: true,
        })
      }
    }

    return symbols
  }

  private isInsideClass(symbols: SymbolEntry[], lineNum: number): boolean {
    for (let i = symbols.length - 1; i >= 0; i--) {
      if (symbols[i].type === 'class' && symbols[i].lineStart < lineNum) {
        return true
      }
    }
    return false
  }

  private isComment(line: string): boolean {
    const trimmed = line.trim()
    return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
  }
}

export class SymbolIndex {
  private symbols: SymbolEntry[] = []
  private byFile: Map<string, SymbolEntry[]> = new Map()
  private languages: Set<string> | null = null
  private extractor: SymbolExtractor

  constructor(languages?: string[], extractor?: SymbolExtractor) {
    if (languages) {
      this.languages = new Set(languages)
    }
    this.extractor = extractor ?? new RegexSymbolExtractor()
  }

  async indexFile(filePath: string, content: string, language: string): Promise<SymbolEntry[]> {
    if (this.languages && !this.languages.has(language)) {
      return []
    }
    this.removeFile(filePath)
    const extracted = this.extractor.extract(filePath, content, language)
    this.symbols.push(...extracted)
    this.byFile.set(filePath, extracted)
    return extracted
  }

  search(query: string, opts?: { type?: SymbolType; file?: string }): SymbolEntry[] {
    const lower = query.toLowerCase()
    return this.symbols.filter(s => {
      if (opts?.type && s.type !== opts.type) return false
      if (opts?.file && s.file !== opts.file) return false
      return s.name.toLowerCase().includes(lower)
    })
  }

  forFile(filePath: string): SymbolEntry[] {
    return this.byFile.get(filePath) ?? []
  }

  async getCode(symbol: SymbolEntry): Promise<string> {
    try {
      const content = fs.readFileSync(symbol.file, 'utf8')
      const lines = content.split('\n')
      const start = Math.max(0, symbol.lineStart - 1)
      const end = Math.min(lines.length, symbol.lineEnd)
      return lines.slice(start, end).join('\n')
    } catch {
      return ''
    }
  }

  removeFile(filePath: string): void {
    const existing = this.byFile.get(filePath)
    if (existing) {
      this.symbols = this.symbols.filter(s => s.file !== filePath)
      this.byFile.delete(filePath)
    }
  }

  all(): SymbolEntry[] {
    return [...this.symbols]
  }

  async save(dir: string): Promise<void> {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'symbols.json'), JSON.stringify(this.symbols, null, 2), 'utf8')
  }

  async load(dir: string): Promise<void> {
    const file = path.join(dir, 'symbols.json')
    const data = fs.readFileSync(file, 'utf8')
    const entries: SymbolEntry[] = JSON.parse(data)
    this.symbols = entries
    this.byFile.clear()
    for (const entry of entries) {
      const list = this.byFile.get(entry.file) ?? []
      list.push(entry)
      this.byFile.set(entry.file, list)
    }
  }
}
