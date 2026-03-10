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
    local_llm: { provider: 'ollama' as const, model: 'qwen3:8b', base_url: 'http://localhost:11434' },
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
      local_llm: { provider: 'ollama' as const, model: 'qwen3:8b', base_url: 'http://localhost:11434' },
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

    const agent = new LocalAgent({ local_llm: { provider: 'ollama' as const, model: 'qwen3:8b', base_url: 'http://localhost:11434' } })
    const result = await agent.run('what does echo hello output?')
    expect(result.content).toContain('hello')
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('includes tool_calls in assistant message history', async () => {
    const mockChat = vi.mocked(Ollama.chat)
    const toolCalls = [{ function: { name: 'shell', arguments: { command: 'ls' } } }]
    mockChat
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: 'Let me check.',
          tool_calls: toolCalls,
        },
        prompt_eval_count: 30,
        eval_count: 5,
      } as unknown as Awaited<ReturnType<typeof Ollama.chat>>)
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Done.', tool_calls: [] },
        prompt_eval_count: 40,
        eval_count: 8,
      } as unknown as Awaited<ReturnType<typeof Ollama.chat>>)

    const agent = new LocalAgent(config)
    await agent.run('list files')

    // Second call should have assistant message WITH tool_calls in history
    const secondCall = mockChat.mock.calls[1][0]
    const assistantMsg = secondCall.messages.find(
      (m: { role: string }) => m.role === 'assistant'
    ) as { role: string; content: string; tool_calls?: unknown[] }
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg.tool_calls).toEqual(toolCalls)
  })

  it('treats malformed tool_calls as no tool calls', async () => {
    const mockChat = vi.mocked(Ollama.chat)
    // Model returns tool_calls with null/undefined entries
    mockChat.mockResolvedValueOnce({
      message: {
        role: 'assistant',
        content: 'Hello!',
        tool_calls: [null, undefined],
      },
      prompt_eval_count: 50,
      eval_count: 10,
    } as unknown as Awaited<ReturnType<typeof Ollama.chat>>)

    const agent = new LocalAgent(config)
    const result = await agent.run('hello')

    // Should return the response directly, not crash or loop
    expect(result.content).toBe('Hello!')
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('strips <think> tags from response content', async () => {
    const mockChat = vi.mocked(Ollama.chat)
    mockChat.mockResolvedValueOnce({
      message: {
        role: 'assistant',
        content: 'Let me think about this...\n</think>\n\nHello! How can I help?\n\nSUMMARY\nGreeting response.',
        tool_calls: [],
      },
      prompt_eval_count: 50,
      eval_count: 20,
    } as unknown as Awaited<ReturnType<typeof Ollama.chat>>)

    const agent = new LocalAgent(config)
    const result = await agent.run('hello')

    expect(result.content).not.toContain('</think>')
    expect(result.content).not.toContain('Let me think about this')
    expect(result.content).toBe('Hello! How can I help?\n\nSUMMARY\nGreeting response.')
  })

  it('strips full <think>...</think> blocks from response', async () => {
    const mockChat = vi.mocked(Ollama.chat)
    mockChat.mockResolvedValueOnce({
      message: {
        role: 'assistant',
        content: '<think>\nI should greet the user.\n</think>\n\nHi there!',
        tool_calls: [],
      },
      prompt_eval_count: 50,
      eval_count: 15,
    } as unknown as Awaited<ReturnType<typeof Ollama.chat>>)

    const agent = new LocalAgent(config)
    const result = await agent.run('hello')

    expect(result.content).toBe('Hi there!')
  })

  it('passes options to Ollama.chat when configured', async () => {
    const configWithOptions = {
      local_llm: {
        provider: 'ollama' as const,
        model: 'qwen3:8b',
        base_url: 'http://localhost:11434',
        options: { num_ctx: 1024, num_thread: 4 },
      },
    }
    const agent = new LocalAgent(configWithOptions)
    await agent.run('hello')

    const chatCall = vi.mocked(Ollama.chat).mock.calls[0][0]
    expect(chatCall.options).toEqual({ num_ctx: 1024, num_thread: 4 })
  })

  it('omits options from Ollama.chat when not configured', async () => {
    const agent = new LocalAgent(config)
    await agent.run('hello')

    const chatCall = vi.mocked(Ollama.chat).mock.calls[0][0]
    expect(chatCall.options).toBeUndefined()
  })

  it('throws a helpful error when Ollama is not reachable', async () => {
    const mockChat = vi.mocked(Ollama.chat)
    const fetchError = new TypeError('fetch failed')
    fetchError.cause = { code: 'ECONNREFUSED' }
    mockChat.mockRejectedValue(fetchError)

    const agent = new LocalAgent(config)
    await expect(agent.run('hello')).rejects.toThrow(/[Oo]llama/)
    await expect(agent.run('hello')).rejects.toThrow(/running/)
  })

  it('re-throws non-connection errors from Ollama unchanged', async () => {
    const mockChat = vi.mocked(Ollama.chat)
    mockChat.mockRejectedValueOnce(new Error('model not found'))

    const agent = new LocalAgent(config)
    await expect(agent.run('hello')).rejects.toThrow('model not found')
  })

  it('includes repo context in system prompt when provided', async () => {
    const agent = new LocalAgent(config)
    await agent.run('hello', undefined, '--- CLAUDE.md ---\n# My Project')

    const chatCall = vi.mocked(Ollama.chat).mock.calls[0][0]
    const systemMsg = chatCall.messages[0]
    expect(systemMsg.role).toBe('system')
    expect((systemMsg as { content: string }).content).toContain('# My Project')
    expect((systemMsg as { content: string }).content).toContain('You are a local coding assistant')
  })
})
