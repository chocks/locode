import type { AgentPhase, AgentRunResult, EditPlan } from './types'

export type StreamEvent =
  | { type: 'phase'; phase: AgentPhase; detail: string }
  | { type: 'plan'; plan: EditPlan }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'diff'; file: string; diff: string }
  | { type: 'validation'; passed: boolean; output: string }
  | { type: 'error'; message: string }
  | { type: 'done'; result: AgentRunResult }
