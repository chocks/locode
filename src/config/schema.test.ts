import { describe, it, expect } from 'vitest'
import { ConfigSchema } from './schema'

const baseConfig = {
  local_llm: { provider: 'ollama', model: 'qwen3:8b', base_url: 'http://localhost:11434' },
  claude: { model: 'claude-sonnet-4-6' },
  routing: { rules: [], ambiguous_resolver: 'local', escalation_threshold: 0.7 },
  context: { handoff: 'summary', max_summary_tokens: 500 },
  token_tracking: { enabled: false, log_file: '/tmp/test.log' },
}

describe('ConfigSchema', () => {
  it('applies default token_threshold of 0.99 when omitted', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.claude.token_threshold).toBe(0.99)
  })

  it('accepts explicit token_threshold', () => {
    const result = ConfigSchema.parse({ ...baseConfig, claude: { model: 'claude-sonnet-4-6', token_threshold: 0.95 } })
    expect(result.claude.token_threshold).toBe(0.95)
  })

  it('rejects token_threshold above 1', () => {
    expect(() => ConfigSchema.parse({ ...baseConfig, claude: { model: 'claude-sonnet-4-6', token_threshold: 1.01 } })).toThrow()
  })

  it('rejects token_threshold below 0', () => {
    expect(() => ConfigSchema.parse({ ...baseConfig, claude: { model: 'claude-sonnet-4-6', token_threshold: -0.01 } })).toThrow()
  })
})
