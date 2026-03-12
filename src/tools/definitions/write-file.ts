import type { ToolDefinition } from '../registry'
import { writeFileTool } from '../writeFile'
import pathMod from 'path'

export const writeFileDefinition: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file, creating it if needed or overwriting if it exists',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'The full content to write' },
    },
    required: ['path', 'content'],
  },
  category: 'write',
  requiresConfirmation: true,
  async handler(args) {
    const filePath = args.path as string
    const content = args.content as string
    const output = await writeFileTool({ path: filePath, content })
    if (output.startsWith('[blocked]') || output.startsWith('Error')) {
      return { success: false, output: '', error: output }
    }
    const resolved = pathMod.resolve(filePath)
    return { success: true, output, metadata: { filesWritten: [resolved] } }
  },
}
