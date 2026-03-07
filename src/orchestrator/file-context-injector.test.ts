import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'

vi.mock('fs')

import { injectFileContext } from './file-context-injector'

const MAX_BYTES = 51200

describe('injectFileContext', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns original prompt when no file path is detected', () => {
    const result = injectFileContext('refactor the auth module', MAX_BYTES)
    expect(result).toBe('refactor the auth module')
  })

  it('detects a bare filename and injects its content', () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue('# Agent\nDoes things.')
    const result = injectFileContext('review AGENT.md', MAX_BYTES)
    expect(result).toContain('[File: AGENT.md]')
    expect(result).toContain('# Agent\nDoes things.')
    expect(result).toContain('review AGENT.md')
  })

  it('detects a relative path and injects its content', () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 200 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue('export const x = 1')
    const result = injectFileContext('explain ./src/index.ts', MAX_BYTES)
    expect(result).toContain('[File: ./src/index.ts]')
    expect(result).toContain('export const x = 1')
  })

  it('truncates content when file exceeds max_file_bytes', () => {
    const bigContent = 'x'.repeat(60000)
    vi.mocked(fs.statSync).mockReturnValue({ size: 60000 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue(bigContent)
    const result = injectFileContext('review big.md', MAX_BYTES)
    expect(result).toContain('[big.md — truncated at 50KB, 60000 bytes total]')
    // Verify the full 60000-char content is not present (truncation actually happened)
    expect(result).not.toContain(bigContent)
    // Verify the first MAX_BYTES chars are present (content not silently dropped)
    expect(result).toContain('x'.repeat(MAX_BYTES))
  })

  it('skips file silently when it does not exist', () => {
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error('ENOENT') })
    const result = injectFileContext('review missing.md', MAX_BYTES)
    expect(result).toBe('review missing.md')
  })

  it('skips file silently on permission error', () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('EACCES') })
    const result = injectFileContext('review secret.md', MAX_BYTES)
    expect(result).toBe('review secret.md')
  })

  it('does not match URLs as file paths', () => {
    const result = injectFileContext('fetch https://example.com/api.json', MAX_BYTES)
    expect(result).toBe('fetch https://example.com/api.json')
    expect(fs.statSync).not.toHaveBeenCalled()
  })

  it('injects multiple files when prompt references more than one', () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 50 } as fs.Stats)
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('content A')
      .mockReturnValueOnce('content B')
    const result = injectFileContext('compare AGENT.md and README.md', MAX_BYTES)
    expect(result).toContain('[File: AGENT.md]')
    expect(result).toContain('[File: README.md]')
    expect(result).toContain('content A')
    expect(result).toContain('content B')
  })
})
