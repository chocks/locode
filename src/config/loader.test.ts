import { describe, it, expect } from 'vitest'
import { loadConfig } from './loader'
import path from 'path'

describe('loadConfig', () => {
  it('loads and validates config from yaml file', () => {
    const config = loadConfig(path.join(__dirname, '../../locode.yaml'))
    expect(config.local_llm.model).toBe('qwen2.5-coder:7b')
    expect(config.routing.rules).toHaveLength(3)
    expect(config.routing.escalation_threshold).toBe(0.7)
  })

  it('throws on invalid config', () => {
    expect(() => loadConfig('/nonexistent/path.yaml')).toThrow()
  })
})
