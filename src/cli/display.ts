import { TrackerStats } from '../tracker/tracker'

export function printStats(stats: TrackerStats): void {
  console.log('\n--- Session Stats ---')
  console.log(`Local turns:  ${stats.local.turns} | Tokens in/out: ${stats.local.inputTokens}/${stats.local.outputTokens}`)
  console.log(`Claude turns: ${stats.claude.turns} | Tokens in/out: ${stats.claude.inputTokens}/${stats.claude.outputTokens}`)
  console.log(`Total cost:   $${stats.total.estimatedCostUsd.toFixed(4)}`)
  console.log(`Local routing: ${stats.localRoutingPct.toFixed(1)}%`)
  console.log('---------------------\n')
}

export function printResult(content: string, agent: string, method: string, reason?: string): void {
  const label = agent === 'local' ? '\x1b[36m⚡ local\x1b[0m' : '\x1b[35m🧠 claude\x1b[0m'
  const reasonText = reason ? ` \x1b[2m— ${reason}\x1b[0m` : ''
  console.log(`\n${label}${reasonText}`)
  console.log(content)
}

export type PromptMode = 'hybrid' | 'local' | 'claude'

export function formatPrompt(mode: PromptMode): string {
  switch (mode) {
    case 'local':
      return '\x1b[36m> local\x1b[0m '
    case 'claude':
      return '\x1b[35m> claude\x1b[0m '
    default:
      return '\x1b[32m>\x1b[0m '
  }
}

export function formatContinuation(): string {
  return '\x1b[2m...\x1b[0m '
}
