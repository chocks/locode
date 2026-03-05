import { execSync } from 'child_process'

const ALLOWED_GIT = ['log', 'diff', 'status', 'blame', 'show', 'branch', 'tag', 'ls-files']

export async function gitTool({ args }: { args: string }): Promise<string> {
  const subcommand = args.trim().split(/\s+/)[0]
  if (!ALLOWED_GIT.includes(subcommand)) {
    return `[blocked] git ${subcommand} requires write access. Use Claude agent.`
  }
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', timeout: 10000 })
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }
}
