import { describe, it, expect, vi } from 'vitest'
import { Router } from './router'
import type { Config } from '../config/schema'

const mockConfig: Config = {
  local_llm: { provider: 'ollama', model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' },
  claude: { model: 'claude-sonnet-4-6' },
  routing: {
    rules: [
      { pattern: 'refactor|architect|design|generate|write test|add .* test|fix|bug|debug', agent: 'claude' },
      { pattern: 'grep|search|ls|cat|read|explore|where is', agent: 'local' },
      { pattern: 'git log|git diff|git status|git blame', agent: 'local' },
    ],
    ambiguous_resolver: 'local',
    escalation_threshold: 0.7,
  },
  context: { handoff: 'summary', max_summary_tokens: 500, max_file_bytes: 51200 },
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
    const mockResolve = vi.fn().mockResolvedValue({ agent: 'local', confidence: 0.6 })
    const router = new Router(mockConfig, mockResolve)
    const decision = await router.classify('help me with this code')
    // confidence 0.6 < threshold 0.7 → escalates to claude
    expect(decision.agent).toBe('claude')
    expect(decision.confidence).toBe(0.6)
    expect(decision.method).toBe('llm')
    expect(mockResolve).toHaveBeenCalled()
  })

  it('stays local for ambiguous tasks when confidence exceeds threshold', async () => {
    const lowThresholdConfig = {
      ...mockConfig,
      routing: { ...mockConfig.routing, escalation_threshold: 0.5 },
    }
    const mockResolve = vi.fn().mockResolvedValue({ agent: 'local', confidence: 0.6 })
    const router = new Router(lowThresholdConfig, mockResolve)
    const decision = await router.classify('help me with this code')
    // confidence 0.6 > threshold 0.5 → stays local
    expect(decision.agent).toBe('local')
    expect(decision.confidence).toBe(0.6)
    expect(decision.method).toBe('llm')
  })

  it('does not statically route "review <file>" to claude', async () => {
    const mockResolve = vi.fn().mockResolvedValue({ agent: 'local', confidence: 0.8 })
    const router = new Router(mockConfig, mockResolve)
    const decision = await router.classify('review AGENT.md')
    // Falls through all static rules → LLM resolver is called
    expect(mockResolve).toHaveBeenCalled()
    expect(decision.method).toBe('llm')
    expect(decision.agent).toBe('local') // 0.8 > 0.7 threshold
  })

  it('does not statically route "explain <file>" to claude', async () => {
    const mockResolve = vi.fn().mockResolvedValue({ agent: 'local', confidence: 0.8 })
    const router = new Router(mockConfig, mockResolve)
    const decision = await router.classify('explain src/index.ts')
    // Falls through all static rules → LLM resolver is called
    expect(mockResolve).toHaveBeenCalled()
    expect(decision.method).toBe('llm')
    expect(decision.agent).toBe('local') // 0.8 > 0.7 threshold
  })

  it('routes "find and fix a bug" to claude, not local', async () => {
    const router = new Router(mockConfig)
    const decision = await router.classify('the deleteTask function has a bug - find and fix it and add a test')
    expect(decision.agent).toBe('claude')
    expect(decision.method).toBe('rule')
  })

  it('routes "fix this bug" to claude', async () => {
    const router = new Router(mockConfig)
    const decision = await router.classify('fix the off-by-one error in the loop')
    expect(decision.agent).toBe('claude')
    expect(decision.method).toBe('rule')
  })

  it('routes "add a test" to claude', async () => {
    const router = new Router(mockConfig)
    const decision = await router.classify('add a test for the deleteTask function')
    expect(decision.agent).toBe('claude')
    expect(decision.method).toBe('rule')
  })

  it('respects LLM decision when confidence exceeds threshold', async () => {
    const mockResolve = vi.fn().mockResolvedValue({ agent: 'claude', confidence: 0.9 })
    const router = new Router(mockConfig, mockResolve)
    const decision = await router.classify('help me with this code')
    expect(decision.agent).toBe('claude')
    expect(decision.confidence).toBe(0.9)
  })
})
