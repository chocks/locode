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
