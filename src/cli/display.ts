import { TrackerStats } from '../tracker/tracker'

export function printStats(stats: TrackerStats): void {
  console.log('\n--- Session Stats ---')
  console.log(`Local turns:  ${stats.local.turns} | Tokens in/out: ${stats.local.inputTokens}/${stats.local.outputTokens}`)
  console.log(`Claude turns: ${stats.claude.turns} | Tokens in/out: ${stats.claude.inputTokens}/${stats.claude.outputTokens}`)
  console.log(`Total cost:   $${stats.total.estimatedCostUsd.toFixed(4)}`)
  console.log(`Local routing: ${stats.localRoutingPct.toFixed(1)}%`)
  console.log('---------------------\n')
}

export function printResult(content: string, agent: string, method: string): void {
  const label = agent === 'local' ? '[local]' : '[claude]'
  const dim = agent === 'local' ? '\x1b[2m' : ''
  const reset = '\x1b[0m'
  console.log(`\n${dim}${label} (${method})${reset}`)
  console.log(content)
}
