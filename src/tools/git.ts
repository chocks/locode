import { execFileSync } from 'child_process'

const ALLOWED_GIT = ['log', 'diff', 'status', 'blame', 'show', 'branch', 'tag', 'ls-files']

export async function gitTool({ args }: { args: string }): Promise<string> {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]
  if (!ALLOWED_GIT.includes(subcommand)) {
    return `[blocked] git ${subcommand} requires write access. Use Claude agent.`
  }
  try {
    return execFileSync('git', parts, { encoding: 'utf8', timeout: 10000 })
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }
}
