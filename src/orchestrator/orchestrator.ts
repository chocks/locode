import { Router, AgentType } from './router'
import { LocalAgent, AgentResult } from '../agents/local'
import { ClaudeAgent } from '../agents/claude'
import { TokenTracker } from '../tracker/tracker'
import type { Config } from '../config/schema'

export interface OrchestratorResult extends AgentResult {
  agent: AgentType
  routeMethod: 'rule' | 'llm'
}

export class Orchestrator {
  private router: Router
  private localAgent: LocalAgent
  private claudeAgent: ClaudeAgent
  private tracker: TokenTracker
  private config: Config

  constructor(config: Config, localAgent?: LocalAgent, claudeAgent?: ClaudeAgent) {
    this.config = config
    this.router = new Router(config)
    this.localAgent = localAgent ?? new LocalAgent(config)
    this.claudeAgent = claudeAgent ?? new ClaudeAgent(config)
    this.tracker = new TokenTracker(config.token_tracking)
  }

  async process(prompt: string, previousSummary?: string): Promise<OrchestratorResult> {
    const decision = await this.router.classify(prompt)

    let result: AgentResult
    if (decision.agent === 'local') {
      result = await this.localAgent.run(prompt, previousSummary)
    } else {
      result = await this.claudeAgent.run(prompt, previousSummary)
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
