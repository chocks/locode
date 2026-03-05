import Ollama from 'ollama'
import { readFileTool, shellTool, gitTool } from '../tools'

interface LocalConfig {
  local_llm: { provider: 'ollama'; model: string; base_url: string }
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

export class LocalAgent {
  private config: LocalConfig

  constructor(config: LocalConfig) {
    this.config = config
  }

  async run(prompt: string, context?: string): Promise<AgentResult> {
    const messages = []
    if (context) {
      messages.push({ role: 'user' as const, content: `Context from previous work:\n${context}` })
      messages.push({ role: 'assistant' as const, content: 'Understood, I have the context.' })
    }
    messages.push({ role: 'user' as const, content: prompt })

    const response = await Ollama.chat({
      model: this.config.local_llm.model,
      messages,
      system: SYSTEM_PROMPT,
    })

    const content = response.message.content
    const summary = this.extractSummary(content)

    return {
      content,
      summary,
      inputTokens: response.prompt_eval_count ?? 0,
      outputTokens: response.eval_count ?? 0,
    }
  }

  private extractSummary(content: string): string {
    const summaryMatch = content.match(/SUMMARY[:\s]+([\s\S]+?)(?:\n\n|$)/i)
    if (summaryMatch) return summaryMatch[1].trim()
    // Fallback: last paragraph
    const paragraphs = content.trim().split('\n\n')
    return paragraphs[paragraphs.length - 1].slice(0, 500)
  }
}
