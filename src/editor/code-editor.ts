import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { applyPatch, createTwoFilesPatch, parsePatch } from 'diff'
import type { SafetyGate } from '../tools/safety-gate'
import type { EditOperation, ApplyResult, DiffPreview } from './types'

export class CodeEditor {
  constructor(
    private safetyGate: SafetyGate,
    private cwd: string,
  ) {}

  async applyEdits(edits: EditOperation[]): Promise<ApplyResult> {
    const applied: EditOperation[] = []
    const failed: Array<{ edit: EditOperation; error: string }> = []
    const originals = new Map<string, string | null>()

    for (const edit of edits) {
      try {
        const resolved = path.resolve(this.cwd, edit.file)

        // Safety check
        const check = this.safetyGate.checkWritePath(resolved)
        if (!check.allowed) {
          failed.push({ edit, error: check.reason })
          continue
        }

        if (edit.operation === 'create') {
          const dir = path.dirname(resolved)
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
          }
          // Store original if file existed
          if (fs.existsSync(resolved)) {
            originals.set(resolved, fs.readFileSync(resolved, 'utf8'))
          } else if (!originals.has(resolved)) {
            originals.set(resolved, null)
          }
          fs.writeFileSync(resolved, edit.content ?? '', 'utf8')
          applied.push(edit)
          continue
        }

        // For insert/replace/delete, file must exist
        if (!fs.existsSync(resolved)) {
          failed.push({ edit, error: `File not found: ${edit.file}` })
          continue
        }

        const original = fs.readFileSync(resolved, 'utf8')
        if (!originals.has(resolved)) {
          originals.set(resolved, original)
        }

        this.verifyPrecondition(original, edit)
        const modified = this.applyEdit(original, edit)
        fs.writeFileSync(resolved, modified, 'utf8')
        applied.push(edit)
      } catch (err) {
        failed.push({ edit, error: (err as Error).message })
      }
    }

    return { applied, failed, originals }
  }

  async rollback(result: ApplyResult): Promise<void> {
    for (const [filePath, original] of result.originals) {
      if (original === null) {
        fs.rmSync(filePath, { force: true })
      } else {
        fs.writeFileSync(filePath, original, 'utf8')
      }
    }
  }

  async preview(edits: EditOperation[]): Promise<DiffPreview[]> {
    const previews: DiffPreview[] = []

    for (const edit of edits) {
      const resolved = path.resolve(this.cwd, edit.file)

      if (edit.operation === 'create') {
        const content = edit.content ?? ''
        const diff = createTwoFilesPatch(edit.file, edit.file, '', content)
        const additions = content.split('\n').filter(l => l.length > 0).length
        previews.push({ file: edit.file, diff, additions, deletions: 0 })
        continue
      }

      if (!fs.existsSync(resolved)) continue

      const original = fs.readFileSync(resolved, 'utf8')
      try {
        this.verifyPrecondition(original, edit)
        const modified = this.applyEdit(original, edit)
        const diff = createTwoFilesPatch(edit.file, edit.file, original, modified)
        const lines = diff.split('\n')
        let additions = 0
        let deletions = 0
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) additions++
          if (line.startsWith('-') && !line.startsWith('---')) deletions++
        }
        previews.push({ file: edit.file, diff, additions, deletions })
      } catch {
        // Skip edits that would fail (e.g., search not found)
      }
    }

    return previews
  }

  private applyEdit(content: string, edit: EditOperation): string {
    if (edit.patch) {
      return this.applyPatchEdit(content, edit)
    }
    // Search-based takes precedence
    if (edit.search !== undefined) {
      return this.applySearchEdit(content, edit)
    }
    return this.applyLineEdit(content, edit)
  }

  private verifyPrecondition(content: string, edit: EditOperation): void {
    if (!edit.precondition) return

    if (edit.precondition.fileHash) {
      const hash = crypto.createHash('sha256').update(content).digest('hex')
      if (hash !== edit.precondition.fileHash) {
        throw new Error(`Edit precondition failed in ${edit.file}: file hash changed`)
      }
    }

    if (edit.precondition.mustContain) {
      for (const fragment of edit.precondition.mustContain) {
        if (!content.includes(fragment)) {
          throw new Error(`Edit precondition failed in ${edit.file}: required content missing`)
        }
      }
    }
  }

  private applySearchEdit(content: string, edit: EditOperation): string {
    const search = edit.search!
    const occurrences = content.split(search).length - 1

    if (occurrences === 0) {
      throw new Error(`Search string not found in ${edit.file}`)
    }
    if (occurrences > 1) {
      throw new Error(`Search string matches multiple locations (${occurrences}) in ${edit.file}`)
    }

    switch (edit.operation) {
      case 'replace':
        return content.replace(search, edit.content ?? '')

      case 'insert': {
        // Insert content AFTER the line containing the search match
        const lines = content.split('\n')
        const lineIdx = lines.findIndex(line => line.includes(search))
        lines.splice(lineIdx + 1, 0, edit.content ?? '')
        return lines.join('\n')
      }

      case 'delete': {
        // Delete the line(s) containing the search match
        const lines = content.split('\n')
        const filtered = lines.filter(line => !line.includes(search))
        return filtered.join('\n')
      }

      default:
        throw new Error(`Unsupported operation with search: ${edit.operation}`)
    }
  }

  private applyPatchEdit(content: string, edit: EditOperation): string {
    const patch = edit.patch!
    try {
      const modified = applyPatch(content, patch.unifiedDiff)
      if (modified !== false) {
        return modified
      }
    } catch {
      // Fall back to strict exact-match hunk replacement below.
    }

    const modified = this.applyPatchByExactHunks(content, patch.unifiedDiff, edit.file)
    if (modified === false) {
      throw new Error(`Unified patch could not be applied to ${edit.file}`)
    }
    return modified
  }

  private applyPatchByExactHunks(content: string, unifiedDiff: string, file: string): string | false {
    const parsed = parsePatch(unifiedDiff)
    if (parsed.length !== 1) {
      return false
    }

    let nextContent = content
    for (const hunk of parsed[0].hunks) {
      const source = hunk.lines
        .filter(line => line.startsWith(' ') || line.startsWith('-'))
        .map(line => line.slice(1))
        .join('\n')
      const target = hunk.lines
        .filter(line => line.startsWith(' ') || line.startsWith('+'))
        .map(line => line.slice(1))
        .join('\n')

      const occurrences = nextContent.split(source).length - 1
      if (occurrences === 0) {
        throw new Error(`Unified patch fallback could not find exact hunk in ${file}`)
      }
      if (occurrences > 1) {
        throw new Error(`Unified patch fallback matched multiple locations in ${file}`)
      }

      nextContent = nextContent.replace(source, target)
    }

    return nextContent
  }

  private applyLineEdit(content: string, edit: EditOperation): string {
    const lines = content.split('\n')

    switch (edit.operation) {
      case 'replace': {
        const start = (edit.startLine ?? 1) - 1
        const end = (edit.endLine ?? edit.startLine ?? 1) - 1
        const newLines = (edit.content ?? '').split('\n')
        lines.splice(start, end - start + 1, ...newLines)
        return lines.join('\n')
      }

      case 'insert': {
        const after = edit.afterLine ?? 0
        const newLines = (edit.content ?? '').split('\n')
        lines.splice(after, 0, ...newLines)
        return lines.join('\n')
      }

      case 'delete': {
        const start = (edit.startLine ?? 1) - 1
        const end = (edit.endLine ?? edit.startLine ?? 1) - 1
        lines.splice(start, end - start + 1)
        return lines.join('\n')
      }

      default:
        throw new Error(`Unsupported line operation: ${edit.operation}`)
    }
  }
}
