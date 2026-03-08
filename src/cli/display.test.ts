import { describe, it, expect } from 'vitest'
import { formatPrompt, formatContinuation } from './display'

describe('formatPrompt', () => {
  it('returns green prompt for hybrid mode', () => {
    const result = formatPrompt('hybrid')
    expect(result).toContain('>')
    expect(result).toContain('\x1b[32m')
  })

  it('returns cyan prompt with "local" for local-only mode', () => {
    const result = formatPrompt('local')
    expect(result).toContain('local')
    expect(result).toContain('\x1b[36m')
  })

  it('returns magenta prompt with "claude" for claude-only mode', () => {
    const result = formatPrompt('claude')
    expect(result).toContain('claude')
    expect(result).toContain('\x1b[35m')
  })
})

describe('formatContinuation', () => {
  it('returns a dim continuation prompt', () => {
    const result = formatContinuation()
    expect(result).toContain('\x1b[2m')
    expect(result).toContain('...')
  })
})
