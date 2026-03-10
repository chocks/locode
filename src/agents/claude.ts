import Anthropic from '@anthropic-ai/sdk'
import { AgentResult } from './local'
import { readFileTool, shellTool, gitTool } from '../tools'

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

// Tool schemas in Anthropic format
// TODO(v0.2): extract shared tool registry (see docs/plans/2026-03-07-locode-v02-architecture-design.md §4.6)
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute or relative path to the file' } },
      required: ['path'],
    },
  },
  {
    name: 'shell',
    description: 'Run a read-only shell command (ls, grep, find, cat, etc.)',
    input_schema: {
      type: 'object' as const,
      properties: { command: { type: 'string', description: 'The shell command to run' } },
      required: ['command'],
    },
  },
  {
    name: 'git',
    description: 'Run a read-only git command (log, diff, status, blame, etc.)',
    input_schema: {
      type: 'object' as const,
      properties: { args: { type: 'string', description: 'Git subcommand and arguments, e.g. "log --oneline -10"' } },
      required: ['args'],
    },
  },
]

async function dispatchTool(name: string, input: Record<string, string>): Promise<string> {
  switch (name) {
    case 'read_file': return readFileTool({ path: input.path })
    case 'shell':     return shellTool({ command: input.command })
    case 'git':       return gitTool({ args: input.args })
    default:          return `Unknown tool: ${name}`
  }
}

const SYSTEM_PROMPT = `You are a coding assistant with tool access. Use the provided tools to read files, run commands, and query git — never fabricate outputs or guess at file contents.

Available tools:
- read_file: read any file by path
- shell: run read-only commands (ls, cat, grep, find, etc.)
- git: run git queries (log, diff, status, blame, etc.)

Always use tools to gather information before answering. End your response with a SUMMARY section (2-3 sentences).`

export class ClaudeAgent {
  private client: Anthropic
  private config: ClaudeConfig

  constructor(config: ClaudeConfig) {
    this.config = config
    this.client = new Anthropic()
  }

  async run(prompt: string, context?: string, repoContext?: string): Promise<ClaudeAgentResult> {
    const messages: Anthropic.MessageParam[] = []
    const systemPrompt = repoContext
      ? `Project context:\n${repoContext}\n\n${SYSTEM_PROMPT}`
      : SYSTEM_PROMPT

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
    const MAX_TOOL_ROUNDS = 5

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      let data: Anthropic.Message
      let httpResponse: { headers: { get(name: string): string | null } }
      try {
        const result = await this.client.messages.create({
          model: this.config.claude.model,
          max_tokens: 8096,
          system: systemPrompt,
          tools: TOOLS,
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
        const output = await dispatchTool(tc.name, tc.input)
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
        max_tokens: 8096,
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
