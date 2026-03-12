import { ToolRegistry } from './registry'
import { SafetyGate } from './safety-gate'
import type { ToolResult } from './registry'

export interface ToolCall {
  tool: string
  args: Record<string, unknown>
  reason?: string
}

export class ToolExecutor {
  readonly registry: ToolRegistry

  constructor(
    registry: ToolRegistry,
    private safetyGate: SafetyGate,
  ) {
    this.registry = registry
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    // 1. Look up tool
    const tool = this.registry.get(call.tool)
    if (!tool) {
      return { success: false, output: '', error: `unknown tool: '${call.tool}'` }
    }

    // 2. Validate args
    const validation = this.registry.validate(call.tool, call.args)
    if (!validation.valid) {
      return { success: false, output: '', error: validation.errors.join('; ') }
    }

    // 3. Safety check — write path restriction for write-category tools
    if (tool.category === 'write' && call.args.path) {
      const pathCheck = this.safetyGate.checkWritePath(call.args.path as string)
      if (!pathCheck.allowed) {
        return { success: false, output: '', error: pathCheck.reason }
      }
    }

    // 4. Execute handler
    try {
      return await tool.handler(call.args)
    } catch (err) {
      return { success: false, output: '', error: (err as Error).message }
    }
  }

  async executeParallel(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map(call => this.execute(call)))
  }
}
