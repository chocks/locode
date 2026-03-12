import Ollama from 'ollama'
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

// Static parts of the system prompt — tool list is injected dynamically
const LOCAL_PROMPT_HEADER = `You are a local coding assistant with tool access.

You MUST use the provided tools to fulfill requests.
Never say you cannot access files, run commands, or query git.

AVAILABLE TOOLS

`

const LOCAL_PROMPT_FOOTER = `

CRITICAL: You MUST call a tool before answering ANY question about files, code, or the repository. NEVER guess or assume file contents. If you are unsure, use read_file or run_command to check first.

WORKFLOW

1. Use run_command to explore (ls, tree, find, grep).
2. Use read_file to read file contents.
3. Use git_query for history, diffs, or blame.
4. Answer ONLY after gathering real data from tools.

RULES

- ALWAYS call a tool before responding about files or code.
- If a user asks about a file, use read_file to read it first.
- Do not fabricate or guess file contents — use tools.
- You do NOT write or modify files.
- Keep explanations concise. Focus on tool results.

End every response with:
SUMMARY: (2-3 sentences describing what you found.)`

// Strip <think>...</think> blocks that thinking-mode models (e.g. qwen3) may emit.
// If stripping leaves nothing, return the content inside the tags instead.
function stripThinkTags(text: string): string {
  const stripped = text.replace(/^[\s\S]*?<\/think>\s*/m, '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  if (stripped) return stripped
  // Fallback: extract content from inside think tags
  const inner = text.replace(/<\/?think>/g, '').trim()
  return inner || text.trim()
}

function isOllamaConnectionError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === 'fetch failed') return true
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code === 'ECONNREFUSED' || cause?.code === 'ECONNRESET') return true
  return false
}

export class LocalAgent {
  private config: LocalConfig
  private toolExecutor: ToolExecutor

  constructor(config: LocalConfig, toolExecutor: ToolExecutor) {
    this.config = config
    this.toolExecutor = toolExecutor
  }

  async run(prompt: string, context?: string, repoContext?: string): Promise<AgentResult> {
    const toolList = this.toolExecutor.registry.describeForPrompt()
    const basePrompt = LOCAL_PROMPT_HEADER + toolList + LOCAL_PROMPT_FOOTER
    const systemPrompt = repoContext
      ? `Project context:\n${repoContext}\n\n${basePrompt}`
      : basePrompt
    const messages: Array<{ role: string; content: string }> = []

    if (context) {
      messages.push({ role: 'user', content: `Context from previous work:\n${context}` })
      messages.push({ role: 'assistant', content: 'Understood, I have the context.' })
    }
    messages.push({ role: 'user', content: prompt })

    let totalInputTokens = 0
    let totalOutputTokens = 0
    const MAX_TOOL_ROUNDS = 5  // prevent infinite loops

    const allTools = this.toolExecutor.registry.listForLLM()

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
        const toolResult = await this.toolExecutor.execute({ tool: name, args })
        const result = toolResult.success ? toolResult.output : `Error: ${toolResult.error}`
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
