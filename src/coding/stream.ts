import { EventEmitter } from 'events'
import type { AgentPhase, EditPlan, AgentRunResult } from './types'
import { DiffRenderer } from '../editor/diff-renderer'

const BOLD = '\x1b[1m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BLUE = '\x1b[34m'
const GRAY = '\x1b[90m'
const RESET = '\x1b[0m'

export type StreamEvent =
  | { type: 'phase'; phase: AgentPhase; detail: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; success: boolean; summary: string }
  | { type: 'plan'; plan: EditPlan }
  | { type: 'diff'; file: string; diff: string }
  | { type: 'validation'; passed: boolean; output: string }
  | { type: 'error'; message: string }
  | { type: 'done'; result: AgentRunResult }

export class AgentStream extends EventEmitter {
  emit(event: 'stream', data: StreamEvent): boolean {
    return super.emit(event, data)
  }

  on(event: 'stream', handler: (data: StreamEvent) => void): this {
    return super.on(event, handler)
  }
}

export class StreamRenderer {
  private active = false

  constructor(private stream: EventEmitter) {}

  start(): void {
    this.active = true
    this.stream.on('stream', this.handleEvent)
  }

  stop(): void {
    this.active = false
    this.stream.removeListener('stream', this.handleEvent)
  }

  private handleEvent = (event: StreamEvent): void => {
    if (!this.active) return

    switch (event.type) {
      case 'phase':
        console.log(`${BOLD}${BLUE}\n[${event.phase.toUpperCase()}] ${event.detail}${RESET}`)
        break

      case 'tool_call':
        console.log(`${GRAY}  → ${event.tool}(${Object.values(event.args).join(', ')})${RESET}`)
        break

      case 'tool_result':
        console.log(`${GRAY}  ${event.success ? '✓' : '✗'} ${event.summary.slice(0, 100)}${RESET}`)
        break

      case 'plan':
        console.log(`${YELLOW}\n─── Edit Plan: ${event.plan.description} ───${RESET}`)
        for (const step of event.plan.steps) {
          console.log(`${GRAY}  ${step.operation} ${step.file}: ${step.description}${RESET}`)
        }
        break

      case 'diff':
        console.log(DiffRenderer.colorize(event.diff))
        break

      case 'validation':
        if (event.passed) {
          console.log(`${GREEN}✓ Validation passed${RESET}`)
        } else {
          console.log(`${RED}✗ Validation failed${RESET}`)
          console.log(`${GRAY}${event.output.slice(0, 500)}${RESET}`)
        }
        break

      case 'error':
        console.log(`${RED}Error: ${event.message}${RESET}`)
        break

      case 'done':
        if (event.result.success) {
          console.log(`${GREEN}\n✓ ${event.result.edits.length} edits applied in ${event.result.iterations} iteration(s)${RESET}`)
        }
        break
    }
  }
}
