import type { ToolDefinition } from '../registry'
import { execFileSync } from 'child_process'

interface SearchResult {
  file: string
  line: number
  match: string
}

export const searchCodeDefinition: ToolDefinition = {
  name: 'search_code',
  description: 'Search for a pattern in project files using grep. Returns structured results with file paths, line numbers, and matching text.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      glob: { type: 'string', description: 'File glob filter (e.g., "*.ts", "*.test.ts")' },
      max_results: { type: 'number', description: 'Maximum number of results to return (default: 20)' },
    },
    required: ['pattern'],
  },
  category: 'search',
  async handler(args) {
    const pattern = args.pattern as string
    const glob = args.glob as string | undefined
    const maxResults = (args.max_results as number) ?? 20

    // Only pass --include when a glob is specified; without it grep searches all files
    const grepArgs = glob
      ? ['-rn', '--include', glob, pattern, '.']
      : ['-rn', pattern, '.']
    try {
      const stdout = execFileSync('grep', grepArgs, {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      })

      const results: SearchResult[] = stdout
        .split('\n')
        .filter(line => line.length > 0)
        .slice(0, maxResults)
        .map(line => {
          const firstColon = line.indexOf(':')
          const secondColon = line.indexOf(':', firstColon + 1)
          const file = line.slice(0, firstColon).replace(/^\.\//, '')
          const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10)
          const match = line.slice(secondColon + 1).trim()
          return { file, line: lineNum, match }
        })

      return { success: true, output: JSON.stringify(results) }
    } catch (err) {
      const error = err as { status?: number; message?: string }
      if (error.status === 1) {
        return { success: true, output: JSON.stringify([]) }
      }
      return { success: false, output: '', error: `Search failed: ${error.message}` }
    }
  },
}
