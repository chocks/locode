import { Router, AgentType } from './router'
import { LocalAgent, AgentResult } from '../agents/local'
import { ClaudeAgent, ClaudeAgentResult } from '../agents/claude'
import { TokenTracker } from '../tracker/tracker'
import type { Config } from '../config/schema'

export interface OrchestratorResult extends AgentResult {
  agent: AgentType
  routeMethod: 'rule' | 'llm'
}

interface OrchestratorOptions {
  localOnly?: boolean
  claudeOnly?: boolean
}

export class Orchestrator {
  private router: Router
  private localAgent: LocalAgent
  private claudeAgent: ClaudeAgent
  private tracker: TokenTracker
  private config: Config
  private localOnly: boolean
  private claudeOnly: boolean
  private localFallback: boolean = false
  private fallbackSummary: string = ''
  private resetsAt: number = 0

  constructor(config: Config, localAgent?: LocalAgent, claudeAgent?: ClaudeAgent, options?: OrchestratorOptions) {
    this.config = config
    this.router = new Router(config)
    this.localAgent = localAgent ?? new LocalAgent(config)
    this.claudeAgent = claudeAgent ?? new ClaudeAgent(config)
    this.tracker = new TokenTracker(config.token_tracking)
    this.claudeOnly = options?.claudeOnly ?? false
    this.localOnly = options?.localOnly ?? (!process.env.ANTHROPIC_API_KEY)
  }

  isLocalOnly(): boolean { return this.localOnly }
  isClaudeOnly(): boolean { return this.claudeOnly }
  isLocalFallback(): boolean { return this.localFallback }

  async process(prompt: string, previousSummary?: string): Promise<OrchestratorResult> {
    // Token exhaustion fallback — stay local until reset time
    if (this.localFallback && Date.now() < this.resetsAt) {
      const result = await this.localAgent.run(prompt, this.fallbackSummary)
      this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
      return { ...result, agent: 'local', routeMethod: 'rule' }
    }

    // Past reset — clear fallback, attempt Claude below
    if (this.localFallback && Date.now() >= this.resetsAt) {
      this.localFallback = false
    }

    if (this.claudeOnly) {
      const result = await this.claudeAgent.run(prompt, previousSummary)
      this.tracker.record({ agent: 'claude', input: result.inputTokens, output: result.outputTokens, model: this.config.claude.model })
      await this.checkAndTriggerFallback(result)
      return { ...result, agent: 'claude', routeMethod: 'rule' }
    }

    if (this.localOnly) {
      const result = await this.localAgent.run(prompt, previousSummary)
      this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
      return { ...result, agent: 'local', routeMethod: 'rule' }
    }

    const decision = await this.router.classify(prompt)

    let result: AgentResult
    if (decision.agent === 'claude') {
      try {
        const claudeResult = await this.claudeAgent.run(prompt, previousSummary)
        await this.checkAndTriggerFallback(claudeResult)
        result = claudeResult
      } catch (err) {
        console.error(`[fallback] Claude unavailable (${(err as Error).message}), using local agent`)
        result = await this.localAgent.run(prompt, previousSummary)
        decision.agent = 'local'
      }
    } else {
      result = await this.localAgent.run(prompt, previousSummary)
    }

    this.tracker.record({
      agent: decision.agent,
      input: result.inputTokens,
      output: result.outputTokens,
      model: decision.agent === 'local' ? this.config.local_llm.model : this.config.claude.model,
    })

    return { ...result, agent: decision.agent, routeMethod: decision.method }
  }

  getStats() { return this.tracker.getStats() }
  resetStats() { this.tracker.reset() }

  private async checkAndTriggerFallback(result: ClaudeAgentResult): Promise<void> {
    const info = result.rateLimitInfo
    if (!info || info.tokensLimit === 0) return

    const usedFraction = (info.tokensLimit - info.tokensRemaining) / info.tokensLimit
    if (usedFraction < this.config.claude.token_threshold) return

    console.error(`[locode] Claude tokens at ${Math.round(usedFraction * 100)}%, switching to local agent`)

    try {
      this.fallbackSummary = await this.claudeAgent.generateHandoffSummary(result.summary)
    } catch {
      this.fallbackSummary = result.summary
    }

    this.localFallback = true
    this.resetsAt = info.resetsAt
  }
}
