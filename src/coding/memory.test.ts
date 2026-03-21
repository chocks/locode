import { describe, it, expect, beforeEach } from 'vitest'
import { AgentMemory } from './memory'

describe('AgentMemory', () => {
  let memory: AgentMemory

  beforeEach(() => {
    memory = new AgentMemory()
  })

  describe('record', () => {
    it('stores entries with timestamps', () => {
      memory.record({ type: 'file_read', detail: 'src/index.ts' })
      const snapshot = memory.getSnapshot()
      expect(snapshot.recentFiles).toContain('src/index.ts')
    })

    it('evicts oldest entries when maxEntries is exceeded', () => {
      const small = new AgentMemory(3)
      small.record({ type: 'file_read', detail: 'a.ts' })
      small.record({ type: 'file_read', detail: 'b.ts' })
      small.record({ type: 'file_read', detail: 'c.ts' })
      small.record({ type: 'file_read', detail: 'd.ts' })
      const snapshot = small.getSnapshot()
      expect(snapshot.recentFiles).not.toContain('a.ts')
      expect(snapshot.recentFiles).toContain('d.ts')
    })
  })

  describe('getSnapshot', () => {
    it('returns categorized entries', () => {
      memory.record({ type: 'file_read', detail: 'src/a.ts' })
      memory.record({ type: 'command', detail: 'npm test' })
      memory.record({ type: 'error', detail: 'TypeError: x is undefined' })
      memory.record({ type: 'edit', detail: 'replaced x=1 with x=2 in src/a.ts' })

      const snapshot = memory.getSnapshot()
      expect(snapshot.recentFiles).toContain('src/a.ts')
      expect(snapshot.recentCommands).toContain('npm test')
      expect(snapshot.recentErrors).toContain('TypeError: x is undefined')
      expect(snapshot.sessionStart).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('getRecentFiles', () => {
    it('returns unique file paths', () => {
      memory.record({ type: 'file_read', detail: 'a.ts' })
      memory.record({ type: 'file_read', detail: 'b.ts' })
      memory.record({ type: 'file_read', detail: 'a.ts' }) // duplicate
      expect(memory.getRecentFiles()).toEqual(['a.ts', 'b.ts'])
    })

    it('limits to n results', () => {
      memory.record({ type: 'file_read', detail: 'a.ts' })
      memory.record({ type: 'file_read', detail: 'b.ts' })
      memory.record({ type: 'file_read', detail: 'c.ts' })
      expect(memory.getRecentFiles(2)).toHaveLength(2)
    })
  })

  describe('toPromptContext', () => {
    it('produces compact text', () => {
      memory.record({ type: 'file_read', detail: 'src/a.ts' })
      memory.record({ type: 'error', detail: 'build failed' })
      const context = memory.toPromptContext()
      expect(context).toContain('src/a.ts')
      expect(context).toContain('build failed')
      // Should be compact
      expect(context.length).toBeLessThan(2000)
    })

    it('returns empty note when no entries', () => {
      const context = memory.toPromptContext()
      expect(context).toContain('No prior activity')
    })
  })

  describe('clear', () => {
    it('removes all entries', () => {
      memory.record({ type: 'file_read', detail: 'a.ts' })
      memory.clear()
      expect(memory.getRecentFiles()).toEqual([])
    })
  })
})
