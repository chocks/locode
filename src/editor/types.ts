export interface EditPrecondition {
  fileHash?: string
  mustContain?: string[]
}

export interface EditPatch {
  before: string
  after: string
}

export interface EditOperation {
  file: string
  operation: 'insert' | 'replace' | 'delete' | 'create' | 'patch'
  // Search-based addressing (preferred — LLMs are bad at line counting)
  search?: string
  // Minimal patch-style addressing for exact block replacement
  patch?: EditPatch
  // Line-based addressing (fallback)
  afterLine?: number
  startLine?: number
  endLine?: number
  content?: string
  precondition?: EditPrecondition
}

// Search field semantics per operation type:
//   insert:  insert `content` AFTER the line containing `search` match
//   replace: replace `search` match with `content`
//   delete:  delete the line(s) containing `search` match
//   create:  `search` is ignored (creates new file with `content`)
//
// If `search` matches multiple locations → error (must be unique).
// If both `search` and line fields are set → `search` takes precedence.

export interface ApplyResult {
  applied: EditOperation[]
  failed: Array<{ edit: EditOperation; error: string }>
  originals: Map<string, string | null>
}

export interface DiffPreview {
  file: string
  diff: string
  additions: number
  deletions: number
}
