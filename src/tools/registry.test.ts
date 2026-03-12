import { describe, it, expect } from 'vitest'
import { ToolRegistry } from './registry'
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
    handler: async () => ({ success: true, output: 'ok' }),
    category: 'read',
    ...overrides,
  }
}

describe('ToolRegistry', () => {
  describe('register + get', () => {
    it('registers and retrieves a tool by name', () => {
      const registry = new ToolRegistry()
      const tool = makeTool()
      registry.register(tool)
      expect(registry.get('test_tool')).toBe(tool)
    })

    it('returns undefined for unknown tool', () => {
      const registry = new ToolRegistry()
      expect(registry.get('nonexistent')).toBeUndefined()
    })

    it('throws on duplicate registration', () => {
      const registry = new ToolRegistry()
      registry.register(makeTool())
      expect(() => registry.register(makeTool())).toThrow(/already registered/)
    })
  })

  describe('list', () => {
    it('returns all registered tools', () => {
      const registry = new ToolRegistry()
      registry.register(makeTool({ name: 'a' }))
      registry.register(makeTool({ name: 'b' }))
      const tools = registry.list()
      expect(tools).toHaveLength(2)
      expect(tools.map(t => t.name)).toEqual(['a', 'b'])
    })

    it('returns empty array when no tools registered', () => {
      const registry = new ToolRegistry()
      expect(registry.list()).toEqual([])
    })
  })

  describe('listForLLM (Ollama format)', () => {
    it('converts tools to Ollama function-call schema', () => {
      const registry = new ToolRegistry()
      registry.register(makeTool({ name: 'read_file' }))
      const schemas = registry.listForLLM()
      expect(schemas).toHaveLength(1)
      expect(schemas[0]).toEqual({
        type: 'function',
        function: {
          name: 'read_file',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: 'file path' } },
            required: ['path'],
          },
        },
      })
    })
  })

  describe('listForClaude (Anthropic format)', () => {
    it('converts tools to Anthropic tool schema', () => {
      const registry = new ToolRegistry()
      registry.register(makeTool({ name: 'read_file' }))
      const schemas = registry.listForClaude()
      expect(schemas).toHaveLength(1)
      expect(schemas[0]).toEqual({
        name: 'read_file',
        description: 'A test tool',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'file path' } },
          required: ['path'],
        },
      })
    })
  })

  describe('validate', () => {
    it('passes when all required args are present', () => {
      const registry = new ToolRegistry()
      registry.register(makeTool())
      const result = registry.validate('test_tool', { path: '/foo' })
      expect(result).toEqual({ valid: true, errors: [] })
    })

    it('fails when a required arg is missing', () => {
      const registry = new ToolRegistry()
      registry.register(makeTool())
      const result = registry.validate('test_tool', {})
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("missing required field: 'path'")
    })

    it('fails for unknown tool', () => {
      const registry = new ToolRegistry()
      const result = registry.validate('nonexistent', {})
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toMatch(/unknown tool/)
    })

    it('passes with no required fields', () => {
      const registry = new ToolRegistry()
      registry.register(makeTool({
        inputSchema: {
          type: 'object',
          properties: { verbose: { type: 'boolean' } },
        },
      }))
      const result = registry.validate('test_tool', {})
      expect(result).toEqual({ valid: true, errors: [] })
    })
  })
})
