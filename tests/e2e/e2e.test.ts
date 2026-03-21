import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  startOllamaStub,
  stopOllamaStub,
  getOllamaRequests,
  clearOllamaRequests,
  startAnthropicStub,
  stopAnthropicStub,
  getAnthropicRequests,
  clearAnthropicRequests,
  runLocode,
} from './harness'

describe('E2E routing', () => {
  beforeAll(async () => {
    await startOllamaStub(9781)
    await startAnthropicStub(9782)
  })

  afterAll(async () => {
    await stopOllamaStub()
    await stopAnthropicStub()
  })

  beforeEach(() => {
    clearOllamaRequests()
    clearAnthropicRequests()
  })

  it('routes a simple prompt to local LLM', async () => {
    const result = await runLocode('grep for TODO comments in src/')

    expect(getOllamaRequests().length).toBeGreaterThanOrEqual(1)
    expect(getAnthropicRequests()).toHaveLength(0)
    expect(result.stdout).toContain('Local LLM response')
  })

  it('routes a complex prompt to Claude', async () => {
    const result = await runLocode('refactor the auth module to use dependency injection')

    expect(getAnthropicRequests()).toHaveLength(1)
    expect(getOllamaRequests()).toHaveLength(0)
    expect(result.stdout).toContain('Claude response')
  })

  it('local agent executes tool calls and returns result', async () => {
    // "read file" matches "read" routing rule → local, and triggers tool-call mode in stub
    const result = await runLocode('read file contents of package.json')

    // Should have 2+ Ollama requests: first returns tool_call, second returns final answer
    expect(getOllamaRequests().length).toBeGreaterThanOrEqual(2)
    expect(getAnthropicRequests()).toHaveLength(0)
    expect(result.stdout).toContain('file contents received and analyzed')
  })

  it('Claude agent executes tool calls and returns result', async () => {
    // "explain bug" matches "bug" routing rule → claude, and triggers tool-call mode in stub
    const result = await runLocode('explain the bug in package.json and debug it')

    // Should have 2 Anthropic requests: first returns tool_use, second returns final text
    expect(getAnthropicRequests().length).toBe(2)
    expect(getOllamaRequests()).toHaveLength(0)
    expect(result.stdout).toContain('file analyzed successfully')
  })

  it('falls back to local when API key is missing', async () => {
    // Override HOME to prevent loadEnvFile() from loading ~/.locode/.env
    // which would set ANTHROPIC_API_KEY from the user's real config
    const result = await runLocode(
      'refactor the auth module to use dependency injection',
      { ANTHROPIC_API_KEY: '', HOME: '/tmp/locode-e2e-nonexistent' },
    )

    expect(getOllamaRequests().length).toBeGreaterThanOrEqual(1)
    expect(getAnthropicRequests()).toHaveLength(0)
    expect(result.stdout).toContain('Local LLM response')
  })
})
