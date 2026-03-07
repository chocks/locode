import Ollama from 'ollama'
import type { Config } from '../config/schema'

export type AgentType = 'local' | 'claude'

export interface RouteDecision {
  agent: AgentType
  method: 'rule' | 'llm'
  confidence: number
  reason: string
}

export interface ResolverResult {
  agent: AgentType
  confidence: number
}

type AmbiguousResolver = (prompt: string) => Promise<ResolverResult>

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
    const { agent: llmAgent, confidence } = await this.resolveAmbiguous(prompt)

    // If confidence is below threshold, escalate to Claude regardless of LLM decision
    const agent = confidence < this.config.routing.escalation_threshold ? 'claude' : llmAgent
    const reason = agent === llmAgent
      ? `LLM classified as ${agent} task (confidence: ${confidence})`
      : `LLM confidence too low (${confidence}), escalating to claude`
    return { agent, method: 'llm', confidence, reason }
  }

  private async defaultResolver(prompt: string): Promise<ResolverResult> {
    try {
      const response = await Ollama.chat({
        model: this.config.local_llm.model,
        messages: [{
          role: 'user',
          content: `Classify this coding task as "local" or "claude".
- "local": file reading, grep, search, shell commands, git queries, repo exploration, release/tag/version
- "claude": code generation, refactoring, architecture, writing tests, complex explanations

Task: "${prompt}"

Reply with JSON only: {"agent": "local", "confidence": 0.85}`
        }],
      })
      const answer = response.message.content.trim()
      const parsed = JSON.parse(answer)
      const agent: AgentType = parsed.agent === 'claude' ? 'claude' : 'local'
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5))
      return { agent, confidence }
    } catch {
      return { agent: 'local', confidence: 0.5 } // fallback on error
    }
  }
}
