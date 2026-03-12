import { describe, it, expect, vi } from 'vitest'
import { ToolExecutor } from './executor'
import { ToolRegistry } from './registry'
import { SafetyGate } from './safety-gate'
import type { ToolDefinition } from './registry'

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'file path' } },
      required: ['path'],
    },
    handler: vi.fn(async () => ({ success: true, output: 'ok' })),
    category: 'read',
    ...overrides,
  }
}

function makeExecutor(tools: ToolDefinition[] = []) {
  const registry = new ToolRegistry()
  for (const tool of tools) registry.register(tool)
  const gate = new SafetyGate({
    always_confirm: [],
    auto_approve: ['test_tool', 'tool_a', 'tool_b'],
    allowed_write_paths: ['.'],
  })
  return new ToolExecutor(registry, gate)
}

describe('ToolExecutor', () => {
  describe('execute', () => {
    it('dispatches to the correct handler and returns result', async () => {
      const tool = makeTool()
      const executor = makeExecutor([tool])
      const result = await executor.execute({ tool: 'test_tool', args: { path: '/foo' } })
      expect(result.success).toBe(true)
      expect(result.output).toBe('ok')
      expect(tool.handler).toHaveBeenCalledWith({ path: '/foo' })
    })

    it('returns failure for unknown tool', async () => {
      const executor = makeExecutor()
      const result = await executor.execute({ tool: 'nonexistent', args: {} })
      expect(result.success).toBe(false)
      expect(result.error).toContain('unknown tool')
    })

    it('returns failure when required args are missing', async () => {
      const executor = makeExecutor([makeTool()])
      const result = await executor.execute({ tool: 'test_tool', args: {} })
      expect(result.success).toBe(false)
      expect(result.error).toContain('path')
    })

    it('returns failure when safety gate blocks write path', async () => {
      const writeTool = makeTool({
        name: 'write_file',
        category: 'write',
      })
      const registry = new ToolRegistry()
      registry.register(writeTool)
      const gate = new SafetyGate({
        always_confirm: [],
        auto_approve: [],
        allowed_write_paths: ['src'],
      })
      const executor = new ToolExecutor(registry, gate)
      const result = await executor.execute({
        tool: 'write_file',
        args: { path: '/etc/passwd' },
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('outside allowed')
    })

    it('catches handler errors and returns failure', async () => {
      const tool = makeTool({
        handler: async () => { throw new Error('boom') },
      })
      const executor = makeExecutor([tool])
      const result = await executor.execute({ tool: 'test_tool', args: { path: '/foo' } })
      expect(result.success).toBe(false)
      expect(result.error).toContain('boom')
    })
  })

  describe('executeParallel', () => {
    it('runs multiple tool calls concurrently', async () => {
      const toolA = makeTool({ name: 'tool_a', handler: async () => ({ success: true, output: 'a' }) })
      const toolB = makeTool({ name: 'tool_b', handler: async () => ({ success: true, output: 'b' }) })
      const executor = makeExecutor([toolA, toolB])

      const results = await executor.executeParallel([
        { tool: 'tool_a', args: { path: '1' } },
        { tool: 'tool_b', args: { path: '2' } },
      ])

      expect(results).toHaveLength(2)
      expect(results[0].output).toBe('a')
      expect(results[1].output).toBe('b')
    })

    it('returns individual failures without blocking others', async () => {
      const toolA = makeTool({ name: 'tool_a', handler: async () => ({ success: true, output: 'a' }) })
      const toolB = makeTool({ name: 'tool_b', handler: async () => { throw new Error('fail') } })
      const executor = makeExecutor([toolA, toolB])

      const results = await executor.executeParallel([
        { tool: 'tool_a', args: { path: '1' } },
        { tool: 'tool_b', args: { path: '2' } },
      ])

      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
    })
  })
})
