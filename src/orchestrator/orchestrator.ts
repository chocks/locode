import { Router, AgentType } from './router'
import { LocalAgent, AgentResult } from '../agents/local'
import { ClaudeAgent } from '../agents/claude'
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

  constructor(config: Config, localAgent?: LocalAgent, claudeAgent?: ClaudeAgent, options?: OrchestratorOptions) {
    this.config = config
    this.router = new Router(config)
    this.localAgent = localAgent ?? new LocalAgent(config)
    this.claudeAgent = claudeAgent ?? new ClaudeAgent(config)
    this.tracker = new TokenTracker(config.token_tracking)
    this.claudeOnly = options?.claudeOnly ?? false
    this.localOnly = options?.localOnly ?? (!process.env.ANTHROPIC_API_KEY)
  }

  isLocalOnly(): boolean {
    return this.localOnly
  }

  isClaudeOnly(): boolean {
    return this.claudeOnly
  }

  async process(prompt: string, previousSummary?: string): Promise<OrchestratorResult> {
    if (this.claudeOnly) {
      const result = await this.claudeAgent.run(prompt, previousSummary)
      this.tracker.record({
        agent: 'claude',
        input: result.inputTokens,
        output: result.outputTokens,
        model: this.config.claude.model,
      })
      return { ...result, agent: 'claude', routeMethod: 'rule' }
    }

    // In local-only mode, bypass router and always use local agent
    if (this.localOnly) {
      const result = await this.localAgent.run(prompt, previousSummary)
      this.tracker.record({
        agent: 'local',
        input: result.inputTokens,
        output: result.outputTokens,
        model: this.config.local_llm.model,
      })
      return { ...result, agent: 'local', routeMethod: 'rule' }
    }

    const decision = await this.router.classify(prompt)

    let result: AgentResult
    if (decision.agent === 'claude') {
      try {
        result = await this.claudeAgent.run(prompt, previousSummary)
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

  getStats() {
    return this.tracker.getStats()
  }

  resetStats() {
    this.tracker.reset()
  }
}
