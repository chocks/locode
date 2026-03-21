import { Ollama } from 'ollama'
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
  private ollama: InstanceType<typeof Ollama>

  constructor(config: Config, resolver?: AmbiguousResolver) {
    this.config = config
    this.resolveAmbiguous = resolver ?? this.defaultResolver.bind(this)
    this.ollama = new Ollama({ host: config.local_llm.base_url })
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
      const response = await this.ollama.chat({
        model: this.config.local_llm.model,
        messages: [{
          role: 'user',
          content: `Classify this coding task by complexity.

- "local" — simple tasks a small LLM can handle:
  file reading, grep, searching code, shell commands, git queries,
  simple code generation (hello world, boilerplate, small functions),
  straightforward single-file edits, adding imports, renaming variables.

- "claude" — complex tasks needing a large LLM:
  multi-file refactoring, architecture design, complex debugging,
  fixing subtle bugs, explaining complex code behavior,
  tasks requiring deep understanding of multiple files.

Task: "${prompt}"

Set confidence 0.9-1.0 if clearly one agent, 0.5-0.8 if borderline.

Respond with ONLY JSON, nothing else:
{"agent": "local | claude", "confidence": 0.0-1.0}`
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
