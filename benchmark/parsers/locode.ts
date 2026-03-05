export interface BenchmarkResult {
  tool: string
  inputTokens: number
  outputTokens: number
  localInputTokens: number
  localOutputTokens: number
  claudeInputTokens: number
  claudeOutputTokens: number
  localRoutingPct: number
  estimatedCostUsd: number
  durationMs: number
}

export function parseLocodeStats(statsJson: string): Partial<BenchmarkResult> {
  try {
    const stats = JSON.parse(statsJson)
    return {
      tool: 'locode',
      inputTokens: stats.total.inputTokens,
      outputTokens: stats.total.outputTokens,
      localInputTokens: stats.local.inputTokens,
      localOutputTokens: stats.local.outputTokens,
      claudeInputTokens: stats.claude.inputTokens,
      claudeOutputTokens: stats.claude.outputTokens,
      localRoutingPct: stats.localRoutingPct,
      estimatedCostUsd: stats.total.estimatedCostUsd,
    }
  } catch {
    return {}
  }
}
