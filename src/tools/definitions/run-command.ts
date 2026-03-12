import type { ToolDefinition } from '../registry'
import { shellTool } from '../shell'

export const runCommandDefinition: ToolDefinition = {
  name: 'run_command',
  description: 'Run a read-only shell command. Allowed: ls, cat, head, tail, grep, find, wc, file, stat, pwd, du',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run' },
    },
    required: ['command'],
  },
  category: 'shell',
  async handler(args) {
    const command = args.command as string
    const output = await shellTool({ command })
    if (output.startsWith('[blocked]') || output.startsWith('Error')) {
      return { success: false, output: '', error: output }
    }
    return { success: true, output }
  },
}
