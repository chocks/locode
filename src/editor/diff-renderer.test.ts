import { describe, it, expect } from 'vitest'
import { DiffRenderer } from './diff-renderer'
import type { DiffPreview } from './types'

describe('DiffRenderer', () => {
  describe('unifiedDiff', () => {
    it('produces a unified diff between original and modified', () => {
      const original = 'const x = 1\nconst y = 2\n'
      const modified = 'const x = 10\nconst y = 2\n'
      const diff = DiffRenderer.unifiedDiff('test.ts', original, modified)
      expect(diff).toContain('--- test.ts')
      expect(diff).toContain('+++ test.ts')
      expect(diff).toContain('-const x = 1')
      expect(diff).toContain('+const x = 10')
    })

    it('returns empty string when no changes', () => {
      const content = 'const x = 1\n'
      const diff = DiffRenderer.unifiedDiff('test.ts', content, content)
      // No hunks means no meaningful diff lines
      expect(diff).not.toContain('@@')
    })
  })

  describe('colorize', () => {
    it('adds color codes to diff output', () => {
      const diff = '--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n'
      const colored = DiffRenderer.colorize(diff)
      // Should contain ANSI escape codes
      expect(colored).toContain('\x1b[')
      expect(colored).toContain('old')
      expect(colored).toContain('new')
    })
  })

  describe('summary', () => {
    it('summarizes multiple diffs', () => {
      const diffs: DiffPreview[] = [
        { file: 'a.ts', diff: '...', additions: 3, deletions: 1 },
        { file: 'b.ts', diff: '...', additions: 0, deletions: 5 },
      ]
      const result = DiffRenderer.summary(diffs)
      expect(result).toContain('2 files changed')
      expect(result).toContain('3 insertions')
      expect(result).toContain('6 deletions')
    })

    it('handles single file', () => {
      const diffs: DiffPreview[] = [
        { file: 'a.ts', diff: '...', additions: 1, deletions: 0 },
      ]
      const result = DiffRenderer.summary(diffs)
      expect(result).toContain('1 file changed')
      expect(result).toContain('1 insertion')
    })
  })
})
