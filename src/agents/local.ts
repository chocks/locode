import Ollama from 'ollama'
import { readFileTool, shellTool, gitTool } from '../tools'

interface LocalConfig {
  local_llm: { provider: 'ollama'; model: string; base_url: string }
  context?: { handoff: 'summary'; max_summary_tokens: number }
}

export interface AgentResult {
  content: string
  summary: string
  inputTokens: number
  outputTokens: number
}

const SYSTEM_PROMPT = `You are a local coding assistant. You help with file exploration,
grep searches, shell commands, and repository research. You have access to read files,
run read-only shell commands, and query git. You do NOT write or modify files.
When you complete a task, end your response with a SUMMARY section that briefly
describes what you found in 2-3 sentences.`

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

async function dispatchTool(name: string, args: Record<string, string>): Promise<string> {
  switch (name) {
    case 'read_file': return readFileTool({ path: args.path })
    case 'shell':     return shellTool({ command: args.command })
    case 'git':       return gitTool({ args: args.args })
    default:          return `Unknown tool: ${name}`
  }
}

export class LocalAgent {
  private config: LocalConfig

  constructor(config: LocalConfig) {
    this.config = config
  }

  async run(prompt: string, context?: string): Promise<AgentResult> {
    const messages: Array<{ role: string; content: string }> = []

    if (context) {
      messages.push({ role: 'user', content: `Context from previous work:\n${context}` })
      messages.push({ role: 'assistant', content: 'Understood, I have the context.' })
    }
    messages.push({ role: 'user', content: prompt })

    let totalInputTokens = 0
    let totalOutputTokens = 0
    const MAX_TOOL_ROUNDS = 5  // prevent infinite loops

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await Ollama.chat({
        model: this.config.local_llm.model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages] as any,
        tools: TOOLS as any,
      })

      totalInputTokens += response.prompt_eval_count ?? 0
      totalOutputTokens += response.eval_count ?? 0

      const toolCalls = (response.message as any).tool_calls

      // No tool calls — final response
      if (!toolCalls || toolCalls.length === 0) {
        const content = response.message.content
        const summary = this.extractSummary(content)
        return { content, summary, inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
      }

      // Execute tool calls and append results
      messages.push({ role: 'assistant', content: response.message.content ?? '' })
      for (const tc of toolCalls) {
        const result = await dispatchTool(tc.function.name, tc.function.arguments as Record<string, string>)
        messages.push({ role: 'tool', content: result })
      }
    }

    // Fallback if max rounds exceeded — get final answer without tools
    const final = await Ollama.chat({
      model: this.config.local_llm.model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages] as any,
    })
    const content = final.message.content
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
