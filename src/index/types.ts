export type SymbolType = 'function' | 'class' | 'method' | 'variable' | 'type' | 'interface' | 'enum'

export interface FileEntry {
  path: string
  language: string
  size: number
  hash: string
  lastIndexed: number
}

export interface SymbolEntry {
  name: string
  type: SymbolType
  file: string
  lineStart: number
  lineEnd: number
  signature?: string
  exported: boolean
}

export interface IndexStats {
  files: number
  symbols: number
  buildTimeMs: number
}

export interface IndexConfig {
  root: string
  ignore: string[]
  languages: string[]
  storage_dir: string
  auto_update: boolean
}

export interface IncrementalUpdateResult {
  added: string[]
  removed: string[]
  changed: string[]
}
