import { describe, it, expect } from 'vitest'
import { readFileTool } from './readFile'
import { shellTool } from './shell'
import path from 'path'

describe('readFileTool', () => {
  it('reads a file and returns content', async () => {
    const result = await readFileTool({ path: path.join(__dirname, '../../locode.yaml') })
    expect(result).toContain('local_llm')
  })

  it('returns error message for missing file', async () => {
    const result = await readFileTool({ path: '/nonexistent/file.txt' })
    expect(result).toContain('Error')
  })
})

describe('shellTool', () => {
  it('executes a safe read-only command', async () => {
    const result = await shellTool({ command: 'echo hello' })
    expect(result.trim()).toBe('hello')
  })

  it('blocks write commands', async () => {
    const result = await shellTool({ command: 'rm -rf /' })
    expect(result).toContain('blocked')
  })
})
