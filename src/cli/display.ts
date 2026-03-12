import { TrackerStats } from '../tracker/tracker'

export function printStats(stats: TrackerStats): void {
  console.log('\n--- Session Stats ---')
  console.log(`Local turns:  ${stats.local.turns} | Tokens in/out: ${stats.local.inputTokens}/${stats.local.outputTokens}`)
  console.log(`Claude turns: ${stats.claude.turns} | Tokens in/out: ${stats.claude.inputTokens}/${stats.claude.outputTokens}`)
  console.log(`Total cost:   $${stats.total.estimatedCostUsd.toFixed(4)}`)
  console.log(`Local routing: ${stats.localRoutingPct.toFixed(1)}%`)
  console.log('---------------------\n')
}

export function printResult(content: string, agent: string, method: string, reason?: string, modelName?: string): void {
  const name = modelName ? `${agent}:${modelName}` : agent
  const label = agent === 'local' ? `\x1b[36m⚡ ${name}\x1b[0m` : `\x1b[35m🧠 ${name}\x1b[0m`
  const reasonText = reason ? ` \x1b[2m— ${reason}\x1b[0m` : ''
  console.log(`\n${label}${reasonText}`)
  console.log(content)
}

export type PromptMode = 'hybrid' | 'local' | 'claude'

export function formatPrompt(mode: PromptMode, modelName?: string): string {
  switch (mode) {
    case 'local':
      return `\x1b[36m> (${modelName ?? 'local'})\x1b[0m `
    case 'claude':
      return `\x1b[35m> (${modelName ?? 'claude'})\x1b[0m `
    default:
      return '\x1b[32m>\x1b[0m '
  }
}

export function formatSeparator(width?: number): string {
  const cols = width ?? process.stdout.columns ?? 80
  return `\x1b[2m${'─'.repeat(cols)}\x1b[0m`
}

export function formatContinuation(): string {
  return '\x1b[2m...\x1b[0m '
}
