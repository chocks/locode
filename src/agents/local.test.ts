import { describe, it, expect, vi, beforeEach } from 'vitest'
import Ollama from 'ollama'
import { LocalAgent } from './local'

// Mock ollama to avoid requiring a running instance in tests
vi.mock('ollama', () => ({
  default: {
    chat: vi.fn().mockResolvedValue({
      message: { content: 'The answer is 42.', tool_calls: [] },
      prompt_eval_count: 50,
      eval_count: 10,
    }),
  },
}))

describe('LocalAgent', () => {
  const config = {
    local_llm: { provider: 'ollama' as const, model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' },
  }

  beforeEach(() => {
    vi.mocked(Ollama.chat).mockReset()
    vi.mocked(Ollama.chat).mockResolvedValue({
      message: { content: 'The answer is 42.', tool_calls: [] },
      prompt_eval_count: 50,
      eval_count: 10,
    } as unknown as Awaited<ReturnType<typeof Ollama.chat>>)
  })

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

  it('truncates summary to max_summary_tokens', async () => {
    const configWithSmallSummary = {
      local_llm: { provider: 'ollama' as const, model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' },
      context: { handoff: 'summary' as const, max_summary_tokens: 10 },
    }
    const agent = new LocalAgent(configWithSmallSummary)
    const result = await agent.run('explore the repo')
    expect(result.summary.length).toBeLessThanOrEqual(10)
  })

  it('calls a tool when the model requests it', async () => {
    const mockChat = vi.mocked(Ollama.chat)
    // First call returns a tool_call, second call returns final answer
    mockChat
      .mockResolvedValueOnce({
        message: {
          content: '',
          tool_calls: [{ function: { name: 'shell', arguments: { command: 'echo hello' } } }],
        },
        prompt_eval_count: 30,
        eval_count: 5,
      } as unknown as Awaited<ReturnType<typeof Ollama.chat>>)
      .mockResolvedValueOnce({
        message: { content: 'The output was: hello', tool_calls: [] },
        prompt_eval_count: 40,
        eval_count: 8,
      } as unknown as Awaited<ReturnType<typeof Ollama.chat>>)

    const agent = new LocalAgent({ local_llm: { provider: 'ollama' as const, model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' } })
    const result = await agent.run('what does echo hello output?')
    expect(result.content).toContain('hello')
    expect(mockChat).toHaveBeenCalledTimes(2)
  })
})
