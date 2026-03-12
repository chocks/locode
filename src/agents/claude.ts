import Anthropic from '@anthropic-ai/sdk'
import { AgentResult } from './local'
import type { ToolExecutor } from '../tools/executor'

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

// Static parts of the system prompt — tool list is injected dynamically
const CLAUDE_PROMPT_HEADER = `You are a coding assistant with tool access. Your job is to inspect a repository, understand the code, and safely modify it when asked.

Never fabricate outputs or assume file contents. Always use tools to inspect the repository before making decisions.

AVAILABLE TOOLS

`

const CLAUDE_PROMPT_FOOTER = `

CRITICAL: You MUST call a tool before answering ANY question about files, code, or the repository. NEVER guess or assume file contents.

WORKFLOW

1. Explore — Use run_command (ls, find, grep) or read_file to understand the repository.
2. Understand — Use read_file to inspect relevant files before proposing changes.
3. Plan — Briefly describe what needs to change and why.
4. Modify — Use edit_file for targeted changes, write_file only for new files.
5. Verify — Use read_file after editing to confirm the change was applied correctly.

EDITING RULES

- Prefer edit_file for modifications.
- Modify the smallest possible code region.
- Do not rewrite entire files unless necessary.
- Preserve existing formatting and style.
- Do not introduce unrelated refactors.

CONSTRAINTS

- You have a limited number of tool calls per task. Be efficient.
- For non-trivial changes, explain your reasoning before applying.

End every response with:
SUMMARY: (2-3 sentences describing what was done.)`

export class ClaudeAgent {
  private client: Anthropic
  private config: ClaudeConfig
  private toolExecutor: ToolExecutor

  constructor(config: ClaudeConfig, toolExecutor: ToolExecutor) {
    this.config = config
    this.client = new Anthropic()
    this.toolExecutor = toolExecutor
  }

  async run(prompt: string, context?: string, repoContext?: string): Promise<ClaudeAgentResult> {
    const messages: Anthropic.MessageParam[] = []
    const toolList = this.toolExecutor.registry.describeForPrompt()
    const basePrompt = CLAUDE_PROMPT_HEADER + toolList + CLAUDE_PROMPT_FOOTER
    const systemPrompt = repoContext
      ? `Project context:\n${repoContext}\n\n${basePrompt}`
      : basePrompt

    if (context) {
      messages.push({
        role: 'user',
        content: `Context summary from previous work:\n${context}\n\nContinuing task: ${prompt}`,
      })
    } else {
      messages.push({ role: 'user', content: prompt })
    }

    let totalInputTokens = 0
    let totalOutputTokens = 0
    const MAX_TOOL_ROUNDS = 10

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      let data: Anthropic.Message
      let httpResponse: { headers: { get(name: string): string | null } }
      try {
        const tools = this.toolExecutor.registry.listForClaude() as Anthropic.Tool[]
        const result = await this.client.messages.create({
          model: this.config.claude.model,
          max_tokens: 16384,
          system: systemPrompt,
          tools,
          messages,
        }).withResponse()
        data = result.data
        httpResponse = result.response
      } catch (err) {
        const friendly = friendlyClaudeError(err)
        if (friendly) throw friendly
        throw err
      }

      totalInputTokens += data.usage.input_tokens
      totalOutputTokens += data.usage.output_tokens

      // No tool use — return final response
      if (data.stop_reason !== 'tool_use') {
        const content = data.content
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; text: string }).text)
          .join('\n')
        return { content, summary: content.slice(0, 500), inputTokens: totalInputTokens, outputTokens: totalOutputTokens, rateLimitInfo: this.parseRateLimitHeaders(httpResponse.headers) }
      }

      // Execute tool calls
      const toolBlocks = data.content.filter(b => b.type === 'tool_use') as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, string> }>
      messages.push({ role: 'assistant', content: data.content })
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tc of toolBlocks) {
        const toolResult = await this.toolExecutor.execute({ tool: tc.name, args: tc.input })
        const output = toolResult.success ? toolResult.output : `Error: ${toolResult.error}`
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: output })
      }
      messages.push({ role: 'user', content: toolResults })
    }

    // Max rounds exceeded — make one final call without tools
    let data: Anthropic.Message
    let httpResponse: { headers: { get(name: string): string | null } }
    try {
      const result = await this.client.messages.create({
        model: this.config.claude.model,
        max_tokens: 16384,
        system: systemPrompt,
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
      inputTokens: totalInputTokens + data.usage.input_tokens,
      outputTokens: totalOutputTokens + data.usage.output_tokens,
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
