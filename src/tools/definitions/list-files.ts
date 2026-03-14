import fs from 'fs'
import path from 'path'
import type { ToolDefinition } from '../registry'

export const listFilesDefinition: ToolDefinition = {
  name: 'list_files',
  description: 'List files and directories in a given path',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list' },
      recursive: { type: 'boolean', description: 'List recursively (default: false)' },
    },
    required: ['path'],
  },
  category: 'read',
  handler(args) {
    const dirPath = args.path as string
    const recursive = (args.recursive as boolean) ?? false

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true, recursive })
      const lines = entries.map(entry => {
        const dirent = entry as fs.Dirent & { parentPath?: string; path?: string }
        const name = recursive
          ? path.join(String(dirent.parentPath ?? dirent.path ?? ''), entry.name)
          : entry.name
        const relativeName = recursive ? path.relative(dirPath, name) : name
        return entry.isDirectory() ? `${relativeName}/` : relativeName
      })
      return Promise.resolve({
        success: true,
        output: lines.sort().join('\n'),
        metadata: { filesRead: [dirPath] },
      })
    } catch (err) {
      return Promise.resolve({
        success: false,
        output: '',
        error: `Error: ${(err as Error).message}`,
      })
    }
  },
}
