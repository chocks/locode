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
      inputTokens: 120,
      outputTokens: 45,
      metadata: { diffs: ['a diff'] },
    })

    expect(fs.existsSync(artifact.runDir)).toBe(true)
    const payload = JSON.parse(fs.readFileSync(path.join(artifact.runDir, 'run.json'), 'utf8'))
    expect(payload.prompt).toBe('fix the failing test')
    expect(payload.inputTokens).toBe(120)
    expect(payload.metadata.diffs).toEqual(['a diff'])
    expect(fs.readFileSync(path.join(artifact.runDir, 'summary.txt'), 'utf8')).toBe('Applied 1 edit')
    expect(fs.readFileSync(path.join(artifact.runDir, 'prompt.txt'), 'utf8')).toBe('fix the failing test')
    expect(fs.readFileSync(path.join(artifact.runDir, 'content.txt'), 'utf8')).toBe('diff output')
  })

  it('writes replay and debug files for structured metadata', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-artifacts-'))
    const store = new RunArtifactStore(tmpDir)

    const artifact = await store.write({
      prompt: 'fix src/a.ts',
      intent: 'edit',
      routeMethod: 'rule',
      agent: 'claude',
      reason: 'coding task detected',
      summary: 'Applied 1 edit',
      content: '--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-old\n+new\n',
      inputTokens: 300,
      outputTokens: 90,
      metadata: {
        edits: [{ file: 'src/a.ts', operation: 'replace', search: 'old', content: 'new' }],
        diffs: ['--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-old\n+new\n'],
        promptBudget: { maxChars: 1000, usedChars: 400, remainingChars: 600, truncatedEntries: 1 },
      },
    })

    const resultJson = JSON.parse(fs.readFileSync(path.join(artifact.runDir, 'result.json'), 'utf8'))
    const editsJson = JSON.parse(fs.readFileSync(path.join(artifact.runDir, 'edits.json'), 'utf8'))
    const debugJson = JSON.parse(fs.readFileSync(path.join(artifact.runDir, 'debug.json'), 'utf8'))
    const diffsPatch = fs.readFileSync(path.join(artifact.runDir, 'diffs.patch'), 'utf8')

    expect(resultJson.tokens).toEqual({ input: 300, output: 90 })
    expect(editsJson).toHaveLength(1)
    expect(debugJson.promptBudget.remainingChars).toBe(600)
    expect(diffsPatch).toContain('+++ b/src/a.ts')
  })
})
