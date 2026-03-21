import { createTwoFilesPatch } from 'diff'
import type { DiffPreview } from './types'

const BOLD = '\x1b[1m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

export class DiffRenderer {
  static unifiedDiff(file: string, original: string, modified: string): string {
    return createTwoFilesPatch(file, file, original, modified)
  }

  static colorize(diff: string): string {
    return diff
      .split('\n')
      .map(line => {
        if (line.startsWith('+++') || line.startsWith('---')) return `${BOLD}${line}${RESET}`
        if (line.startsWith('@@')) return `${CYAN}${line}${RESET}`
        if (line.startsWith('+')) return `${GREEN}${line}${RESET}`
        if (line.startsWith('-')) return `${RED}${line}${RESET}`
        return line
      })
      .join('\n')
  }

  static summary(diffs: DiffPreview[]): string {
    const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0)
    const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0)
    const fileCount = diffs.length
    const fileWord = fileCount === 1 ? 'file' : 'files'
    const addWord = totalAdditions === 1 ? 'insertion' : 'insertions'
    const delWord = totalDeletions === 1 ? 'deletion' : 'deletions'

    const parts = [`${fileCount} ${fileWord} changed`]
    if (totalAdditions > 0) parts.push(`${totalAdditions} ${addWord}(+)`)
    if (totalDeletions > 0) parts.push(`${totalDeletions} ${delWord}(-)`)

    return parts.join(', ')
  }
}
