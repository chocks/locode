import { describe, it, expect, vi } from 'vitest'
import { Router } from './router'
import type { Config } from '../config/schema'

const mockConfig: Config = {
  local_llm: { provider: 'ollama', model: 'qwen3:8b', base_url: 'http://localhost:11434' },
  claude: { model: 'claude-sonnet-4-6' },
  routing: {
    rules: [
      { pattern: 'find|grep|search|ls|cat|read|explore|where is', agent: 'local' },
      { pattern: 'git log|git diff|git status|git blame', agent: 'local' },
      { pattern: 'refactor|architect|design|generate|write tests', agent: 'claude' },
    ],
    ambiguous_resolver: 'local',
    escalation_threshold: 0.7,
  },
  context: { handoff: 'summary', max_summary_tokens: 500 },
  token_tracking: { enabled: true, log_file: '/tmp/test.log' },
}

describe('Router', () => {
  it('routes grep task to local', async () => {
    const router = new Router(mockConfig)
    const decision = await router.classify('grep for all TODO comments in src/')
    expect(decision.agent).toBe('local')
    expect(decision.method).toBe('rule')
  })

  it('routes refactor task to claude', async () => {
    const router = new Router(mockConfig)
    const decision = await router.classify('refactor the auth module to use dependency injection')
    expect(decision.agent).toBe('claude')
    expect(decision.method).toBe('rule')
  })

  it('escalates to Claude for ambiguous tasks when confidence is below threshold', async () => {
    const mockResolve = vi.fn().mockResolvedValue('local')
    const router = new Router(mockConfig, mockResolve)
    const decision = await router.classify('help me with this code')
    // confidence 0.6 < threshold 0.7 → escalates to claude
    expect(decision.agent).toBe('claude')
    expect(decision.method).toBe('llm')
    expect(mockResolve).toHaveBeenCalled()
  })

  it('stays local for ambiguous tasks when threshold is low', async () => {
    const lowThresholdConfig = {
      ...mockConfig,
      routing: { ...mockConfig.routing, escalation_threshold: 0.5 },
    }
    const mockResolve = vi.fn().mockResolvedValue('local')
    const router = new Router(lowThresholdConfig, mockResolve)
    const decision = await router.classify('help me with this code')
    // confidence 0.6 > threshold 0.5 → stays local
    expect(decision.agent).toBe('local')
    expect(decision.method).toBe('llm')
  })

  it('does not statically route "review <file>" to claude', async () => {
    const mockResolve = vi.fn().mockResolvedValue('local')
    const router = new Router(mockConfig, mockResolve)
    const decision = await router.classify('review AGENT.md')
    // no static rule matches → LLM resolver is called
    expect(mockResolve).toHaveBeenCalled()
  })

  it('does not statically route "explain <file>" to claude', async () => {
    const mockResolve = vi.fn().mockResolvedValue('local')
    const router = new Router(mockConfig, mockResolve)
    const decision = await router.classify('explain src/index.ts')
    expect(mockResolve).toHaveBeenCalled()
  })
})
