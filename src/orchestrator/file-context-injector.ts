import * as fs from 'fs'

// Matches file paths: optional leading ./ or /, then path segments, then extension.
// Negative lookbehind excludes URLs (paths preceded by :// chars), email addresses,
// and hostname segments (paths preceded by a dot, e.g. example.com/path).
const FILE_PATH_REGEX = /(?<![:/\w@.])(?:\.{1,2}\/|\/)?(?:[\w\-]+\/)*[\w\-]+\.\w+/g

export function injectFileContext(prompt: string, maxFileBytes: number): string {
  const matches = [...new Set(prompt.match(FILE_PATH_REGEX) ?? [])]
  if (matches.length === 0) return prompt

  const injections: string[] = []

  for (const filePath of matches) {
    try {
      const stat = fs.statSync(filePath)
      const size = stat.size

      let content: string
      if (size > maxFileBytes) {
        const raw = fs.readFileSync(filePath, 'utf8')
        const truncated = raw.slice(0, maxFileBytes)
        const kb = Math.round(maxFileBytes / 1024)
        content = `[${filePath} — truncated at ${kb}KB, ${size} bytes total]\n${truncated}`
      } else {
        content = fs.readFileSync(filePath, 'utf8')
      }

      injections.push(`[File: ${filePath}]\n${content}`)
    } catch {
      // file not found or unreadable — skip silently
    }
  }

  if (injections.length === 0) return prompt
  return `${injections.join('\n\n')}\n\n---\n${prompt}`
}
