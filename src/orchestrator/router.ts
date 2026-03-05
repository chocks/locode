import type { Config } from '../config/schema'

export type AgentType = 'local' | 'claude'

export interface RouteDecision {
  agent: AgentType
  method: 'rule' | 'llm'
  confidence: number
}

type AmbiguousResolver = (prompt: string) => Promise<AgentType>

export class Router {
  private config: Config
  private resolveAmbiguous: AmbiguousResolver

  constructor(config: Config, resolver?: AmbiguousResolver) {
    this.config = config
    this.resolveAmbiguous = resolver ?? this.defaultResolver.bind(this)
  }

  async classify(prompt: string): Promise<RouteDecision> {
    const lower = prompt.toLowerCase()

    for (const rule of this.config.routing.rules) {
      const regex = new RegExp(rule.pattern, 'i')
      if (regex.test(lower)) {
        return { agent: rule.agent, method: 'rule', confidence: 1.0 }
      }
    }

    // No rule matched — use local LLM to decide
    const agent = await this.resolveAmbiguous(prompt)
    return { agent, method: 'llm', confidence: 0.6 }
  }

  private async defaultResolver(prompt: string): Promise<AgentType> {
    // In production this calls Ollama to classify the prompt.
    // For now, default to local for safety (saves tokens).
    return 'local'
  }
}
