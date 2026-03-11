import { describe, it, expect, afterEach } from 'vitest'
import { readFileTool } from './readFile'
import { shellTool } from './shell'
import { writeFileTool } from './writeFile'
import { editFileTool } from './editFile'
import path from 'path'
import fs from 'fs'

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

describe('writeFileTool', () => {
  const tmpFile = path.join(__dirname, '../../.tmp-test-write.txt')

  afterEach(() => {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('creates a new file with content', async () => {
    const result = await writeFileTool({ path: tmpFile, content: 'hello world' })
    expect(result).toContain('Written')
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe('hello world')
  })

  it('overwrites an existing file', async () => {
    fs.writeFileSync(tmpFile, 'old content')
    const result = await writeFileTool({ path: tmpFile, content: 'new content' })
    expect(result).toContain('Written')
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe('new content')
  })

  it('blocks writes outside project root', async () => {
    const result = await writeFileTool({ path: '/etc/passwd', content: 'nope' })
    expect(result).toContain('blocked')
  })
})

describe('editFileTool', () => {
  const tmpFile = path.join(__dirname, '../../.tmp-test-edit.txt')

  afterEach(() => {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('replaces old_string with new_string', async () => {
    fs.writeFileSync(tmpFile, 'function foo() { return 1 }')
    const result = await editFileTool({
      path: tmpFile,
      old_string: 'return 1',
      new_string: 'return 2',
    })
    expect(result).toContain('Applied')
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe('function foo() { return 2 }')
  })

  it('returns error when old_string not found', async () => {
    fs.writeFileSync(tmpFile, 'function foo() { return 1 }')
    const result = await editFileTool({
      path: tmpFile,
      old_string: 'return 999',
      new_string: 'return 2',
    })
    expect(result).toContain('not found')
  })

  it('returns error when old_string matches multiple times', async () => {
    fs.writeFileSync(tmpFile, 'aaa bbb aaa')
    const result = await editFileTool({
      path: tmpFile,
      old_string: 'aaa',
      new_string: 'ccc',
    })
    expect(result).toContain('multiple')
  })

  it('returns error for nonexistent file', async () => {
    const result = await editFileTool({
      path: '/nonexistent/file.txt',
      old_string: 'x',
      new_string: 'y',
    })
    expect(result).toContain('Error')
  })
})
