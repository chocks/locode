import { describe, it, expect } from 'vitest'
import { resolvePrompts } from './benchmark'
import fs from 'fs'
import os from 'os'
import path from 'path'

describe('resolvePrompts', () => {
  it('returns inline prompts when provided', () => {
    const result = resolvePrompts({ prompt: ['task one', 'task two'] })
    expect(result).toEqual(['task one', 'task two'])
  })

  it('reads prompt from task file when provided', () => {
    const tmpFile = path.join(os.tmpdir(), 'locode-test-task.md')
    fs.writeFileSync(tmpFile, '# My Task\nDo something cool.')
    const result = resolvePrompts({ task: tmpFile })
    expect(result[0]).toContain('My Task')
    fs.unlinkSync(tmpFile)
  })

  it('returns default todo-webapp task when no options given', () => {
    const result = resolvePrompts({})
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('todo')
  })
})
