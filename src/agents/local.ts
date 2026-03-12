import Ollama from 'ollama'
import { readFileTool, shellTool, gitTool } from '../tools'
import type { McpManager, McpTool } from '../mcp/client'
import type { ToolExecutor } from '../tools/executor'

interface LocalConfig {
  local_llm: { provider: 'ollama'; model: string; base_url: string; options?: Record<string, number> }
  context?: { handoff: 'summary'; max_summary_tokens: number }
}

export interface AgentResult {
  content: string
  summary: string
  inputTokens: number
  outputTokens: number
}

const SYSTEM_PROMPT = `You are a local coding assistant with tool access.

You MUST use the provided tools to fulfill requests.
Never say you cannot access files, run commands, or query git.

AVAILABLE TOOLS

read_file(path)
  Read a file from the repository.

shell(command)
  Run read-only shell commands such as ls, cat, grep, find, tree.
  Only read-only commands are permitted; others are blocked.

git(args)
  Run git inspection commands such as log, diff, status, blame.

WORKFLOW

1. Explore the repository using shell commands (ls, tree, grep).
2. Identify relevant files.
3. Read files using read_file.
4. Use git if history or changes are relevant.
5. Answer the user's question based on the gathered information.

SEARCH GUIDELINES

Before reading files:
- Prefer searching the repository using grep or find.
- Identify the correct file before opening it.
- Read only the files necessary to answer the question.

RULES

- Always use tools instead of guessing file contents.
- Do not claim lack of filesystem access.
- You do NOT write or modify files.

OUTPUT

Keep explanations concise. Focus on tool usage and findings.

End every response with:
SUMMARY: (2-3 sentences describing what you found.)`

// Tool schemas for Ollama function calling
const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative path to the file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'shell',
      description: 'Run a read-only shell command (ls, grep, find, cat, etc.)',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git',
      description: 'Run a read-only git command (log, diff, status, blame, etc.)',
      parameters: {
        type: 'object',
        properties: {
          args: { type: 'string', description: 'Git subcommand and arguments, e.g. "log --oneline -10"' },
        },
        required: ['args'],
      },
    },
  },
]

// Strip <think>...</think> blocks that thinking-mode models (e.g. qwen3) may emit
function stripThinkTags(text: string): string {
  return text.replace(/^[\s\S]*?<\/think>\s*/m, '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
}

async function dispatchTool(name: string, args: Record<string, string>): Promise<string> {
  switch (name) {
    case 'read_file': return readFileTool({ path: args.path })
    case 'shell':     return shellTool({ command: args.command })
    case 'git':       return gitTool({ args: args.args })
    default:          return `Unknown tool: ${name}`
  }
}

function mcpToolsToOllama(mcpTools: McpTool[]) {
  return mcpTools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

function isOllamaConnectionError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === 'fetch failed') return true
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code === 'ECONNREFUSED' || cause?.code === 'ECONNRESET') return true
  return false
}

export class LocalAgent {
  private config: LocalConfig
  private mcpManager: McpManager | null
  private mcpToolNames: Set<string> = new Set()
  private toolExecutor: ToolExecutor | null

  constructor(config: LocalConfig, mcpManager?: McpManager, toolExecutor?: ToolExecutor) {
    this.config = config
    this.mcpManager = mcpManager ?? null
    this.toolExecutor = toolExecutor ?? null
  }

  async run(prompt: string, context?: string, repoContext?: string): Promise<AgentResult> {
    const systemPrompt = repoContext
      ? `Project context:\n${repoContext}\n\n${SYSTEM_PROMPT}`
      : SYSTEM_PROMPT
    const messages: Array<{ role: string; content: string }> = []

    if (context) {
      messages.push({ role: 'user', content: `Context from previous work:\n${context}` })
      messages.push({ role: 'assistant', content: 'Understood, I have the context.' })
    }
    messages.push({ role: 'user', content: prompt })

    let totalInputTokens = 0
    let totalOutputTokens = 0
    const MAX_TOOL_ROUNDS = 5  // prevent infinite loops

    // Build tool schemas — use registry when executor is present, else legacy inline
    let allTools: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>
    if (this.toolExecutor) {
      allTools = this.toolExecutor.registry.listForLLM()
    } else {
      allTools = [...TOOLS] as Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>
      if (this.mcpManager) {
        const mcpTools = this.mcpManager.getTools()
        allTools.push(...mcpToolsToOllama(mcpTools))
        this.mcpToolNames = new Set(mcpTools.map(t => t.name))
      }
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let response: Awaited<ReturnType<typeof Ollama.chat>>
      try {
        response = await Ollama.chat({
          model: this.config.local_llm.model,
          messages: [{ role: 'system', content: systemPrompt }, ...messages] as Parameters<typeof Ollama.chat>[0]['messages'],
          tools: allTools as unknown as Parameters<typeof Ollama.chat>[0]['tools'],
          think: false,
          ...(this.config.local_llm.options && { options: this.config.local_llm.options }),
        })
      } catch (err) {
        if (isOllamaConnectionError(err)) {
          throw new Error(
            `Could not connect to Ollama at ${this.config.local_llm.base_url}. Is Ollama running? Start it with: ollama serve`,
            { cause: err }
          )
        }
        throw err
      }

      totalInputTokens += response.prompt_eval_count ?? 0
      totalOutputTokens += response.eval_count ?? 0

      const rawToolCalls = (response.message as { content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, string> } }> }).tool_calls
      const toolCalls = rawToolCalls?.filter(tc => tc?.function?.name)

      // No tool calls — final response
      if (!toolCalls || toolCalls.length === 0) {
        const content = stripThinkTags(response.message.content)
        const summary = this.extractSummary(content)
        return { content, summary, inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
      }

      // Execute tool calls and append results — include tool_calls so model
      // understands the subsequent tool-result messages in context
      messages.push({ role: 'assistant', content: response.message.content ?? '', tool_calls: toolCalls } as { role: string; content: string })
      for (const tc of toolCalls) {
        const name = tc.function.name
        const args = tc.function.arguments as Record<string, string>
        let result: string
        if (this.toolExecutor) {
          const toolResult = await this.toolExecutor.execute({ tool: name, args })
          result = toolResult.success ? toolResult.output : `Error: ${toolResult.error}`
        } else if (this.mcpManager && this.mcpToolNames.has(name)) {
          result = await this.mcpManager.callTool(name, args)
        } else {
          result = await dispatchTool(name, args)
        }
        messages.push({ role: 'tool', content: result })
      }
    }

    // Fallback if max rounds exceeded — get final answer without tools
    let final: Awaited<ReturnType<typeof Ollama.chat>>
    try {
      final = await Ollama.chat({
        model: this.config.local_llm.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages] as Parameters<typeof Ollama.chat>[0]['messages'],
        think: false,
        ...(this.config.local_llm.options && { options: this.config.local_llm.options }),
      })
    } catch (err) {
      if (isOllamaConnectionError(err)) {
        throw new Error(
          `Could not connect to Ollama at ${this.config.local_llm.base_url}. Is Ollama running? Start it with: ollama serve`,
          { cause: err }
        )
      }
      throw err
    }
    const content = stripThinkTags(final.message.content)
    return {
      content,
      summary: this.extractSummary(content),
      inputTokens: totalInputTokens + (final.prompt_eval_count ?? 0),
      outputTokens: totalOutputTokens + (final.eval_count ?? 0),
    }
  }

  private extractSummary(content: string): string {
    const maxTokens = this.config.context?.max_summary_tokens ?? 500
    const summaryMatch = content.match(/SUMMARY[:\s]+([\s\S]+?)(?:\n\n|$)/i)
    if (summaryMatch) return summaryMatch[1].trim().slice(0, maxTokens)
    const paragraphs = content.trim().split('\n\n')
    return paragraphs[paragraphs.length - 1].slice(0, maxTokens)
  }
}
