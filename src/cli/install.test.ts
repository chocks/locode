import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process to avoid actually running system commands
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))

import { execSync, execFileSync } from 'child_process'
import os from 'os'

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, default: { ...actual, platform: vi.fn(() => 'darwin') } }
})

describe('install helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects ollama as installed when which succeeds', async () => {
    // We test the behavior indirectly via runInstall
    // Since execFileSync('which', ['ollama']) is mocked to succeed,
    // and execFileSync('ollama', ['list']) succeeds (daemon running),
    // and execFileSync('ollama', ['pull', ...]) succeeds,
    // runInstall should complete without process.exit
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue('') // all execFileSync calls succeed

    const { runInstall } = await import('./install')

    // Should not throw
    await expect(runInstall({ model: 'qwen2.5-coder:7b' })).resolves.toBeUndefined()

    // Should have checked for ollama, checked daemon, and pulled model
    expect(mockExecFileSync).toHaveBeenCalledWith('which', ['ollama'], expect.any(Object))
    expect(mockExecFileSync).toHaveBeenCalledWith('ollama', ['list'], expect.any(Object))
    expect(mockExecFileSync).toHaveBeenCalledWith('ollama', ['pull', 'qwen2.5-coder:7b'], expect.any(Object))
  })

  describe('installOllama', () => {
    it('uses curl install script on macOS when brew is not available', async () => {
      const mockExecFileSync = vi.mocked(execFileSync)
      const mockExecSync = vi.mocked(execSync)
      const mockPlatform = vi.mocked(os.platform)
      mockPlatform.mockReturnValue('darwin')

      // 'which ollama' fails (not installed), 'which brew' fails (no brew)
      mockExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'which') throw new Error('not found')
        return ''
      })

      const { installOllama } = await import('./install')
      installOllama()

      expect(mockExecSync).toHaveBeenCalledWith(
        'curl -fsSL https://ollama.com/install.sh | sh',
        { stdio: 'inherit' }
      )
    })
  })
})
