import Anthropic from '@anthropic-ai/sdk'
import { AgentResult } from './local'
import { readFileTool, shellTool, gitTool, writeFileTool, editFileTool } from '../tools'
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
  {
    name: 'write_file',
    description: 'Write content to a file, creating it if needed or overwriting if it exists',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to the file to write' },
        content: { type: 'string', description: 'The full content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing an exact string match. The old_string must appear exactly once in the file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to the file to edit' },
        old_string: { type: 'string', description: 'The exact string to find (must be unique in file)' },
        new_string: { type: 'string', description: 'The replacement string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
]

async function dispatchTool(name: string, input: Record<string, string>): Promise<string> {
  switch (name) {
    case 'read_file': return readFileTool({ path: input.path })
    case 'shell':     return shellTool({ command: input.command })
    case 'git':        return gitTool({ args: input.args })
    case 'write_file': return writeFileTool({ path: input.path, content: input.content })
    case 'edit_file':  return editFileTool({ path: input.path, old_string: input.old_string, new_string: input.new_string })
    default:           return `Unknown tool: ${name}`
  }
}

const SYSTEM_PROMPT = `You are a coding assistant with tool access. Your job is to inspect a repository, understand the code, and safely modify it when asked.

Never fabricate outputs or assume file contents. Always use tools to inspect the repository before making decisions.

AVAILABLE TOOLS

read_file(path)
  Read a file from the repository.

run_command(command)
  Run read-only shell commands (ls, cat, grep, find, etc.). Only read-only commands are permitted; others are blocked.

git_query(args)
  Run git queries such as log, diff, status, and blame.

edit_file(path, old_string, new_string)
  Replace an exact string in a file. This is the preferred method for modifying code.
  Include enough surrounding context in old_string to ensure a unique match.

write_file(path, content)
  Create or overwrite a file. Only use this for new files or when a full rewrite is explicitly required.

WORKFLOW

1. Explore — Use run_command, git_query, or read_file to understand the repository structure and find relevant code.
2. Understand — Read the relevant files and search for references before proposing changes.
3. Plan — Briefly describe what needs to change and why.
4. Modify — Apply the smallest possible change that fixes the issue.
5. Verify — Re-read the file after editing to confirm the change was applied correctly.

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
  private toolExecutor: ToolExecutor | null

  constructor(config: ClaudeConfig, toolExecutor?: ToolExecutor) {
    this.config = config
    this.client = new Anthropic()
    this.toolExecutor = toolExecutor ?? null
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
    const MAX_TOOL_ROUNDS = 10

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      let data: Anthropic.Message
      let httpResponse: { headers: { get(name: string): string | null } }
      try {
        const tools = this.toolExecutor
          ? this.toolExecutor.registry.listForClaude() as Anthropic.Tool[]
          : TOOLS
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
        let output: string
        if (this.toolExecutor) {
          const toolResult = await this.toolExecutor.execute({ tool: tc.name, args: tc.input })
          output = toolResult.success ? toolResult.output : `Error: ${toolResult.error}`
        } else {
          output = await dispatchTool(tc.name, tc.input)
        }
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
