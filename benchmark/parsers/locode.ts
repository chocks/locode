export interface BenchmarkResult {
  mode: 'hybrid' | 'claude-only' | 'local-only'
  claudeInputTokens: number
  claudeOutputTokens: number
  estimatedCostUsd: number
  durationMs: number
  // keep these for routing breakdown
  localInputTokens: number
  localOutputTokens: number
  localRoutingPct: number
  localTurns: number
  claudeTurns: number
  // keep for compat
  tool: string
  inputTokens: number
  outputTokens: number
}

export function parseLocodeStats(statsJson: string, mode: BenchmarkResult['mode']): Partial<BenchmarkResult> {
  try {
    const stats = JSON.parse(statsJson)
    return {
      mode,
      tool: 'locode',
      inputTokens: stats.total.inputTokens,
      outputTokens: stats.total.outputTokens,
      localInputTokens: stats.local.inputTokens,
      localOutputTokens: stats.local.outputTokens,
      claudeInputTokens: stats.claude.inputTokens,
      claudeOutputTokens: stats.claude.outputTokens,
      localRoutingPct: stats.localRoutingPct,
      estimatedCostUsd: stats.total.estimatedCostUsd,
      localTurns: stats.local.turns,
      claudeTurns: stats.claude.turns,
    }
  } catch {
    return {}
  }
}
