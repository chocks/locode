import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentStream, StreamRenderer } from './stream'

describe('AgentStream', () => {
  it('emits and receives stream events', () => {
    const stream = new AgentStream()
    const handler = vi.fn()
    stream.on('stream', handler)
    stream.emit('stream', { type: 'phase', phase: 'analyze', detail: 'Starting' })
    expect(handler).toHaveBeenCalledWith({ type: 'phase', phase: 'analyze', detail: 'Starting' })
  })
})

describe('StreamRenderer', () => {
  let stream: AgentStream
  let renderer: StreamRenderer
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stream = new AgentStream()
    renderer = new StreamRenderer(stream)
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    renderer.stop()
  })

  it('renders phase events', () => {
    renderer.start()
    stream.emit('stream', { type: 'phase', phase: 'analyze', detail: 'Gathering context' })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ANALYZE'))
  })

  it('renders error events', () => {
    renderer.start()
    stream.emit('stream', { type: 'error', message: 'Something broke' })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Something broke'))
  })

  it('renders plan events', () => {
    renderer.start()
    stream.emit('stream', {
      type: 'plan',
      plan: { description: 'Fix bug', steps: [{ description: 'step1', file: 'a.ts', operation: 'replace', reasoning: 'fix' }], estimatedFiles: ['a.ts'] },
    })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Fix bug'))
  })

  it('does not render after stop', () => {
    renderer.start()
    renderer.stop()
    stream.emit('stream', { type: 'phase', phase: 'plan', detail: 'Planning' })
    const planCalls = consoleSpy.mock.calls.filter(c => String(c[0]).includes('PLAN'))
    expect(planCalls).toHaveLength(0)
  })
})
