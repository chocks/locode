import type { GatheredContext, MemorySnapshot } from '../coding/types'

export type { MemorySnapshot }
export type ContextSource =
  | 'mentioned-path'
  | 'recent-files'
  | 'symbol-index'
  | 'test-discovery'
  | 'sibling-file'
  | 'dependency'
  | 'semantic-search'
  | 'git-context'

export type BudgetPriority =
  | 'direct_match'
  | 'symbol_match'
  | 'semantic_match'
  | 'dependency'
  | 'git_context'

export interface RetrievedContext extends GatheredContext {
  confidence: number
  strategyUsed: ContextSource[]
}

export interface BudgetedFile {
  path: string
  content: string
  tokensUsed: number
  truncated: boolean
}

export interface RetrievalConfig {
  max_files: number
  max_tokens_per_file: number
  max_total_tokens: number
  strategy: 'deterministic-first' | 'semantic-first'
  confidence_threshold: number
}
