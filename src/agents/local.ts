import { Ollama } from 'ollama'
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
function buildPromptHeader(): string {
  return `You are a coding assistant. Use the provided tools to answer questions.
You are working in: ${process.cwd()}
Always use relative paths (e.g. README.md, src/index.ts). Never use /path/to or placeholder paths.

TOOLS

`
}

const LOCAL_PROMPT_FOOTER = `

INSTRUCTIONS
1. Use the tools above to gather information. Do not guess file contents.
2. After receiving a tool result, respond with your answer in plain text.
3. Only call another tool if the first result was insufficient.
4. You cannot modify files. Only read and explore.
5. Keep answers concise.`

// Strip <think>...</think> blocks that thinking-mode models (e.g. qwen3) may emit.
// If stripping leaves nothing, return the content inside the tags instead.
function stripThinkTags(text: string): string {
  const stripped = text.replace(/^[\s\S]*?<\/think>\s*/m, '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
  if (stripped) return stripped
  // Fallback: extract content from inside think tags
  const inner = text.replace(/<\/?think>/g, '').trim()
  return inner || text.trim()
}

// Parse text-based <tool_call> blocks that some models emit instead of structured tool_calls
function parseTextToolCalls(content: string): Array<{ function: { name: string; arguments: Record<string, string> } }> | null {
  const pattern = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g
  const calls: Array<{ function: { name: string; arguments: Record<string, string> } }> = []
  let match
  while ((match = pattern.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed.name && parsed.arguments) {
        calls.push({ function: { name: parsed.name, arguments: parsed.arguments } })
      }
    } catch {
      // Skip malformed JSON
    }
  }
  return calls.length > 0 ? calls : null
}

function isOllamaConnectionError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === 'fetch failed') return true
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code === 'ECONNREFUSED' || cause?.code === 'ECONNRESET') return true
  return false
}

export interface LocalAgentOptions {
  verbose?: boolean
}

export class LocalAgent {
  private config: LocalConfig
  private toolExecutor: ToolExecutor
  private verbose: boolean
  private ollama: InstanceType<typeof Ollama>

  constructor(config: LocalConfig, toolExecutor: ToolExecutor, options?: LocalAgentOptions) {
    this.config = config
    this.toolExecutor = toolExecutor
    this.verbose = options?.verbose ?? false
    this.ollama = new Ollama({ host: config.local_llm.base_url })
  }

  async run(prompt: string, context?: string, repoContext?: string): Promise<AgentResult> {
    const toolList = this.toolExecutor.registry.describeForPrompt()
    const basePrompt = buildPromptHeader() + toolList + LOCAL_PROMPT_FOOTER
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
    let lastFailedCall = ''
    let consecutiveFailures = 0

    const allTools = this.toolExecutor.registry.listForLLM()

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let response: Awaited<ReturnType<InstanceType<typeof Ollama>['chat']>>
      try {
        response = await this.ollama.chat({
          model: this.config.local_llm.model,
          messages: [{ role: 'system', content: systemPrompt }, ...messages] as Parameters<InstanceType<typeof Ollama>['chat']>[0]['messages'],
          tools: allTools as unknown as Parameters<InstanceType<typeof Ollama>['chat']>[0]['tools'],

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

      if (this.verbose) {
        const contentPreview = response.message.content?.slice(0, 300) || '(empty)'
        const rawCalls = (response.message as { tool_calls?: unknown[] }).tool_calls
        process.stderr.write(`[model] round=${round} content=${JSON.stringify(contentPreview)} tool_calls=${JSON.stringify(rawCalls ?? [])}\n`)
      }

      const rawToolCalls = (response.message as { content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, string> } }> }).tool_calls
      const structuredCalls = rawToolCalls?.filter(tc => tc?.function?.name)
      // Fall back to parsing <tool_call> blocks from content
      const textCalls = parseTextToolCalls(response.message.content)
      const toolCalls = (structuredCalls && structuredCalls.length > 0)
        ? structuredCalls
        : textCalls

      if (this.verbose && !structuredCalls?.length && textCalls) {
        process.stderr.write(`[fallback] parsed ${textCalls.length} text-based <tool_call> from content\n`)
      }

      // No tool calls — final response
      if (!toolCalls || toolCalls.length === 0) {
        const content = stripThinkTags(response.message.content)
        // If content is empty after tool rounds, retry once without tools to force a response
        if (!content && round > 0) {
          if (this.verbose) {
            process.stderr.write('[retry] empty response after tool use, retrying without tools\n')
          }
          break
        }
        const summary = this.extractSummary(content)
        return { content, summary, inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
      }

      // Execute tool calls and append results — include tool_calls so model
      // understands the subsequent tool-result messages in context
      messages.push({ role: 'assistant', content: response.message.content ?? '', tool_calls: toolCalls } as { role: string; content: string })
      let allFailed = true
      for (const tc of toolCalls) {
        const name = tc.function.name
        const args = tc.function.arguments as Record<string, string>
        if (this.verbose) {
          process.stderr.write(`[tool] ${name}(${JSON.stringify(args)})\n`)
        }
        const toolResult = await this.toolExecutor.execute({ tool: name, args })
        const result = toolResult.success ? toolResult.output : `Error: ${toolResult.error}`
        if (this.verbose) {
          const preview = result.length > 200 ? result.slice(0, 200) + '...' : result
          process.stderr.write(`[result] ${preview}\n`)
        }
        messages.push({ role: 'tool', content: result })

        // Track repeated failures of the same call
        const callKey = `${name}:${JSON.stringify(args)}`
        if (!toolResult.success) {
          if (callKey === lastFailedCall) {
            consecutiveFailures++
          } else {
            lastFailedCall = callKey
            consecutiveFailures = 1
          }
        } else {
          allFailed = false
          lastFailedCall = ''
          consecutiveFailures = 0
        }
      }

      // Break if same call failed twice — model is stuck
      if (allFailed && consecutiveFailures >= 2) {
        if (this.verbose) {
          process.stderr.write(`[stuck] same tool call failed ${consecutiveFailures} times, breaking\n`)
        }
        break
      }
    }

    // Fallback if max rounds exceeded — get final answer without tools
    let final: Awaited<ReturnType<InstanceType<typeof Ollama>['chat']>>
    try {
      final = await this.ollama.chat({
        model: this.config.local_llm.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages] as Parameters<InstanceType<typeof Ollama>['chat']>[0]['messages'],
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
