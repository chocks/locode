import { describe, it, expect, afterEach } from 'vitest'
import { readFileDefinition } from './read-file'
import { runCommandDefinition } from './run-command'
import { gitQueryDefinition } from './git-query'
import { writeFileDefinition } from './write-file'
import { editFileDefinition } from './edit-file'
import { listFilesDefinition } from './list-files'
import path from 'path'
import fs from 'fs'

describe('readFileDefinition', () => {
  it('has correct metadata', () => {
    expect(readFileDefinition.name).toBe('read_file')
    expect(readFileDefinition.category).toBe('read')
    expect(readFileDefinition.inputSchema.required).toContain('path')
  })

  it('handler returns ToolResult with file content', async () => {
    const result = await readFileDefinition.handler({ path: path.join(__dirname, '../../../locode.yaml') })
    expect(result.success).toBe(true)
    expect(result.output).toContain('local_llm')
    expect(result.metadata?.filesRead).toHaveLength(1)
  })

  it('handler returns failure for missing file', async () => {
    const result = await readFileDefinition.handler({ path: '/nonexistent/file.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Error')
  })
})

describe('runCommandDefinition', () => {
  it('has correct metadata', () => {
    expect(runCommandDefinition.name).toBe('run_command')
    expect(runCommandDefinition.category).toBe('shell')
    expect(runCommandDefinition.inputSchema.required).toContain('command')
  })

  it('handler executes allowed command', async () => {
    const result = await runCommandDefinition.handler({ command: 'echo hello' })
    expect(result.success).toBe(true)
    expect(result.output.trim()).toBe('hello')
  })

  it('handler blocks disallowed command', async () => {
    const result = await runCommandDefinition.handler({ command: 'rm -rf /' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('blocked')
  })
})

describe('gitQueryDefinition', () => {
  it('has correct metadata', () => {
    expect(gitQueryDefinition.name).toBe('git_query')
    expect(gitQueryDefinition.category).toBe('git')
    expect(gitQueryDefinition.inputSchema.required).toContain('args')
  })

  it('handler executes allowed git command', async () => {
    const result = await gitQueryDefinition.handler({ args: 'status' })
    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
  })

  it('handler blocks disallowed git command', async () => {
    const result = await gitQueryDefinition.handler({ args: 'push origin main' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('blocked')
  })
})

describe('writeFileDefinition', () => {
  const tmpFile = path.join(__dirname, '../../../.tmp-test-def-write.txt')

  afterEach(() => {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('has correct metadata', () => {
    expect(writeFileDefinition.name).toBe('write_file')
    expect(writeFileDefinition.category).toBe('write')
    expect(writeFileDefinition.requiresConfirmation).toBe(true)
  })

  it('handler writes file and returns success', async () => {
    const result = await writeFileDefinition.handler({ path: tmpFile, content: 'test content' })
    expect(result.success).toBe(true)
    expect(result.metadata?.filesWritten).toContain(tmpFile)
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe('test content')
  })

  it('handler blocks writes outside project root', async () => {
    const result = await writeFileDefinition.handler({ path: '/etc/passwd', content: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('blocked')
  })
})

describe('editFileDefinition', () => {
  const tmpFile = path.join(__dirname, '../../../.tmp-test-def-edit.txt')

  afterEach(() => {
    try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
  })

  it('has correct metadata', () => {
    expect(editFileDefinition.name).toBe('edit_file')
    expect(editFileDefinition.category).toBe('write')
    expect(editFileDefinition.requiresConfirmation).toBe(true)
  })

  it('handler applies edit and returns success', async () => {
    fs.writeFileSync(tmpFile, 'function foo() { return 1 }')
    const result = await editFileDefinition.handler({
      path: tmpFile,
      old_string: 'return 1',
      new_string: 'return 2',
    })
    expect(result.success).toBe(true)
    expect(result.metadata?.filesWritten).toContain(tmpFile)
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe('function foo() { return 2 }')
  })

  it('handler returns failure when old_string not found', async () => {
    fs.writeFileSync(tmpFile, 'function foo() { return 1 }')
    const result = await editFileDefinition.handler({
      path: tmpFile,
      old_string: 'return 999',
      new_string: 'return 2',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('listFilesDefinition', () => {
  it('has correct metadata', () => {
    expect(listFilesDefinition.name).toBe('list_files')
    expect(listFilesDefinition.category).toBe('read')
    expect(listFilesDefinition.inputSchema.required).toContain('path')
  })

  it('handler lists directory contents', async () => {
    const result = await listFilesDefinition.handler({ path: path.join(__dirname, '../../..') })
    expect(result.success).toBe(true)
    expect(result.output).toContain('package.json')
    expect(result.output).toContain('src/')
  })

  it('handler lists recursively when flag is set', async () => {
    const result = await listFilesDefinition.handler({
      path: path.join(__dirname),
      recursive: true,
    })
    expect(result.success).toBe(true)
    // Should find files in this directory (not just top-level)
    expect(result.output).toContain('list-files.ts')
    expect(result.output).toContain('read-file.ts')
  })

  it('handler returns failure for nonexistent directory', async () => {
    const result = await listFilesDefinition.handler({ path: '/nonexistent/dir' })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})
