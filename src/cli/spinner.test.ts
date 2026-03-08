import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSpinner } from './spinner'

describe('createSpinner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes spinner frames to stderr on TTY', () => {
    const write = vi.fn()
    const spinner = createSpinner('Thinking...', { write, isTTY: true })
    spinner.start()

    vi.advanceTimersByTime(80)
    expect(write).toHaveBeenCalled()
    // calls[0] is the cursor-hide escape; calls[1] is the first spinner frame
    const frameCall = write.mock.calls[1][0] as string
    expect(frameCall).toContain('Thinking...')

    spinner.stop()
  })

  it('clears the line on stop', () => {
    const write = vi.fn()
    const spinner = createSpinner('Thinking...', { write, isTTY: true })
    spinner.start()
    vi.advanceTimersByTime(80)

    write.mockClear()
    spinner.stop()

    const stopCall = write.mock.calls[0][0] as string
    expect(stopCall).toContain('\r')
  })

  it('skips animation on non-TTY', () => {
    const write = vi.fn()
    const spinner = createSpinner('Thinking...', { write, isTTY: false })
    spinner.start()

    vi.advanceTimersByTime(200)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toContain('Thinking...')

    spinner.stop()
  })

  it('stop is safe to call without start', () => {
    const write = vi.fn()
    const spinner = createSpinner('Thinking...', { write, isTTY: true })
    expect(() => spinner.stop()).not.toThrow()
  })

  it('cycles through frames over time', () => {
    const write = vi.fn()
    const spinner = createSpinner('Thinking...', { write, isTTY: true })
    spinner.start()

    vi.advanceTimersByTime(80 * 3)
    const frames = write.mock.calls.map((c: [string]) => c[0])
    const uniqueFrames = new Set(frames)
    expect(uniqueFrames.size).toBeGreaterThan(1)

    spinner.stop()
  })
})
