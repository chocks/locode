import Anthropic from '@anthropic-ai/sdk'
import { AgentResult } from './local'

interface ClaudeConfig {
  claude: { model: string }
}

export class ClaudeAgent {
  private client: Anthropic
  private config: ClaudeConfig

  constructor(config: ClaudeConfig) {
    this.config = config
    this.client = new Anthropic()  // reads ANTHROPIC_API_KEY from env
  }

  async run(prompt: string, context?: string): Promise<AgentResult> {
    const messages: Anthropic.MessageParam[] = []

    if (context) {
      messages.push({
        role: 'user',
        content: `Context summary from local agent:\n${context}\n\nContinuing task: ${prompt}`,
      })
    } else {
      messages.push({ role: 'user', content: prompt })
    }

    const response = await this.client.messages.create({
      model: this.config.claude.model,
      max_tokens: 8096,
      messages,
    })

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('\n')

    return {
      content,
      summary: content.slice(0, 500),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  }
}
