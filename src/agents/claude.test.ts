import { describe, it, expect, vi } from 'vitest'
import { ClaudeAgent } from './claude'

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Here is the refactored code.' }],
        usage: { input_tokens: 1500, output_tokens: 300 },
      }),
    }
  },
}))

describe('ClaudeAgent', () => {
  const config = { claude: { model: 'claude-sonnet-4-6' } }

  it('returns a response and token counts', async () => {
    const agent = new ClaudeAgent(config)
    const result = await agent.run('Refactor this function for clarity', 'previous summary context')
    expect(result.content).toContain('refactored')
    expect(result.inputTokens).toBe(1500)
    expect(result.outputTokens).toBe(300)
  })
})
