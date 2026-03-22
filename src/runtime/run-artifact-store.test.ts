import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { RunArtifactStore } from './run-artifact-store'

describe('RunArtifactStore', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes a run artifact bundle and returns the run directory', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-artifacts-'))
    const store = new RunArtifactStore(tmpDir)

    const artifact = await store.write({
      prompt: 'fix the failing test',
      intent: 'edit',
      routeMethod: 'rule',
      agent: 'local',
      reason: 'coding task detected',
      summary: 'Applied 1 edit',
      content: 'diff output',
      metadata: { diffs: ['a diff'] },
    })

    expect(fs.existsSync(artifact.runDir)).toBe(true)
    const payload = JSON.parse(fs.readFileSync(path.join(artifact.runDir, 'run.json'), 'utf8'))
    expect(payload.prompt).toBe('fix the failing test')
    expect(payload.metadata.diffs).toEqual(['a diff'])
    expect(fs.readFileSync(path.join(artifact.runDir, 'prompt.txt'), 'utf8')).toBe('fix the failing test')
    expect(fs.readFileSync(path.join(artifact.runDir, 'content.txt'), 'utf8')).toBe('diff output')
  })
})
