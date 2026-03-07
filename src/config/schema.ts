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

export const ConfigSchema = z.object({
  local_llm: z.object({
    provider: z.literal('ollama'),
    model: z.string(),
    base_url: z.string().url(),
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
    repo_context_files: z.array(z.string()).default(['CLAUDE.md']),
  }),
  token_tracking: z.object({
    enabled: z.boolean(),
    log_file: z.string(),
  }),
  mcp_servers: z.record(z.string(), McpServerSchema).default({}),
})

export type Config = z.infer<typeof ConfigSchema>
