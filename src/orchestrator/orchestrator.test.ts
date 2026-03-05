import { describe, it, expect, vi } from 'vitest'
import { Orchestrator } from './orchestrator'

const mockConfig = {
  local_llm: { provider: 'ollama' as const, model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' },
  claude: { model: 'claude-sonnet-4-6' },
  routing: {
    rules: [{ pattern: 'grep|find|read', agent: 'local' as const }],
    ambiguous_resolver: 'local' as const,
    escalation_threshold: 0.7,
  },
  context: { handoff: 'summary' as const, max_summary_tokens: 500 },
  token_tracking: { enabled: false, log_file: '/tmp/test.log' },
}

describe('Orchestrator', () => {
  it('routes to local agent and records tokens', async () => {
    const mockLocal = { run: vi.fn().mockResolvedValue({ content: 'found files', summary: 'Found 3 files.', inputTokens: 100, outputTokens: 30 }) }
    const mockClaude = { run: vi.fn() }
    const orch = new Orchestrator(mockConfig, mockLocal as any, mockClaude as any)

    const result = await orch.process('find all .ts files in src/')
    expect(result.agent).toBe('local')
    expect(result.content).toBe('found files')
    expect(mockLocal.run).toHaveBeenCalled()
    expect(mockClaude.run).not.toHaveBeenCalled()
  })
})
