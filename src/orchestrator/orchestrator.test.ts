import { describe, it, expect, vi } from 'vitest'
import { Orchestrator } from './orchestrator'

const mockConfig = {
  local_llm: { provider: 'ollama' as const, model: 'qwen3:8b', base_url: 'http://localhost:11434' },
  claude: { model: 'claude-sonnet-4-6', token_threshold: 0.99 },
  routing: {
    rules: [{ pattern: 'grep|find|read', agent: 'local' as const }],
    ambiguous_resolver: 'local' as const,
    escalation_threshold: 0.7,
  },
  context: { handoff: 'summary' as const, max_summary_tokens: 500, max_file_bytes: 51200 },
  token_tracking: { enabled: false, log_file: '/tmp/test.log' },
}

describe('Orchestrator', () => {
  it('routes to local agent and records tokens', async () => {
    const mockLocal = { run: vi.fn().mockResolvedValue({ content: 'found files', summary: 'Found 3 files.', inputTokens: 100, outputTokens: 30 }) }
    const mockClaude = { run: vi.fn() }
    const orch = new Orchestrator(mockConfig, mockLocal as unknown as import('../agents/local').LocalAgent, mockClaude as unknown as import('../agents/claude').ClaudeAgent)

    const result = await orch.process('find all .ts files in src/')
    expect(result.agent).toBe('local')
    expect(result.content).toBe('found files')
    expect(mockLocal.run).toHaveBeenCalled()
    expect(mockClaude.run).not.toHaveBeenCalled()
  })

  it('routes to local agent when ANTHROPIC_API_KEY is not set', async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    const mockLocal = { run: vi.fn().mockResolvedValue({ content: 'local result', summary: 'summary', inputTokens: 50, outputTokens: 20 }) }
    const mockClaude = { run: vi.fn() }

    // A prompt that would normally route to claude
    const orchConfig = {
      ...mockConfig,
      routing: {
        ...mockConfig.routing,
        rules: [{ pattern: 'refactor', agent: 'claude' as const }],
      },
    }
    const orch = new Orchestrator(orchConfig, mockLocal as unknown as import('../agents/local').LocalAgent, mockClaude as unknown as import('../agents/claude').ClaudeAgent)

    const result = await orch.process('refactor this function')
    expect(result.agent).toBe('local')
    expect(mockClaude.run).not.toHaveBeenCalled()
    expect(orch.isLocalOnly()).toBe(true)

    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey
  })

  it('routes everything to Claude when claudeOnly is true', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const mockLocal = { run: vi.fn() }
    const mockClaude = { run: vi.fn().mockResolvedValue({ content: 'claude result', summary: 'summary', inputTokens: 500, outputTokens: 100, rateLimitInfo: null }), generateHandoffSummary: vi.fn() }
    const orch = new Orchestrator(mockConfig, mockLocal as unknown as import('../agents/local').LocalAgent, mockClaude as unknown as import('../agents/claude').ClaudeAgent, { claudeOnly: true })

    const result = await orch.process('find all .ts files')  // would normally go local
    expect(result.agent).toBe('claude')
    expect(mockLocal.run).not.toHaveBeenCalled()
    expect(mockClaude.run).toHaveBeenCalled()
  })

  it('falls back to local when Claude throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    const mockLocal = { run: vi.fn().mockResolvedValue({ content: 'local fallback', summary: 'summary', inputTokens: 50, outputTokens: 20 }) }
    const mockClaude = { run: vi.fn().mockRejectedValue(new Error('API unavailable')) }

    const orchConfig = {
      ...mockConfig,
      routing: {
        ...mockConfig.routing,
        rules: [{ pattern: 'refactor', agent: 'claude' as const }],
      },
    }
    const orch = new Orchestrator(orchConfig, mockLocal as unknown as import('../agents/local').LocalAgent, mockClaude as unknown as import('../agents/claude').ClaudeAgent)

    const result = await orch.process('refactor this function')
    expect(result.agent).toBe('local')
    expect(result.content).toBe('local fallback')
    expect(mockLocal.run).toHaveBeenCalled()
  })

  it('switches to local fallback when token threshold is exceeded', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    const mockLocal = {
      run: vi.fn().mockResolvedValue({ content: 'local result', summary: 'local summary', inputTokens: 50, outputTokens: 20 }),
    }
    const mockClaude = {
      run: vi.fn().mockResolvedValue({
        content: 'claude result',
        summary: 'claude summary',
        inputTokens: 500,
        outputTokens: 100,
        // 99.9% used — exceeds threshold of 0.99
        rateLimitInfo: { tokensRemaining: 100, tokensLimit: 100000, resetsAt: Date.now() + 3600000 },
      }),
      generateHandoffSummary: vi.fn().mockResolvedValue('handoff summary from claude'),
    }

    const orchConfig = {
      ...mockConfig,
      routing: { ...mockConfig.routing, rules: [{ pattern: 'refactor', agent: 'claude' as const }] },
    }
    const orch = new Orchestrator(
      orchConfig,
      mockLocal as unknown as import('../agents/local').LocalAgent,
      mockClaude as unknown as import('../agents/claude').ClaudeAgent,
    )

    // First call: Claude responds, threshold exceeded
    await orch.process('refactor this function')
    expect(mockClaude.generateHandoffSummary).toHaveBeenCalledWith('claude summary')
    expect(orch.isLocalFallback()).toBe(true)

    // Second call: should go to local with handoff summary as context
    await orch.process('refactor this function')
    expect(mockLocal.run).toHaveBeenCalledWith('refactor this function', 'handoff summary from claude')
  })

  it('stays on Claude when token threshold is not exceeded', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    const mockLocal = { run: vi.fn() }
    const mockClaude = {
      run: vi.fn().mockResolvedValue({
        content: 'claude result',
        summary: 'summary',
        inputTokens: 500,
        outputTokens: 100,
        // 50% used — well below threshold
        rateLimitInfo: { tokensRemaining: 50000, tokensLimit: 100000, resetsAt: Date.now() + 3600000 },
      }),
      generateHandoffSummary: vi.fn(),
    }

    const orchConfig = {
      ...mockConfig,
      routing: { ...mockConfig.routing, rules: [{ pattern: 'refactor', agent: 'claude' as const }] },
    }
    const orch = new Orchestrator(
      orchConfig,
      mockLocal as unknown as import('../agents/local').LocalAgent,
      mockClaude as unknown as import('../agents/claude').ClaudeAgent,
    )

    await orch.process('refactor this function')
    expect(mockClaude.generateHandoffSummary).not.toHaveBeenCalled()
    expect(orch.isLocalFallback()).toBe(false)
  })

  it('switches back to Claude after reset time passes', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    const mockLocal = {
      run: vi.fn().mockResolvedValue({ content: 'local', summary: 'local summary', inputTokens: 50, outputTokens: 20 }),
    }
    const mockClaude = {
      run: vi.fn().mockResolvedValue({
        content: 'claude back',
        summary: 'claude summary',
        inputTokens: 500,
        outputTokens: 100,
        rateLimitInfo: { tokensRemaining: 80000, tokensLimit: 100000, resetsAt: Date.now() + 86400000 },
      }),
      generateHandoffSummary: vi.fn().mockResolvedValue('handoff summary'),
    }

    const orch = new Orchestrator(
      mockConfig,
      mockLocal as unknown as import('../agents/local').LocalAgent,
      mockClaude as unknown as import('../agents/claude').ClaudeAgent,
    )

    // Force into fallback state with an already-expired resetsAt
    // @ts-expect-error accessing private for test
    orch.localFallback = true
    // @ts-expect-error accessing private for test
    orch.resetsAt = Date.now() - 1000  // already past
    // @ts-expect-error accessing private for test
    orch.fallbackSummary = 'work done by local agent'

    const result = await orch.process('refactor this function')
    expect(result.agent).toBe('claude')
    expect(result.content).toBe('claude back')
    expect(mockClaude.run).toHaveBeenCalledWith('refactor this function', 'work done by local agent')
    expect(orch.isLocalFallback()).toBe(false)
  })

  it('retryWithLocal calls local agent and returns local result', async () => {
    const mockLocal = {
      run: vi.fn().mockResolvedValue({ content: 'local retry result', summary: 'summary', inputTokens: 50, outputTokens: 20 }),
    }
    const mockClaude = { run: vi.fn() }
    const orch = new Orchestrator(mockConfig, mockLocal as unknown as import('../agents/local').LocalAgent, mockClaude as unknown as import('../agents/claude').ClaudeAgent)

    const result = await orch.retryWithLocal('find files', 'previous context')
    expect(result.agent).toBe('local')
    expect(result.content).toBe('local retry result')
    expect(mockLocal.run).toHaveBeenCalledWith('find files', 'previous context')
    expect(mockClaude.run).not.toHaveBeenCalled()
  })

  it('retryWithClaude calls Claude and returns claude result', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const mockLocal = { run: vi.fn() }
    const mockClaude = {
      run: vi.fn().mockResolvedValue({ content: 'claude retry result', summary: 'summary', inputTokens: 500, outputTokens: 100, rateLimitInfo: null }),
      generateHandoffSummary: vi.fn(),
    }
    const orch = new Orchestrator(mockConfig, mockLocal as unknown as import('../agents/local').LocalAgent, mockClaude as unknown as import('../agents/claude').ClaudeAgent)

    const result = await orch.retryWithClaude('complex task', 'previous context')
    expect(result.agent).toBe('claude')
    expect(result.content).toBe('claude retry result')
    expect(mockClaude.run).toHaveBeenCalledWith('complex task', 'previous context')
    expect(mockLocal.run).not.toHaveBeenCalled()
  })

  it('stays local when switch-back attempt is still rate-limited', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    const rateLimitError = Object.assign(new Error('rate limit'), { status: 429 })

    const mockLocal = {
      run: vi.fn().mockResolvedValue({ content: 'local', summary: 'local summary', inputTokens: 50, outputTokens: 20 }),
    }
    const mockClaude = {
      run: vi.fn().mockRejectedValue(rateLimitError),
      generateHandoffSummary: vi.fn(),
    }

    const orch = new Orchestrator(
      mockConfig,
      mockLocal as unknown as import('../agents/local').LocalAgent,
      mockClaude as unknown as import('../agents/claude').ClaudeAgent,
    )

    // @ts-expect-error accessing private for test
    orch.localFallback = true
    // @ts-expect-error accessing private for test
    orch.resetsAt = Date.now() - 1000
    // @ts-expect-error accessing private for test
    orch.fallbackSummary = 'local context'

    const beforeRetry = Date.now() + 3600000 - 5000  // ~1 hour from now minus 5s buffer

    const result = await orch.process('any prompt')
    expect(result.agent).toBe('local')
    expect(orch.isLocalFallback()).toBe(true)
    // @ts-expect-error accessing private for test
    expect(orch.resetsAt).toBeGreaterThan(beforeRetry)
  })
})
