import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeAgent } from './claude'

const makeHeaders = (remaining: string | null, limit: string | null, reset: string | null) => ({
  get: (h: string) => {
    if (h === 'anthropic-ratelimit-tokens-remaining') return remaining
    if (h === 'anthropic-ratelimit-tokens-limit') return limit
    if (h === 'anthropic-ratelimit-tokens-reset') return reset
    return null
  },
})

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate }
  },
}))

function makeCreateResponse(text: string, inputTokens: number, outputTokens: number, headers = makeHeaders('50000', '100000', '2026-03-07T00:00:00.000Z')) {
  return {
    withResponse: vi.fn().mockResolvedValue({
      data: {
        content: [{ type: 'text', text }],
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      },
      response: { headers },
    }),
  }
}

describe('ClaudeAgent', () => {
  const config = { claude: { model: 'claude-sonnet-4-6', token_threshold: 0.99 } }

  beforeEach(() => {
    mockCreate.mockReturnValue(makeCreateResponse('Here is the refactored code.', 1500, 300))
  })

  it('returns content and token counts', async () => {
    const agent = new ClaudeAgent(config)
    const result = await agent.run('Refactor this function', 'previous context')
    expect(result.content).toContain('refactored')
    expect(result.inputTokens).toBe(1500)
    expect(result.outputTokens).toBe(300)
  })

  it('parses rate limit headers into rateLimitInfo', async () => {
    const agent = new ClaudeAgent(config)
    const result = await agent.run('Refactor this function')
    expect(result.rateLimitInfo).not.toBeNull()
    expect(result.rateLimitInfo!.tokensRemaining).toBe(50000)
    expect(result.rateLimitInfo!.tokensLimit).toBe(100000)
    expect(result.rateLimitInfo!.resetsAt).toBe(new Date('2026-03-07T00:00:00.000Z').getTime())
  })

  it('returns null rateLimitInfo when headers are absent', async () => {
    mockCreate.mockReturnValueOnce(makeCreateResponse('response', 100, 50, makeHeaders(null, null, null)))
    const agent = new ClaudeAgent(config)
    const result = await agent.run('prompt')
    expect(result.rateLimitInfo).toBeNull()
  })

  it('generateHandoffSummary returns a compact summary string', async () => {
    mockCreate.mockReturnValueOnce(makeCreateResponse('Key work: refactored auth module.', 50, 30))
    const agent = new ClaudeAgent(config)
    const summary = await agent.generateHandoffSummary('We were working on auth.')
    expect(typeof summary).toBe('string')
    expect(summary.length).toBeGreaterThan(0)
  })

  it('generateHandoffSummary falls back to truncated context on error', async () => {
    mockCreate.mockReturnValueOnce({ withResponse: vi.fn().mockRejectedValue(new Error('out of tokens')) })
    const agent = new ClaudeAgent(config)
    const summary = await agent.generateHandoffSummary('A'.repeat(1000))
    expect(summary.length).toBeLessThanOrEqual(500)
  })
})
