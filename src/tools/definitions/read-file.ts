import type { ToolDefinition } from '../registry'
import { readFileTool } from '../readFile'

export const readFileDefinition: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file' },
    },
    required: ['path'],
  },
  category: 'read',
  async handler(args) {
    const filePath = args.path as string
    const output = await readFileTool({ path: filePath })
    if (output.startsWith('Error')) {
      return { success: false, output: '', error: output }
    }
    return { success: true, output, metadata: { filesRead: [filePath] } }
  },
}
