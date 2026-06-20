import { describe, it, expect } from 'vitest'
import { BudgetManager } from './budget-manager'
import type { BudgetPriority } from './types'

describe('BudgetManager', () => {
  it('allocates full budget to a single file', () => {
    const mgr = new BudgetManager(1000)
    const result = mgr.allocate([
      { path: 'a.ts', content: 'x'.repeat(500), priority: 'direct_match' as BudgetPriority },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].tokensUsed).toBe(500)
    expect(result[0].truncated).toBe(false)
  })

  it('truncates a file that exceeds max_tokens_per_file', () => {
    const mgr = new BudgetManager(10000, { maxPerFile: 200 })
    const result = mgr.allocate([
      { path: 'a.ts', content: 'x'.repeat(500), priority: 'direct_match' as BudgetPriority },
    ])
    expect(result[0].tokensUsed).toBe(200)
    expect(result[0].truncated).toBe(true)
    expect(result[0].content).toHaveLength(200)
  })

  it('gives higher priority files more budget', () => {
    const mgr = new BudgetManager(600, { maxPerFile: 1000 })
    const result = mgr.allocate([
      { path: 'low.ts', content: 'x'.repeat(400), priority: 'dependency' as BudgetPriority },
      { path: 'high.ts', content: 'x'.repeat(400), priority: 'direct_match' as BudgetPriority },
    ])
    const highFile = result.find(r => r.path === 'high.ts')!
    const lowFile = result.find(r => r.path === 'low.ts')!
    expect(highFile.tokensUsed).toBeGreaterThan(lowFile.tokensUsed)
  })

  it('does not exceed total budget', () => {
    const mgr = new BudgetManager(300, { maxPerFile: 1000 })
    const result = mgr.allocate([
      { path: 'a.ts', content: 'x'.repeat(200), priority: 'direct_match' as BudgetPriority },
      { path: 'b.ts', content: 'x'.repeat(200), priority: 'symbol_match' as BudgetPriority },
    ])
    const total = result.reduce((sum, r) => sum + r.tokensUsed, 0)
    expect(total).toBeLessThanOrEqual(300)
  })

  it('returns empty array for empty input', () => {
    const mgr = new BudgetManager(1000)
    expect(mgr.allocate([])).toEqual([])
  })

  it('marks files as truncated when total budget is exhausted', () => {
    const mgr = new BudgetManager(100, { maxPerFile: 1000 })
    const result = mgr.allocate([
      { path: 'a.ts', content: 'x'.repeat(80), priority: 'direct_match' as BudgetPriority },
      { path: 'b.ts', content: 'x'.repeat(80), priority: 'direct_match' as BudgetPriority },
    ])
    const total = result.reduce((sum, r) => sum + r.tokensUsed, 0)
    expect(total).toBe(100)
    const truncated = result.filter(r => r.truncated)
    expect(truncated.length).toBeGreaterThan(0)
  })

  it('respects max_files limit', () => {
    const mgr = new BudgetManager(10000, { maxPerFile: 1000, maxFiles: 2 })
    const result = mgr.allocate([
      { path: 'a.ts', content: 'x', priority: 'direct_match' as BudgetPriority },
      { path: 'b.ts', content: 'x', priority: 'direct_match' as BudgetPriority },
      { path: 'c.ts', content: 'x', priority: 'direct_match' as BudgetPriority },
    ])
    expect(result).toHaveLength(2)
  })

  it('sorts output by priority (direct_match first)', () => {
    const mgr = new BudgetManager(10000, { maxPerFile: 1000 })
    const result = mgr.allocate([
      { path: 'dep.ts', content: 'x', priority: 'dependency' as BudgetPriority },
      { path: 'direct.ts', content: 'x', priority: 'direct_match' as BudgetPriority },
      { path: 'sym.ts', content: 'x', priority: 'symbol_match' as BudgetPriority },
    ])
    expect(result[0].path).toBe('direct.ts')
    expect(result[1].path).toBe('sym.ts')
    expect(result[2].path).toBe('dep.ts')
  })
})
