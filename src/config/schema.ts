import { z } from 'zod'

export const RoutingRuleSchema = z.object({
  pattern: z.string(),
  agent: z.enum(['local', 'claude']),
})

export const ConfigSchema = z.object({
  local_llm: z.object({
    provider: z.literal('ollama'),
    model: z.string(),
    base_url: z.string().url(),
  }),
  claude: z.object({
    model: z.string(),
  }),
  routing: z.object({
    rules: z.array(RoutingRuleSchema),
    ambiguous_resolver: z.enum(['local']),
    escalation_threshold: z.number().min(0).max(1),
  }),
  context: z.object({
    handoff: z.literal('summary'),
    max_summary_tokens: z.number(),
  }),
  token_tracking: z.object({
    enabled: z.boolean(),
    log_file: z.string(),
  }),
})

export type Config = z.infer<typeof ConfigSchema>
