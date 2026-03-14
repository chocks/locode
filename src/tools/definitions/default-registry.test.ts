import { describe, it, expect } from 'vitest'
import { createDefaultRegistry } from './default-registry'

describe('createDefaultRegistry', () => {
  it('returns a registry with all built-in tools', () => {
    const registry = createDefaultRegistry()
    const tools = registry.list()
    const names = tools.map(t => t.name)

    expect(names).toContain('read_file')
    expect(names).toContain('run_command')
    expect(names).toContain('git_query')
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
    expect(names).toContain('list_files')
    expect(names).toContain('search_code')
    expect(tools).toHaveLength(7)
  })

  it('produces valid Ollama schemas for all tools', () => {
    const registry = createDefaultRegistry()
    const schemas = registry.listForLLM()

    for (const schema of schemas) {
      expect(schema.type).toBe('function')
      expect(schema.function.name).toBeTruthy()
      expect(schema.function.description).toBeTruthy()
      expect(schema.function.parameters).toBeDefined()
    }
  })

  it('produces valid Claude schemas for all tools', () => {
    const registry = createDefaultRegistry()
    const schemas = registry.listForClaude()

    for (const schema of schemas) {
      expect(schema.name).toBeTruthy()
      expect(schema.description).toBeTruthy()
      expect(schema.input_schema).toBeDefined()
    }
  })
})
