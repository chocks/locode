import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import { execFileSync } from 'child_process'
import * as path from 'path'

vi.mock('fs')
vi.mock('child_process')

import { loadRepoContext } from './repo-context-loader'

const MAX_BYTES = 51200

describe('loadRepoContext', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('/fake/repo\n'))
  })

  it('returns empty string when no files configured', () => {
    const result = loadRepoContext([], MAX_BYTES)
    expect(result).toBe('')
  })

  it('reads a file from the git repo root', () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue('# Project\nSome content.')
    const result = loadRepoContext(['CLAUDE.md'], MAX_BYTES)
    expect(result).toContain('--- CLAUDE.md ---')
    expect(result).toContain('# Project\nSome content.')
    expect(fs.readFileSync).toHaveBeenCalledWith(path.join('/fake/repo', 'CLAUDE.md'), 'utf8')
  })

  it('skips missing files silently', () => {
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error('ENOENT') })
    const result = loadRepoContext(['missing.md'], MAX_BYTES)
    expect(result).toBe('')
  })

  it('truncates files exceeding maxBytes', () => {
    const bigContent = 'x'.repeat(60000)
    vi.mocked(fs.statSync).mockReturnValue({ size: 60000 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue(bigContent)
    const result = loadRepoContext(['big.md'], MAX_BYTES)
    expect(result).toContain('[big.md — truncated at 50KB, 60000 bytes total]')
    expect(result).toContain('x'.repeat(MAX_BYTES))
    expect(result).not.toContain(bigContent)
  })

  it('concatenates multiple files with headers', () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 50 } as fs.Stats)
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('content A')
      .mockReturnValueOnce('content B')
    const result = loadRepoContext(['CLAUDE.md', 'README.md'], MAX_BYTES)
    expect(result).toContain('--- CLAUDE.md ---')
    expect(result).toContain('content A')
    expect(result).toContain('--- README.md ---')
    expect(result).toContain('content B')
    // Verify they are separated
    const parts = result.split('\n\n')
    expect(parts.length).toBeGreaterThanOrEqual(2)
  })

  it('falls back to cwd when not in a git repo', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('not a git repo') })
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/fallback/dir')
    vi.mocked(fs.statSync).mockReturnValue({ size: 10 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue('fallback content')
    const result = loadRepoContext(['file.md'], MAX_BYTES)
    expect(result).toContain('fallback content')
    expect(fs.readFileSync).toHaveBeenCalledWith(path.join('/fallback/dir', 'file.md'), 'utf8')
    cwdSpy.mockRestore()
  })
})
