import Anthropic from '@anthropic-ai/sdk'
import { AgentResult } from './local'

interface ClaudeConfig {
  claude: { model: string; token_threshold: number }
}

export interface RateLimitInfo {
  tokensRemaining: number
  tokensLimit: number
  resetsAt: number  // Unix ms
}

export interface ClaudeAgentResult extends AgentResult {
  rateLimitInfo: RateLimitInfo | null
}

function nextMidnightUtc(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
}

export class ClaudeAgent {
  private client: Anthropic
  private config: ClaudeConfig

  constructor(config: ClaudeConfig) {
    this.config = config
    this.client = new Anthropic()
  }

  async run(prompt: string, context?: string, repoContext?: string): Promise<ClaudeAgentResult> {
    const messages: Anthropic.MessageParam[] = []

    if (context) {
      messages.push({
        role: 'user',
        content: `Context summary from previous work:\n${context}\n\nContinuing task: ${prompt}`,
      })
    } else {
      messages.push({ role: 'user', content: prompt })
    }

    const { data: response, response: httpResponse } = await this.client.messages.create({
      model: this.config.claude.model,
      max_tokens: 8096,
      ...(repoContext ? { system: `Project context:\n${repoContext}` } : {}),
      messages,
    }).withResponse()

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('\n')

    return {
      content,
      summary: content.slice(0, 500),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      rateLimitInfo: this.parseRateLimitHeaders(httpResponse.headers),
    }
  }

  async generateHandoffSummary(context: string): Promise<string> {
    try {
      const { data: response } = await this.client.messages.create({
        model: this.config.claude.model,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Summarize the current work context in 150 tokens or less for handoff to a local agent:\n\n${context}`,
        }],
      }).withResponse()
      return response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('\n')
    } catch {
      return context.slice(0, 500)
    }
  }

  private parseRateLimitHeaders(headers: { get(name: string): string | null }): RateLimitInfo | null {
    const remaining = headers.get('anthropic-ratelimit-tokens-remaining')
    const limit = headers.get('anthropic-ratelimit-tokens-limit')
    const reset = headers.get('anthropic-ratelimit-tokens-reset')
    if (remaining === null || limit === null) return null
    return {
      tokensRemaining: parseInt(remaining, 10),
      tokensLimit: parseInt(limit, 10),
      resetsAt: reset ? new Date(reset).getTime() : nextMidnightUtc(),
    }
  }
}
