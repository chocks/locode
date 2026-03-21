import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CodeEditor } from './code-editor'
import { SafetyGate } from '../tools/safety-gate'
import type { EditOperation } from './types'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('CodeEditor', () => {
  let editor: CodeEditor
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locode-editor-'))
    const gate = new SafetyGate({
      always_confirm: [],
      auto_approve: [],
      allowed_write_paths: [tmpDir],
    })
    editor = new CodeEditor(gate, tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeFixture(name: string, content: string): string {
    const filePath = path.join(tmpDir, name)
    fs.writeFileSync(filePath, content, 'utf8')
    return filePath
  }

  describe('applyEdits — search-based', () => {
    it('replaces a unique search match', async () => {
      const file = writeFixture('a.ts', 'const x = 1\nconst y = 2\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'const x = 1', content: 'const x = 10',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(result.failed).toHaveLength(0)
      expect(fs.readFileSync(file, 'utf8')).toBe('const x = 10\nconst y = 2\n')
    })

    it('inserts content after a search match', async () => {
      const file = writeFixture('b.ts', 'import a from "a"\n\nfunction main() {}\n')
      const edits: EditOperation[] = [{
        file, operation: 'insert',
        search: 'import a from "a"', content: 'import b from "b"',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toContain('import a from "a"\nimport b from "b"\n')
    })

    it('deletes the line containing a search match', async () => {
      const file = writeFixture('c.ts', 'line1\nline2\nline3\n')
      const edits: EditOperation[] = [{
        file, operation: 'delete', search: 'line2',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toBe('line1\nline3\n')
    })

    it('fails when search matches multiple locations', async () => {
      const file = writeFixture('d.ts', 'const x = 1\nconst x = 1\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'const x = 1', content: 'const x = 2',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error).toContain('multiple')
    })

    it('fails when search finds no match', async () => {
      const file = writeFixture('e.ts', 'const x = 1\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'const y = 2', content: 'const y = 3',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error).toContain('not found')
    })
  })

  describe('applyEdits — line-based', () => {
    it('replaces lines by startLine/endLine', async () => {
      const file = writeFixture('f.ts', 'line1\nline2\nline3\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        startLine: 2, endLine: 2, content: 'replaced',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toBe('line1\nreplaced\nline3\n')
    })

    it('inserts after a line number', async () => {
      const file = writeFixture('g.ts', 'line1\nline2\n')
      const edits: EditOperation[] = [{
        file, operation: 'insert',
        afterLine: 1, content: 'inserted',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toBe('line1\ninserted\nline2\n')
    })

    it('inserts at beginning with afterLine: 0', async () => {
      const file = writeFixture('h.ts', 'line1\n')
      const edits: EditOperation[] = [{
        file, operation: 'insert',
        afterLine: 0, content: 'first',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toBe('first\nline1\n')
    })
  })

  describe('applyEdits — create', () => {
    it('creates a new file', async () => {
      const file = path.join(tmpDir, 'new-file.ts')
      const edits: EditOperation[] = [{
        file, operation: 'create', content: 'export const x = 1\n',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.applied).toHaveLength(1)
      expect(fs.readFileSync(file, 'utf8')).toBe('export const x = 1\n')
    })
  })

  describe('applyEdits — safety', () => {
    it('rejects writes outside allowed paths', async () => {
      const edits: EditOperation[] = [{
        file: '/etc/passwd', operation: 'create', content: 'nope',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].error).toContain('outside allowed')
    })
  })

  describe('applyEdits — originals for rollback', () => {
    it('stores original content before modifying', async () => {
      const file = writeFixture('orig.ts', 'original content\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'original content', content: 'new content',
      }]
      const result = await editor.applyEdits(edits)
      expect(result.originals.get(file)).toBe('original content\n')
    })
  })

  describe('rollback', () => {
    it('restores files to their original content', async () => {
      const file = writeFixture('rollback.ts', 'before\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'before', content: 'after',
      }]
      const result = await editor.applyEdits(edits)
      expect(fs.readFileSync(file, 'utf8')).toBe('after\n')

      await editor.rollback(result)
      expect(fs.readFileSync(file, 'utf8')).toBe('before\n')
    })
  })

  describe('preview', () => {
    it('returns diffs without modifying files', async () => {
      const file = writeFixture('preview.ts', 'const x = 1\n')
      const edits: EditOperation[] = [{
        file, operation: 'replace',
        search: 'const x = 1', content: 'const x = 2',
      }]
      const previews = await editor.preview(edits)
      expect(previews).toHaveLength(1)
      expect(previews[0].diff).toContain('-const x = 1')
      expect(previews[0].diff).toContain('+const x = 2')
      expect(previews[0].additions).toBe(1)
      expect(previews[0].deletions).toBe(1)
      // File unchanged
      expect(fs.readFileSync(file, 'utf8')).toBe('const x = 1\n')
    })
  })
})
