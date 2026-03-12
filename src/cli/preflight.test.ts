import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { preflight } from './preflight'

vi.mock('./install', () => ({
  isOllamaRunning: vi.fn(),
}))

import { isOllamaRunning } from './install'
const mockedIsOllamaRunning = vi.mocked(isOllamaRunning)

describe('preflight', () => {
  let logs: string[]
  const originalEnv = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv
    } else {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('reports both available', () => {
    mockedIsOllamaRunning.mockReturnValue(true)
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'

    preflight('http://localhost:11434')

    const output = logs.join('\n')
    expect(output).toContain('Ollama')
    expect(output).toContain('Claude')
    expect(output).not.toContain('✗')
  })

  it('reports ollama down, claude available', () => {
    mockedIsOllamaRunning.mockReturnValue(false)
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'

    preflight('http://localhost:11434')

    const output = logs.join('\n')
    expect(output).toMatch(/✗.*Ollama/)
    expect(output).toMatch(/✓.*Claude/)
  })

  it('reports ollama up, claude missing', () => {
    mockedIsOllamaRunning.mockReturnValue(true)
    delete process.env.ANTHROPIC_API_KEY

    preflight('http://localhost:11434')

    const output = logs.join('\n')
    expect(output).toMatch(/✓.*Ollama/)
    expect(output).toMatch(/✗.*Claude/)
  })

  it('warns when neither is available', () => {
    mockedIsOllamaRunning.mockReturnValue(false)
    delete process.env.ANTHROPIC_API_KEY

    preflight('http://localhost:11434')

    const output = logs.join('\n')
    expect(output).toMatch(/✗.*Ollama/)
    expect(output).toMatch(/✗.*Claude/)
    expect(output).toContain('locode setup')
  })
})
