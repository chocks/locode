import fs from 'fs'
import os from 'os'
import path from 'path'

// Cost per million tokens (USD) as of 2026
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
}

export interface TurnRecord {
  agent: 'local' | 'claude'
  input: number
  output: number
  model: string
  timestamp?: number
}

export interface AgentStats {
  inputTokens: number
  outputTokens: number
  turns: number
  estimatedCostUsd: number
}

export interface TrackerStats {
  local: AgentStats
  claude: AgentStats
  total: { inputTokens: number; outputTokens: number; estimatedCostUsd: number }
  localRoutingPct: number
}

interface TrackerConfig {
  enabled: boolean
  log_file: string
}

export class TokenTracker {
  private records: TurnRecord[] = []
  private config: TrackerConfig

  constructor(config: TrackerConfig) {
    this.config = config
  }

  record(turn: TurnRecord): void {
    this.records.push({ ...turn, timestamp: Date.now() })
    if (this.config.enabled) {
      this.appendToLog(turn)
    }
  }

  getStats(): TrackerStats {
    const local = this.statsFor('local')
    const claude = this.statsFor('claude')
    const totalTurns = this.records.length
    const localTurns = this.records.filter(r => r.agent === 'local').length

    return {
      local,
      claude,
      total: {
        inputTokens: local.inputTokens + claude.inputTokens,
        outputTokens: local.outputTokens + claude.outputTokens,
        estimatedCostUsd: local.estimatedCostUsd + claude.estimatedCostUsd,
      },
      localRoutingPct: totalTurns > 0 ? (localTurns / totalTurns) * 100 : 0,
    }
  }

  reset(): void {
    this.records = []
  }

  private statsFor(agent: 'local' | 'claude'): AgentStats {
    const agentRecords = this.records.filter(r => r.agent === agent)
    const inputTokens = agentRecords.reduce((sum, r) => sum + r.input, 0)
    const outputTokens = agentRecords.reduce((sum, r) => sum + r.output, 0)
    const estimatedCostUsd = agentRecords.reduce((sum, r) => {
      const costs = MODEL_COSTS[r.model]
      if (!costs) return sum
      return sum + (r.input / 1_000_000) * costs.input + (r.output / 1_000_000) * costs.output
    }, 0)
    return { inputTokens, outputTokens, turns: agentRecords.length, estimatedCostUsd }
  }

  private appendToLog(turn: TurnRecord): void {
    try {
      const logPath = this.config.log_file.replace('~', os.homedir())
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      const line = JSON.stringify({ ...turn, timestamp: Date.now() }) + '\n'
      fs.appendFileSync(logPath, line)
    } catch {
      // non-fatal — logging failure should not crash the CLI
    }
  }
}
