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

export function friendlyClaudeError(err: unknown): Error | null {
  if (!(err instanceof Error)) return null
  const status = (err as { status?: number }).status

  // APIConnectionError — no status, name matches
  if (status === undefined && err.name === 'APIConnectionError') {
    return new Error(
      'Could not reach the Claude API. Check your internet connection or https://status.anthropic.com',
      { cause: err }
    )
  }

  // No status number — not an API error we can map
  if (status === undefined) return null

  if (status === 401) {
    return new Error(
      'Invalid API key. Check ANTHROPIC_API_KEY in ~/.locode/.env',
      { cause: err }
    )
  }
  if (status === 429) {
    return new Error(
      'Claude API rate limit exceeded. Your usage may have hit its limit — wait a few minutes or check your plan at https://console.anthropic.com',
      { cause: err }
    )
  }
  if (status >= 500) {
    return new Error(
      `Claude API error (${status}). The API may be experiencing issues — check https://status.anthropic.com`,
      { cause: err }
    )
  }
  return new Error(`Claude API error: ${err.message}`, { cause: err })
}

function nextMidnightUtc(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
}

const SYSTEM_PROMPT = `You are a code analysis and implementation assistant. You cannot run commands, read files, or access the filesystem. Work only with the context provided in the conversation. If you need more information, ask the user to provide it. Never fabricate command outputs or pretend to execute code.`

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

    let data: Anthropic.Message
    let httpResponse: { headers: { get(name: string): string | null } }
    try {
      const result = await this.client.messages.create({
        model: this.config.claude.model,
        max_tokens: 8096,
        system: repoContext
        ? `Project context:\n${repoContext}\n\n${SYSTEM_PROMPT}`
        : SYSTEM_PROMPT,
        messages,
      }).withResponse()
      data = result.data
      httpResponse = result.response
    } catch (err) {
      const friendly = friendlyClaudeError(err)
      if (friendly) throw friendly
      throw err
    }

    const content = data.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('\n')

    return {
      content,
      summary: content.slice(0, 500),
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
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
