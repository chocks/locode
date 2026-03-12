import { execFileSync } from 'child_process'

const ALLOWED_COMMANDS = new Set([
  'ls', 'cat', 'find', 'grep', 'head', 'tail', 'wc',
  'echo', 'pwd', 'env', 'which', 'file', 'stat',
  'du', 'df', 'ps', 'uname', 'date',
])

const SHELL_OPERATORS = /[|;&`$()]/

export async function shellTool({ command }: { command: string }): Promise<string> {
  if (SHELL_OPERATORS.test(command)) {
    return `[blocked] Shell operators (pipe, semicolon, etc.) are not supported. Run each command separately.`
  }
  const parts = command.trim().split(/\s+/)
  const base = (parts[0].split('/').pop() ?? parts[0])
  if (!ALLOWED_COMMANDS.has(base)) {
    return `[blocked] Command "${base}" is not in the allow-list. Use Claude agent for write operations.`
  }
  try {
    return execFileSync(parts[0], parts.slice(1), { encoding: 'utf8', timeout: 10000 })
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }
}
