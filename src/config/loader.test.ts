import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, getDefaultConfigPath } from './loader'
import path from 'path'
import os from 'os'

describe('loadConfig', () => {
  it('loads and validates config from yaml file', () => {
    const config = loadConfig(path.join(__dirname, '../../locode.yaml'))
    expect(config.local_llm.model).toBe('qwen2.5-coder:7b')
    expect(config.routing.rules).toHaveLength(4)
    expect(config.routing.escalation_threshold).toBe(0.7)
  })

  it('throws on invalid config', () => {
    expect(() => loadConfig('/nonexistent/path.yaml')).toThrow()
  })
})

describe('getDefaultConfigPath', () => {
  let savedEnv: string | undefined

  beforeEach(() => {
    savedEnv = process.env.LOCODE_CONFIG
    delete process.env.LOCODE_CONFIG
  })

  afterEach(() => {
    if (savedEnv !== undefined) process.env.LOCODE_CONFIG = savedEnv
    else delete process.env.LOCODE_CONFIG
  })

  it('returns ~/.locode/locode.yaml by default', () => {
    expect(getDefaultConfigPath()).toBe(path.join(os.homedir(), '.locode', 'locode.yaml'))
  })

  it('returns LOCODE_CONFIG env var when set', () => {
    process.env.LOCODE_CONFIG = '/custom/path/locode.yaml'
    expect(getDefaultConfigPath()).toBe('/custom/path/locode.yaml')
  })
})
