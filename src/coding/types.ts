import type { EditOperation } from '../editor/types'

export type AgentPhase = 'analyze' | 'plan' | 'execute' | 'validate' | 'present'

export interface EditValidationResult {
  passed: boolean
  output: string
  command: string
}

export interface EditPlan {
  description: string
  steps: EditStep[]
  estimatedFiles: string[]
}

export interface EditStep {
  description: string
  file: string
  operation: 'insert' | 'replace' | 'delete' | 'create'
  search?: string
  precondition?: {
    fileHash?: string
    mustContain?: string[]
  }
  reasoning: string
}

export interface GatheredContext {
  files: Array<{ path: string; content: string; relevance: string }>
  searchResults: Array<{ file: string; line: number; match: string }>
  gitContext?: string
  memory: MemorySnapshot
}

export interface MemorySnapshot {
  recentFiles: string[]
  recentEdits: EditOperation[]
  recentCommands: string[]
  recentErrors: string[]
  sessionStart: number
}

export interface AgentConfig {
  max_iterations: number
  auto_confirm: boolean
  show_plan: boolean
  run_validation: boolean
  validation_command?: string
}

export interface AgentRunResult {
  success: boolean
  edits: EditOperation[]
  diffs: string[]
  validationPassed: boolean | null
  iterations: number
  tokensUsed: { input: number; output: number }
  agent: 'local' | 'claude'
}

export interface AgentState {
  phase: AgentPhase
  prompt: string
  plan: EditPlan | null
  editsApplied: EditOperation[]
  validationResult: EditValidationResult | null
  iteration: number
  maxIterations: number
}
