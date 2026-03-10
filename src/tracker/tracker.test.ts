import { describe, it, expect, beforeEach } from 'vitest'
import { TokenTracker } from './tracker'

describe('TokenTracker', () => {
  let tracker: TokenTracker

  beforeEach(() => {
    tracker = new TokenTracker({ enabled: true, log_file: '/tmp/test-locode.log' })
  })

  it('records token usage per turn', () => {
    tracker.record({ agent: 'local', input: 100, output: 50, model: 'qwen3:8b' })
    tracker.record({ agent: 'claude', input: 2000, output: 400, model: 'claude-sonnet-4-6' })
    const stats = tracker.getStats()
    expect(stats.local.inputTokens).toBe(100)
    expect(stats.claude.inputTokens).toBe(2000)
    expect(stats.total.inputTokens).toBe(2100)
  })

  it('calculates estimated cost', () => {
    tracker.record({ agent: 'claude', input: 1000000, output: 0, model: 'claude-sonnet-4-6' })
    const stats = tracker.getStats()
    expect(stats.claude.estimatedCostUsd).toBeGreaterThan(0)
  })

  it('tracks local routing percentage', () => {
    tracker.record({ agent: 'local', input: 100, output: 50, model: 'qwen3:8b' })
    tracker.record({ agent: 'local', input: 100, output: 50, model: 'qwen3:8b' })
    tracker.record({ agent: 'claude', input: 2000, output: 400, model: 'claude-sonnet-4-6' })
    const stats = tracker.getStats()
    expect(stats.localRoutingPct).toBeCloseTo(66.67, 1)
  })
})
