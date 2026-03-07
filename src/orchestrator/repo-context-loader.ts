import * as fs from 'fs'
import { execFileSync } from 'child_process'
import * as path from 'path'

function getRepoRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim()
  } catch {
    return process.cwd()
  }
}

export function loadRepoContext(files: string[], maxBytes: number): string {
  if (files.length === 0) return ''

  const root = getRepoRoot()
  const sections: string[] = []

  for (const file of files) {
    const filePath = path.join(root, file)
    try {
      const stat = fs.statSync(filePath)
      let content: string
      if (stat.size > maxBytes) {
        const raw = fs.readFileSync(filePath, 'utf8')
        const truncated = raw.slice(0, maxBytes)
        content = `[${file} — truncated at ${Math.round(maxBytes / 1024)}KB, ${stat.size} bytes total]\n${truncated}`
      } else {
        content = fs.readFileSync(filePath, 'utf8')
      }
      sections.push(`--- ${file} ---\n${content}`)
    } catch {
      // file not found or unreadable — skip silently
    }
  }

  return sections.join('\n\n')
}
