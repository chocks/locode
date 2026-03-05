import { describe, it, expect, vi } from 'vitest'
import { LocalAgent } from './local'

// Mock ollama to avoid requiring a running instance in tests
vi.mock('ollama', () => ({
  default: {
    chat: vi.fn().mockResolvedValue({
      message: { content: 'The answer is 42.' },
      prompt_eval_count: 50,
      eval_count: 10,
    }),
  },
}))

describe('LocalAgent', () => {
  const config = {
    local_llm: { provider: 'ollama' as const, model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' },
  }

  it('returns a response and token counts', async () => {
    const agent = new LocalAgent(config)
    const result = await agent.run('What is 6 times 7?')
    expect(result.content).toContain('42')
    expect(result.inputTokens).toBe(50)
    expect(result.outputTokens).toBe(10)
  })

  it('produces a summary for handoff', async () => {
    const agent = new LocalAgent(config)
    const result = await agent.run('explore the repo structure')
    expect(result.summary).toBeDefined()
    expect(typeof result.summary).toBe('string')
  })
})
