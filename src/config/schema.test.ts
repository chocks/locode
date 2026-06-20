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

  it('defaults mcp_servers to empty object when omitted', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.mcp_servers).toEqual({})
  })

  it('accepts stdio mcp_server with command, args, and env', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      mcp_servers: {
        github: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'test-token' },
        },
      },
    })
    const server = result.mcp_servers.github
    expect(server.type).toBe('stdio')
    if (server.type === 'stdio') {
      expect(server.command).toBe('npx')
      expect(server.args).toEqual(['-y', '@modelcontextprotocol/server-github'])
      expect(server.env.GITHUB_TOKEN).toBe('test-token')
    }
  })

  it('defaults stdio mcp_server args and env when omitted', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      mcp_servers: { test: { type: 'stdio', command: 'my-server' } },
    })
    const server = result.mcp_servers.test
    if (server.type === 'stdio') {
      expect(server.args).toEqual([])
      expect(server.env).toEqual({})
    }
  })

  it('accepts remote mcp_server with url', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      mcp_servers: {
        linear: { type: 'remote', url: 'https://mcp.linear.app/sse' },
      },
    })
    const server = result.mcp_servers.linear
    expect(server.type).toBe('remote')
    if (server.type === 'remote') {
      expect(server.url).toBe('https://mcp.linear.app/sse')
    }
  })

  it('rejects mcp_server without type', () => {
    expect(() => ConfigSchema.parse({
      ...baseConfig,
      mcp_servers: { test: { command: 'foo' } },
    })).toThrow()
  })

  it('rejects remote mcp_server with invalid url', () => {
    expect(() => ConfigSchema.parse({
      ...baseConfig,
      mcp_servers: { test: { type: 'remote', url: 'not-a-url' } },
    })).toThrow()
  })

  it('accepts repo_context_files as array of strings', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      context: { ...baseConfig.context, repo_context_files: ['README.md', 'CONTRIBUTING.md'] },
    })
    expect(result.context.repo_context_files).toEqual(['README.md', 'CONTRIBUTING.md'])
  })

  it('defaults repo_context_files to ["AGENTS.md", "CLAUDE.md"] when not provided', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.context.repo_context_files).toEqual(['AGENTS.md', 'CLAUDE.md'])
  })

  it('defaults safety config when omitted', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.safety.always_confirm).toEqual([])
    expect(result.safety.auto_approve).toEqual(['read_file', 'list_files', 'git_query'])
    expect(result.safety.allowed_write_paths).toEqual(['.'])
  })

  it('accepts custom safety config', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      safety: {
        always_confirm: ['write_file'],
        auto_approve: ['read_file'],
        allowed_write_paths: ['src', 'tests'],
      },
    })
    expect(result.safety.always_confirm).toEqual(['write_file'])
    expect(result.safety.allowed_write_paths).toEqual(['src', 'tests'])
  })

  it('defaults runtime config when omitted', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.runtime.artifacts_dir).toBe('.locode/runs')
    expect(result.runtime.approval_mode).toBe('prompt')
    expect(result.runtime.classifier).toBe('unified')
  })

  it('defaults performance config when omitted', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.performance.parallel_reads).toBe(4)
    expect(result.performance.cache_dir).toBe('.locode/context-cache')
    expect(result.performance.cache_max_entries).toBe(200)
    expect(result.performance.cache_max_bytes).toBe(5 * 1024 * 1024)
    expect(result.performance.max_prompt_chars).toBe(24000)
    expect(result.performance.lazy_semantic_search).toBe(true)
  })

  it('defaults index config when omitted', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.index.enabled).toBe(true)
    expect(result.index.ignore).toContain('node_modules')
    expect(result.index.ignore).toContain('dist')
    expect(result.index.ignore).toContain('.git')
    expect(result.index.languages).toContain('typescript')
    expect(result.index.languages).toContain('javascript')
    expect(result.index.chunk_size).toBe(50)
    expect(result.index.storage_dir).toBe('.locode/index')
    expect(result.index.auto_update).toBe(true)
  })

  it('accepts custom index config', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      index: {
        enabled: false,
        ignore: ['build', 'vendor'],
        languages: ['typescript', 'go'],
        chunk_size: 100,
        storage_dir: '.cache/index',
        auto_update: false,
      },
    })
    expect(result.index.enabled).toBe(false)
    expect(result.index.ignore).toEqual(['build', 'vendor'])
    expect(result.index.languages).toEqual(['typescript', 'go'])
    expect(result.index.chunk_size).toBe(100)
    expect(result.index.storage_dir).toBe('.cache/index')
    expect(result.index.auto_update).toBe(false)
  })

  it('rejects non-positive chunk_size', () => {
    expect(() => ConfigSchema.parse({
      ...baseConfig,
      index: { chunk_size: 0 },
    })).toThrow()
  })

  it('defaults context_retrieval config when omitted', () => {
    const result = ConfigSchema.parse(baseConfig)
    expect(result.context_retrieval.max_files).toBe(5)
    expect(result.context_retrieval.max_tokens_per_file).toBe(2000)
    expect(result.context_retrieval.max_total_tokens).toBe(8000)
    expect(result.context_retrieval.strategy).toBe('deterministic-first')
    expect(result.context_retrieval.confidence_threshold).toBe(0.7)
  })

  it('accepts custom context_retrieval config', () => {
    const result = ConfigSchema.parse({
      ...baseConfig,
      context_retrieval: {
        max_files: 10,
        max_tokens_per_file: 4000,
        max_total_tokens: 16000,
        strategy: 'semantic-first',
        confidence_threshold: 0.85,
      },
    })
    expect(result.context_retrieval.max_files).toBe(10)
    expect(result.context_retrieval.max_total_tokens).toBe(16000)
    expect(result.context_retrieval.strategy).toBe('semantic-first')
    expect(result.context_retrieval.confidence_threshold).toBe(0.85)
  })

  it('rejects context_retrieval confidence_threshold out of range', () => {
    expect(() => ConfigSchema.parse({
      ...baseConfig,
      context_retrieval: { confidence_threshold: 1.5 },
    })).toThrow()
    expect(() => ConfigSchema.parse({
      ...baseConfig,
      context_retrieval: { confidence_threshold: -0.1 },
    })).toThrow()
  })

  it('rejects invalid context_retrieval strategy', () => {
    expect(() => ConfigSchema.parse({
      ...baseConfig,
      context_retrieval: { strategy: 'random' },
    })).toThrow()
  })
})
