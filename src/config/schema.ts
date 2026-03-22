import { z } from 'zod'

export const RoutingRuleSchema = z.object({
  pattern: z.string(),
  agent: z.enum(['local', 'claude']),
})

export const McpStdioServerSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
})

export const McpRemoteServerSchema = z.object({
  type: z.literal('remote'),
  url: z.string().url(),
})

export const McpServerSchema = z.discriminatedUnion('type', [McpStdioServerSchema, McpRemoteServerSchema])

export const AgentConfigSchema = z.object({
  max_iterations: z.number().min(1).max(10).default(5),
  auto_confirm: z.boolean().default(false),
  show_plan: z.boolean().default(true),
  run_validation: z.boolean().default(true),
  validation_command: z.string().optional(),
})

export const RuntimeConfigSchema = z.object({
  artifacts_dir: z.string().default('.locode/runs'),
  approval_mode: z.enum(['prompt', 'auto', 'read-only']).default('prompt'),
  classifier: z.enum(['unified', 'legacy']).default('unified'),
})

export const PerformanceConfigSchema = z.object({
  parallel_reads: z.number().int().min(1).max(16).default(4),
  warm_index_on_startup: z.boolean().default(true),
  cache_context: z.boolean().default(true),
  max_prompt_chars: z.number().int().positive().default(24000),
  lazy_semantic_search: z.boolean().default(true),
})

export const DEFAULT_RUNTIME_CONFIG = RuntimeConfigSchema.parse({})
export const DEFAULT_PERFORMANCE_CONFIG = PerformanceConfigSchema.parse({})

export const ConfigSchema = z.object({
  local_llm: z.object({
    provider: z.literal('ollama'),
    model: z.string(),
    base_url: z.string().url(),
    options: z.record(z.string(), z.number()).optional(),
  }),
  claude: z.object({
    model: z.string(),
    token_threshold: z.number().min(0).max(1).default(0.99),
  }),
  routing: z.object({
    rules: z.array(RoutingRuleSchema),
    ambiguous_resolver: z.enum(['local']),
    escalation_threshold: z.number().min(0).max(1),
  }),
  context: z.object({
    handoff: z.literal('summary'),
    max_summary_tokens: z.number(),
    max_file_bytes: z.number().int().positive().default(51200),
    repo_context_files: z.array(z.string()).default(['AGENTS.md', 'CLAUDE.md']),
  }),
  token_tracking: z.object({
    enabled: z.boolean(),
    log_file: z.string(),
  }),
  agent: AgentConfigSchema.default({
    max_iterations: 5,
    auto_confirm: false,
    show_plan: true,
    run_validation: true,
  }),
  runtime: RuntimeConfigSchema.default({
    artifacts_dir: '.locode/runs',
    approval_mode: 'prompt',
    classifier: 'unified',
  }),
  performance: PerformanceConfigSchema.default({
    parallel_reads: 4,
    warm_index_on_startup: true,
    cache_context: true,
    max_prompt_chars: 24000,
    lazy_semantic_search: true,
  }),
  mcp_servers: z.record(z.string(), McpServerSchema).default({}),
  safety: z.object({
    always_confirm: z.array(z.string()).default([]),
    auto_approve: z.array(z.string()).default([
      'read_file', 'list_files', 'git_query',
    ]),
    allowed_write_paths: z.array(z.string()).default(['.']),
  }).default({
    always_confirm: [],
    auto_approve: ['read_file', 'list_files', 'git_query'],
    allowed_write_paths: ['.'],
  }),
})

export type Config = z.infer<typeof ConfigSchema>
export type PerformanceConfig = z.infer<typeof PerformanceConfigSchema>
