import { execSync } from 'child_process'

// Patterns that indicate write/destructive operations — blocked for local agent
const BLOCKED_PATTERNS = [
  /\brm\s/, /\bmv\s/, /\bcp\s.*>/, /\bchmod\b/, /\bchown\b/,
  /\bdd\b/, /\bmkdir\b/, /\btouch\b/, /\btee\b/, />\s*\w/,
  /\bnpm\s+install\b/, /\bpip\s+install\b/, /\bgit\s+push\b/,
  /\bgit\s+commit\b/, /\bgit\s+reset\b/,
]

export async function shellTool({ command }: { command: string }): Promise<string> {
  if (BLOCKED_PATTERNS.some(p => p.test(command))) {
    return `[blocked] Command "${command}" requires write access. Escalating to Claude agent.`
  }
  try {
    return execSync(command, { encoding: 'utf8', timeout: 10000 })
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }
}
