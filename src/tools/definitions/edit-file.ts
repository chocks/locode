import type { ToolDefinition } from '../registry'
import { editFileTool } from '../editFile'
import pathMod from 'path'

export const editFileDefinition: ToolDefinition = {
  name: 'edit_file',
  description: 'Edit a file by replacing an exact string match. The old_string must appear exactly once in the file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit' },
      old_string: { type: 'string', description: 'The exact string to find (must be unique in file)' },
      new_string: { type: 'string', description: 'The replacement string' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  category: 'write',
  requiresConfirmation: true,
  async handler(args) {
    const filePath = args.path as string
    const oldString = args.old_string as string
    const newString = args.new_string as string
    const output = await editFileTool({ path: filePath, old_string: oldString, new_string: newString })
    if (output.startsWith('Error') || output.includes('not found') || output.includes('multiple')) {
      return { success: false, output: '', error: output }
    }
    const resolved = pathMod.resolve(filePath)
    return { success: true, output, metadata: { filesWritten: [resolved] } }
  },
}
