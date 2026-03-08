import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}))

import { execFileSync } from 'child_process'

describe('runUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs npm update -g @chocks-dev/locode and prints new version', async () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockReturnValue('0.2.0\n')

    const { runUpdate } = await import('./update')
    await runUpdate()

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npm', ['update', '-g', '@chocks-dev/locode'],
      { stdio: 'inherit' }
    )
  })

  it('prints error message on failure without crashing', async () => {
    const mockExecFileSync = vi.mocked(execFileSync)
    mockExecFileSync.mockImplementation(() => {
      throw new Error('permission denied')
    })

    const { runUpdate } = await import('./update')
    // Should not throw
    await expect(runUpdate()).resolves.toBeUndefined()
  })
})
