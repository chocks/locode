import { describe, it, expect, vi } from 'vitest'
import { Orchestrator } from './orchestrator'

const mockConfig = {
  local_llm: { provider: 'ollama' as const, model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' },
  claude: { model: 'claude-sonnet-4-6' },
  routing: {
    rules: [{ pattern: 'grep|find|read', agent: 'local' as const }],
    ambiguous_resolver: 'local' as const,
    escalation_threshold: 0.7,
  },
  context: { handoff: 'summary' as const, max_summary_tokens: 500 },
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
    const mockClaude = { run: vi.fn().mockResolvedValue({ content: 'claude result', summary: 'summary', inputTokens: 500, outputTokens: 100 }) }
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
})
