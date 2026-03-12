import type { ToolDefinition } from '../registry'
import { gitTool } from '../git'

export const gitQueryDefinition: ToolDefinition = {
  name: 'git_query',
  description: 'Run a read-only git command (log, diff, status, blame, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      args: { type: 'string', description: 'Git subcommand and arguments, e.g. "log --oneline -10"' },
    },
    required: ['args'],
  },
  category: 'git',
  async handler(handlerArgs) {
    const gitArgs = handlerArgs.args as string
    const output = await gitTool({ args: gitArgs })
    if (output.startsWith('[blocked]') || output.startsWith('Error')) {
      return { success: false, output: '', error: output }
    }
    return { success: true, output }
  },
}
