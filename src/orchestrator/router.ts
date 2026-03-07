import Ollama from 'ollama'
import type { Config } from '../config/schema'

export type AgentType = 'local' | 'claude'

export interface RouteDecision {
  agent: AgentType
  method: 'rule' | 'llm'
  confidence: number
  reason: string
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
        return { agent: rule.agent, method: 'rule', confidence: 1.0, reason: `matched pattern: ${rule.pattern}` }
      }
    }

    // No rule matched — use local LLM to decide
    const llmAgent = await this.resolveAmbiguous(prompt)
    const confidence = 0.6

    // If confidence is below threshold, escalate to Claude regardless of LLM decision
    const agent = confidence < this.config.routing.escalation_threshold ? 'claude' : llmAgent
    const reason = agent === llmAgent
      ? `LLM classified as ${agent} task`
      : `LLM confidence too low (${confidence}), escalating to claude`
    return { agent, method: 'llm', confidence, reason }
  }

  private async defaultResolver(prompt: string): Promise<AgentType> {
    try {
      const response = await Ollama.chat({
        model: this.config.local_llm.model,
        messages: [{
          role: 'user',
          content: `Classify this coding task. Reply with ONLY "local" or "claude".
- "local": file reading, grep, search, shell commands, git queries, repo exploration
- "claude": code generation, refactoring, architecture, writing tests, complex explanations

Task: "${prompt}"

Reply with one word only: local or claude`
        }],
      })
      const answer = response.message.content.trim().toLowerCase()
      return answer.startsWith('claude') ? 'claude' : 'local'
    } catch {
      return 'local' // fallback on error
    }
  }
}
