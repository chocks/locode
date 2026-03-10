import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeAgent, friendlyClaudeError } from './claude'

vi.mock('../tools', () => ({
  readFileTool: vi.fn().mockResolvedValue('file contents here'),
  shellTool: vi.fn().mockResolvedValue('shell output here'),
  gitTool: vi.fn().mockResolvedValue('git output here'),
}))

import { readFileTool, gitTool } from '../tools'

// Minimal mock classes matching the Anthropic SDK error hierarchy
class MockAPIError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'APIError'
    this.status = status
  }
}

class MockConnectionError extends Error {
  readonly status = undefined
  constructor(message: string) {
    super(message)
    this.name = 'APIConnectionError'
  }
}

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
        stop_reason: 'end_turn',
      },
      response: { headers },
    }),
  }
}

function makeToolUseResponse(toolName: string, toolId: string, input: Record<string, string>, inputTokens: number, outputTokens: number, headers = makeHeaders('50000', '100000', '2026-03-07T00:00:00.000Z')) {
  return {
    withResponse: vi.fn().mockResolvedValue({
      data: {
        content: [{ type: 'tool_use', id: toolId, name: toolName, input }],
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        stop_reason: 'tool_use',
      },
      response: { headers },
    }),
  }
}

describe('ClaudeAgent', () => {
  const config = { claude: { model: 'test-model', token_threshold: 0.99 } }

  beforeEach(() => {
    mockCreate.mockReset()
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

  it('uses next midnight UTC as resetsAt when reset header is absent', async () => {
    mockCreate.mockReturnValueOnce(makeCreateResponse('response', 100, 50, makeHeaders('1000', '100000', null)))
    const agent = new ClaudeAgent(config)
    const result = await agent.run('prompt')
    expect(result.rateLimitInfo).not.toBeNull()
    expect(result.rateLimitInfo!.tokensRemaining).toBe(1000)
    // resetsAt should be midnight UTC — after now but within 24h
    const now = Date.now()
    expect(result.rateLimitInfo!.resetsAt).toBeGreaterThan(now)
    expect(result.rateLimitInfo!.resetsAt).toBeLessThanOrEqual(now + 24 * 60 * 60 * 1000)
  })

  it('passes repo context as system parameter when provided', async () => {
    const agent = new ClaudeAgent(config)
    await agent.run('hello', undefined, '--- CLAUDE.md ---\n# My Project')

    const createCall = mockCreate.mock.calls[0][0]
    expect(createCall.system).toContain('# My Project')
  })

  it('includes base system prompt when no repo context provided', async () => {
    const agent = new ClaudeAgent(config)
    await agent.run('hello')

    const createCall = mockCreate.mock.calls[0][0]
    expect(createCall.system).toBeDefined()
    expect(createCall.system).toContain('tool')
  })

  it('includes base system prompt alongside repo context', async () => {
    const agent = new ClaudeAgent(config)
    await agent.run('hello', undefined, '--- CLAUDE.md ---\n# My Project')

    const createCall = mockCreate.mock.calls[0][0]
    expect(createCall.system).toContain('# My Project')
    expect(createCall.system).toContain('tool')
  })

  it('passes tools to the API call', async () => {
    const agent = new ClaudeAgent(config)
    await agent.run('hello')

    const createCall = mockCreate.mock.calls[0][0]
    expect(createCall.tools).toBeDefined()
    expect(createCall.tools.length).toBe(3)
    const toolNames = createCall.tools.map((t: { name: string }) => t.name)
    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('shell')
    expect(toolNames).toContain('git')
  })

  it('executes tool calls and loops back to API', async () => {
    // First call: tool_use, second call: final text
    mockCreate
      .mockReturnValueOnce(makeToolUseResponse('read_file', 'toolu_1', { path: 'src/foo.ts' }, 500, 50))
      .mockReturnValueOnce(makeCreateResponse('Found the bug in foo.ts', 800, 200))

    const agent = new ClaudeAgent(config)
    const result = await agent.run('find the bug')

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(readFileTool).toHaveBeenCalledWith({ path: 'src/foo.ts' })
    expect(result.content).toContain('Found the bug')
  })

  it('accumulates tokens across tool rounds', async () => {
    mockCreate
      .mockReturnValueOnce(makeToolUseResponse('shell', 'toolu_1', { command: 'ls src' }, 500, 50))
      .mockReturnValueOnce(makeCreateResponse('Here are the files.', 800, 200))

    const agent = new ClaudeAgent(config)
    const result = await agent.run('list files')

    expect(result.inputTokens).toBe(500 + 800)
    expect(result.outputTokens).toBe(50 + 200)
  })

  it('respects max tool rounds and returns last response', async () => {
    // 5 tool calls then a final text (but max rounds should cap it)
    for (let i = 0; i < 10; i++) {
      mockCreate.mockReturnValueOnce(makeToolUseResponse('read_file', `toolu_${i}`, { path: 'f.ts' }, 100, 10))
    }
    mockCreate.mockReturnValueOnce(makeCreateResponse('gave up', 100, 10))

    const agent = new ClaudeAgent(config)
    const result = await agent.run('infinite loop')

    // Should stop before 10 rounds (max 5) + 1 final call without tools
    expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(7)
    expect(result.content).toBeDefined()
  })

  it('dispatches git tool calls correctly', async () => {
    mockCreate
      .mockReturnValueOnce(makeToolUseResponse('git', 'toolu_1', { args: 'log --oneline -5' }, 500, 50))
      .mockReturnValueOnce(makeCreateResponse('Recent commits show...', 800, 200))

    const agent = new ClaudeAgent(config)
    await agent.run('show recent commits')

    expect(gitTool).toHaveBeenCalledWith({ args: 'log --oneline -5' })
  })

  it('generateHandoffSummary falls back to truncated context on error', async () => {
    mockCreate.mockReturnValueOnce({ withResponse: vi.fn().mockRejectedValue(new Error('out of tokens')) })
    const agent = new ClaudeAgent(config)
    const summary = await agent.generateHandoffSummary('A'.repeat(1000))
    expect(summary.length).toBeLessThanOrEqual(500)
  })

  it('wraps AuthenticationError with a helpful message', async () => {
    const err = new MockAPIError(401, 'invalid x-api-key')
    mockCreate.mockReturnValueOnce({ withResponse: vi.fn().mockRejectedValue(err) })
    const agent = new ClaudeAgent(config)
    await expect(agent.run('hello')).rejects.toThrow(/ANTHROPIC_API_KEY/)
  })

  it('wraps RateLimitError with a helpful message', async () => {
    const err = new MockAPIError(429, 'rate limit exceeded')
    mockCreate.mockReturnValueOnce({ withResponse: vi.fn().mockRejectedValue(err) })
    const agent = new ClaudeAgent(config)
    await expect(agent.run('hello')).rejects.toThrow(/[Rr]ate.?limit/)
  })

  it('wraps server errors with status page link', async () => {
    const err = new MockAPIError(500, 'internal server error')
    mockCreate.mockReturnValueOnce({ withResponse: vi.fn().mockRejectedValue(err) })
    const agent = new ClaudeAgent(config)
    await expect(agent.run('hello')).rejects.toThrow(/status\.anthropic\.com/)
  })

  it('wraps connection errors with status page link', async () => {
    const err = new MockConnectionError('Connection error')
    mockCreate.mockReturnValueOnce({ withResponse: vi.fn().mockRejectedValue(err) })
    const agent = new ClaudeAgent(config)
    await expect(agent.run('hello')).rejects.toThrow(/status\.anthropic\.com/)
  })

  it('re-throws unknown errors unchanged', async () => {
    const err = new Error('something weird')
    mockCreate.mockReturnValueOnce({ withResponse: vi.fn().mockRejectedValue(err) })
    const agent = new ClaudeAgent(config)
    await expect(agent.run('hello')).rejects.toThrow('something weird')
  })
})

describe('friendlyClaudeError', () => {
  it('returns helpful message for 401', () => {
    const err = new MockAPIError(401, 'invalid x-api-key')
    const result = friendlyClaudeError(err)
    expect(result.message).toContain('ANTHROPIC_API_KEY')
  })

  it('returns helpful message for 429', () => {
    const err = new MockAPIError(429, 'rate limit exceeded')
    const result = friendlyClaudeError(err)
    expect(result.message).toMatch(/[Rr]ate.?limit/)
  })

  it('returns helpful message for 500+', () => {
    const err = new MockAPIError(529, 'overloaded')
    const result = friendlyClaudeError(err)
    expect(result.message).toContain('status.anthropic.com')
  })

  it('returns null for non-API errors', () => {
    const err = new Error('random')
    expect(friendlyClaudeError(err)).toBeNull()
  })
})
