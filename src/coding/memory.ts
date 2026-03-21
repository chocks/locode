import type { MemorySnapshot } from './types'
import type { EditOperation } from '../editor/types'

export interface MemoryEntry {
  timestamp: number
  type: 'file_read' | 'file_write' | 'search' | 'command' | 'edit' | 'error'
  detail: string
  result?: string
}

export class AgentMemory {
  private entries: MemoryEntry[] = []
  private sessionStart: number = Date.now()

  constructor(private maxEntries: number = 50) {}

  record(entry: Omit<MemoryEntry, 'timestamp'>): void {
    this.entries.push({ ...entry, timestamp: Date.now() })
    if (this.entries.length > this.maxEntries) {
      this.entries.shift()
    }
  }

  getSnapshot(): MemorySnapshot {
    const recentFiles = this.getRecentFiles()
    const recentEdits: EditOperation[] = [] // populated when edit entries carry structured data
    const recentCommands = [...new Set(
      this.entries.filter(e => e.type === 'command').map(e => e.detail)
    )]
    const recentErrors = this.entries.filter(e => e.type === 'error').map(e => e.detail)

    return { recentFiles, recentEdits, recentCommands, recentErrors, sessionStart: this.sessionStart }
  }

  getRecentFiles(n?: number): string[] {
    const fileEntries = this.entries.filter(e => e.type === 'file_read' || e.type === 'file_write')
    const unique = [...new Set(fileEntries.map(e => e.detail))]
    return n ? unique.slice(0, n) : unique
  }

  toPromptContext(): string {
    if (this.entries.length === 0) {
      return 'Session context: No prior activity in this session.'
    }

    const files = this.getRecentFiles()
    const errors = this.entries.filter(e => e.type === 'error').slice(-3)
    const commands = [...new Set(
      this.entries.filter(e => e.type === 'command').map(e => e.detail)
    )].slice(-3)

    const parts: string[] = ['Session context:']
    if (files.length > 0) parts.push(`Files accessed: ${files.join(', ')}`)
    if (commands.length > 0) parts.push(`Recent commands: ${commands.join(', ')}`)
    if (errors.length > 0) parts.push(`Recent errors: ${errors.map(e => e.detail).join('; ')}`)

    return parts.join('\n')
  }

  clear(): void {
    this.entries = []
    this.sessionStart = Date.now()
  }
}
