# Token Exhaustion Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When Claude's daily token limit is nearly exhausted, automatically switch to the local agent mid-session, and switch back to Claude when the limit resets.

**Architecture:** `ClaudeAgent.run()` switches to `.withResponse()` to read rate-limit headers on every response. The `Orchestrator` tracks a `localFallback` state — triggered when token usage exceeds `config.claude.token_threshold` — and attempts to switch back when `Date.now() >= resetsAt`. Context is preserved via `ClaudeAgent.generateHandoffSummary()` both ways.

**Tech Stack:** Anthropic SDK `.withResponse()`, Zod config schema, Vitest mocks

---

### Task 1: Add `token_threshold` to config schema and locode.yaml

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `locode.yaml`
- Modify: `src/orchestrator/orchestrator.test.ts` (update mockConfig)

**Step 1: Write the failing test**

In `src/config/schema.test.ts` (create if it doesn't exist):

```ts
import { describe, it, expect } from 'vitest'
import { ConfigSchema } from './schema'

describe('ConfigSchema', () => {
  it('applies default token_threshold of 0.99 when omitted', () => {
    const result = ConfigSchema.parse({
      local_llm: { provider: 'ollama', model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' },
      claude: { model: 'claude-sonnet-4-6' },
      routing: { rules: [], ambiguous_resolver: 'local', escalation_threshold: 0.7 },
      context: { handoff: 'summary', max_summary_tokens: 500 },
      token_tracking: { enabled: false, log_file: '/tmp/test.log' },
    })
    expect(result.claude.token_threshold).toBe(0.99)
  })

  it('accepts explicit token_threshold', () => {
    const result = ConfigSchema.parse({
      local_llm: { provider: 'ollama', model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' },
      claude: { model: 'claude-sonnet-4-6', token_threshold: 0.95 },
      routing: { rules: [], ambiguous_resolver: 'local', escalation_threshold: 0.7 },
      context: { handoff: 'summary', max_summary_tokens: 500 },
      token_tracking: { enabled: false, log_file: '/tmp/test.log' },
    })
    expect(result.claude.token_threshold).toBe(0.95)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/chockalingameswaramurthy/Documents/repos/locode && npm test -- src/config/schema.test.ts
```

Expected: FAIL — `token_threshold` does not exist on schema.

**Step 3: Add `token_threshold` to schema**

In `src/config/schema.ts`, update the `claude` object:

```ts
claude: z.object({
  model: z.string(),
  token_threshold: z.number().min(0).max(1).default(0.99),
}),
```

**Step 4: Update `locode.yaml`**

```yaml
claude:
  model: claude-sonnet-4-6
  token_threshold: 0.99
```

**Step 5: Update `mockConfig` in orchestrator tests**

In `src/orchestrator/orchestrator.test.ts`, update the `claude` entry in `mockConfig`:

```ts
claude: { model: 'claude-sonnet-4-6', token_threshold: 0.99 },
```

**Step 6: Run all tests**

```bash
npm test
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add src/config/schema.ts src/config/schema.test.ts locode.yaml src/orchestrator/orchestrator.test.ts
git commit -m "feat: add token_threshold config field with default 0.99"
```

---

### Task 2: Refactor ClaudeAgent.run() to use `.withResponse()` and return `RateLimitInfo`

**Files:**
- Modify: `src/agents/claude.ts`
- Modify: `src/agents/claude.test.ts`

**Step 1: Write the failing tests**

Replace the contents of `src/agents/claude.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { ClaudeAgent } from './claude'

const makeHeaders = (remaining: string, limit: string, reset: string) => ({
  get: (h: string) => {
    if (h === 'anthropic-ratelimit-tokens-remaining') return remaining
    if (h === 'anthropic-ratelimit-tokens-limit') return limit
    if (h === 'anthropic-ratelimit-tokens-reset') return reset
    return null
  },
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockReturnValue({
        withResponse: vi.fn().mockResolvedValue({
          data: {
            content: [{ type: 'text', text: 'Here is the refactored code.' }],
            usage: { input_tokens: 1500, output_tokens: 300 },
          },
          response: {
            headers: makeHeaders('50000', '100000', '2026-03-07T00:00:00.000Z'),
          },
        }),
      }),
    }
  },
}))

describe('ClaudeAgent', () => {
  const config = { claude: { model: 'claude-sonnet-4-6', token_threshold: 0.99 } }

  it('returns content and token counts', async () => {
    const agent = new ClaudeAgent(config)
    const result = await agent.run('Refactor this function', 'previous context')
    expect(result.content).toContain('refactored')
    expect(result.inputTokens).toBe(1500)
    expect(result.outputTokens).toBe(300)
  })

  it('parses rate limit headers into rateLimitInfo', async () => {
    const agent = new ClaudeAgent(config)
    const result = await agent.run('Refactor this function')
    expect(result.rateLimitInfo).not.toBeNull()
    expect(result.rateLimitInfo!.tokensRemaining).toBe(50000)
    expect(result.rateLimitInfo!.tokensLimit).toBe(100000)
    expect(result.rateLimitInfo!.resetsAt).toBe(new Date('2026-03-07T00:00:00.000Z').getTime())
  })

  it('returns null rateLimitInfo when headers are absent', async () => {
    const { default: MockAnthropic } = await import('@anthropic-ai/sdk')
    const instance = new MockAnthropic() as unknown as { messages: { create: ReturnType<typeof vi.fn> } }
    instance.messages.create.mockReturnValueOnce({
      withResponse: vi.fn().mockResolvedValue({
        data: {
          content: [{ type: 'text', text: 'response' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        response: { headers: { get: () => null } },
      }),
    })

    const agent = new ClaudeAgent(config)
    const result = await agent.run('prompt')
    expect(result.rateLimitInfo).toBeNull()
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/agents/claude.test.ts
```

Expected: FAIL — `rateLimitInfo` does not exist.

**Step 3: Rewrite `src/agents/claude.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk'
import { AgentResult } from './local'

interface ClaudeConfig {
  claude: { model: string; token_threshold: number }
}

export interface RateLimitInfo {
  tokensRemaining: number
  tokensLimit: number
  resetsAt: number  // Unix ms
}

export interface ClaudeAgentResult extends AgentResult {
  rateLimitInfo: RateLimitInfo | null
}

function nextMidnightUtc(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
}

export class ClaudeAgent {
  private client: Anthropic
  private config: ClaudeConfig

  constructor(config: ClaudeConfig) {
    this.config = config
    this.client = new Anthropic()
  }

  async run(prompt: string, context?: string): Promise<ClaudeAgentResult> {
    const messages: Anthropic.MessageParam[] = []

    if (context) {
      messages.push({
        role: 'user',
        content: `Context summary from previous work:\n${context}\n\nContinuing task: ${prompt}`,
      })
    } else {
      messages.push({ role: 'user', content: prompt })
    }

    const { data: response, response: httpResponse } = await this.client.messages.create({
      model: this.config.claude.model,
      max_tokens: 8096,
      messages,
    }).withResponse()

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('\n')

    return {
      content,
      summary: content.slice(0, 500),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      rateLimitInfo: this.parseRateLimitHeaders(httpResponse.headers),
    }
  }

  async generateHandoffSummary(context: string): Promise<string> {
    try {
      const { data: response } = await this.client.messages.create({
        model: this.config.claude.model,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Summarize the current work context in 150 tokens or less for handoff to a local agent:\n\n${context}`,
        }],
      }).withResponse()
      return response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('\n')
    } catch {
      return context.slice(0, 500)
    }
  }

  private parseRateLimitHeaders(headers: { get(name: string): string | null }): RateLimitInfo | null {
    const remaining = headers.get('anthropic-ratelimit-tokens-remaining')
    const limit = headers.get('anthropic-ratelimit-tokens-limit')
    const reset = headers.get('anthropic-ratelimit-tokens-reset')
    if (remaining === null || limit === null) return null
    return {
      tokensRemaining: parseInt(remaining, 10),
      tokensLimit: parseInt(limit, 10),
      resetsAt: reset ? new Date(reset).getTime() : nextMidnightUtc(),
    }
  }
}
```

**Step 4: Run tests**

```bash
npm test -- src/agents/claude.test.ts
```

Expected: all 3 tests pass.

**Step 5: Run all tests**

```bash
npm test
```

Expected: all pass. If orchestrator tests fail due to `ClaudeAgentResult` shape change, add `rateLimitInfo: null` to `mockClaude.run` mock return values and add `generateHandoffSummary: vi.fn()` to `mockClaude` objects.

**Step 6: Commit**

```bash
git add src/agents/claude.ts src/agents/claude.test.ts
git commit -m "feat: refactor ClaudeAgent to read rate limit headers via withResponse()"
```

---

### Task 3: Add Claude→Local fallback detection to Orchestrator

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`
- Modify: `src/orchestrator/orchestrator.test.ts`

This task wires the token threshold check and fallback trigger. When Claude's used fraction exceeds `token_threshold`, locode calls `generateHandoffSummary()`, sets `localFallback = true`, and routes subsequent prompts to local.

**Step 1: Write the failing tests**

Add these tests to `src/orchestrator/orchestrator.test.ts`:

```ts
it('switches to local fallback when token threshold is exceeded', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'

  const mockLocal = {
    run: vi.fn().mockResolvedValue({ content: 'local result', summary: 'local summary', inputTokens: 50, outputTokens: 20 }),
  }
  const mockClaude = {
    run: vi.fn().mockResolvedValue({
      content: 'claude result',
      summary: 'claude summary',
      inputTokens: 500,
      outputTokens: 100,
      rateLimitInfo: { tokensRemaining: 100, tokensLimit: 100000, resetsAt: Date.now() + 3600000 },
    }),
    generateHandoffSummary: vi.fn().mockResolvedValue('handoff summary from claude'),
  }

  const orchConfig = {
    ...mockConfig,
    claude: { ...mockConfig.claude, token_threshold: 0.99 },
    routing: { ...mockConfig.routing, rules: [{ pattern: 'refactor', agent: 'claude' as const }] },
  }
  const orch = new Orchestrator(
    orchConfig,
    mockLocal as unknown as import('../agents/local').LocalAgent,
    mockClaude as unknown as import('../agents/claude').ClaudeAgent,
  )

  // First call: Claude responds, threshold exceeded (99.9% used)
  await orch.process('refactor this function')
  expect(mockClaude.generateHandoffSummary).toHaveBeenCalledWith('claude summary')
  expect(orch.isLocalFallback()).toBe(true)

  // Second call: should go to local with handoff summary
  await orch.process('refactor this function')
  expect(mockLocal.run).toHaveBeenCalledWith('refactor this function', 'handoff summary from claude')
})

it('stays on Claude when token threshold is not exceeded', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'

  const mockLocal = { run: vi.fn() }
  const mockClaude = {
    run: vi.fn().mockResolvedValue({
      content: 'claude result',
      summary: 'summary',
      inputTokens: 500,
      outputTokens: 100,
      rateLimitInfo: { tokensRemaining: 50000, tokensLimit: 100000, resetsAt: Date.now() + 3600000 },
    }),
    generateHandoffSummary: vi.fn(),
  }

  const orchConfig = {
    ...mockConfig,
    claude: { ...mockConfig.claude, token_threshold: 0.99 },
    routing: { ...mockConfig.routing, rules: [{ pattern: 'refactor', agent: 'claude' as const }] },
  }
  const orch = new Orchestrator(
    orchConfig,
    mockLocal as unknown as import('../agents/local').LocalAgent,
    mockClaude as unknown as import('../agents/claude').ClaudeAgent,
  )

  await orch.process('refactor this function')
  expect(mockClaude.generateHandoffSummary).not.toHaveBeenCalled()
  expect(orch.isLocalFallback()).toBe(false)
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/orchestrator/orchestrator.test.ts
```

Expected: FAIL — `isLocalFallback` does not exist, fallback logic not implemented.

**Step 3: Update `src/orchestrator/orchestrator.ts`**

Replace the file with:

```ts
import { Router, AgentType } from './router'
import { LocalAgent, AgentResult } from '../agents/local'
import { ClaudeAgent, ClaudeAgentResult, RateLimitInfo } from '../agents/claude'
import { TokenTracker } from '../tracker/tracker'
import type { Config } from '../config/schema'

export interface OrchestratorResult extends AgentResult {
  agent: AgentType
  routeMethod: 'rule' | 'llm'
}

interface OrchestratorOptions {
  localOnly?: boolean
  claudeOnly?: boolean
}

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && 'status' in err && (err as { status: number }).status === 429
}

export class Orchestrator {
  private router: Router
  private localAgent: LocalAgent
  private claudeAgent: ClaudeAgent
  private tracker: TokenTracker
  private config: Config
  private localOnly: boolean
  private claudeOnly: boolean
  private localFallback: boolean = false
  private fallbackSummary: string = ''
  private resetsAt: number = 0

  constructor(config: Config, localAgent?: LocalAgent, claudeAgent?: ClaudeAgent, options?: OrchestratorOptions) {
    this.config = config
    this.router = new Router(config)
    this.localAgent = localAgent ?? new LocalAgent(config)
    this.claudeAgent = claudeAgent ?? new ClaudeAgent(config)
    this.tracker = new TokenTracker(config.token_tracking)
    this.claudeOnly = options?.claudeOnly ?? false
    this.localOnly = options?.localOnly ?? (!process.env.ANTHROPIC_API_KEY)
  }

  isLocalOnly(): boolean { return this.localOnly }
  isClaudeOnly(): boolean { return this.claudeOnly }
  isLocalFallback(): boolean { return this.localFallback }

  async process(prompt: string, previousSummary?: string): Promise<OrchestratorResult> {
    // Token exhaustion fallback: route to local until reset time
    if (this.localFallback && Date.now() < this.resetsAt) {
      const result = await this.localAgent.run(prompt, this.fallbackSummary)
      this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
      return { ...result, agent: 'local', routeMethod: 'rule' }
    }

    // Past reset time — clear fallback and try Claude below
    if (this.localFallback && Date.now() >= this.resetsAt) {
      this.localFallback = false
    }

    if (this.claudeOnly) {
      const result = await this.claudeAgent.run(prompt, previousSummary)
      this.tracker.record({ agent: 'claude', input: result.inputTokens, output: result.outputTokens, model: this.config.claude.model })
      await this.checkAndTriggerFallback(result)
      return { ...result, agent: 'claude', routeMethod: 'rule' }
    }

    if (this.localOnly) {
      const result = await this.localAgent.run(prompt, previousSummary)
      this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
      return { ...result, agent: 'local', routeMethod: 'rule' }
    }

    const decision = await this.router.classify(prompt)

    let result: AgentResult
    if (decision.agent === 'claude') {
      try {
        const claudeResult = await this.claudeAgent.run(prompt, previousSummary)
        await this.checkAndTriggerFallback(claudeResult)
        result = claudeResult
      } catch (err) {
        console.error(`[fallback] Claude unavailable (${(err as Error).message}), using local agent`)
        result = await this.localAgent.run(prompt, previousSummary)
        decision.agent = 'local'
      }
    } else {
      result = await this.localAgent.run(prompt, previousSummary)
    }

    this.tracker.record({
      agent: decision.agent,
      input: result.inputTokens,
      output: result.outputTokens,
      model: decision.agent === 'local' ? this.config.local_llm.model : this.config.claude.model,
    })

    return { ...result, agent: decision.agent, routeMethod: decision.method }
  }

  getStats() { return this.tracker.getStats() }
  resetStats() { this.tracker.reset() }

  private async checkAndTriggerFallback(result: ClaudeAgentResult): Promise<void> {
    const info = result.rateLimitInfo
    if (!info || info.tokensLimit === 0) return

    const usedFraction = (info.tokensLimit - info.tokensRemaining) / info.tokensLimit
    if (usedFraction < this.config.claude.token_threshold) return

    console.error(`[locode] Claude tokens at ${Math.round(usedFraction * 100)}%, switching to local agent`)

    try {
      this.fallbackSummary = await this.claudeAgent.generateHandoffSummary(result.summary)
    } catch {
      this.fallbackSummary = result.summary
    }

    this.localFallback = true
    this.resetsAt = info.resetsAt
  }
}
```

**Step 4: Fix existing mockClaude objects in orchestrator.test.ts**

Every `mockClaude` that has `run: vi.fn().mockResolvedValue({...})` needs:
- `rateLimitInfo: null` added to the resolved value
- `generateHandoffSummary: vi.fn()` added to the mock object

Example update for the existing tests:

```ts
const mockClaude = {
  run: vi.fn().mockResolvedValue({
    content: 'claude result',
    summary: 'summary',
    inputTokens: 500,
    outputTokens: 100,
    rateLimitInfo: null,
  }),
  generateHandoffSummary: vi.fn(),
}
```

Apply this pattern to all 4 existing `mockClaude` definitions in the file.

**Step 5: Run all tests**

```bash
npm test
```

Expected: all tests pass including the 2 new ones.

**Step 6: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/orchestrator/orchestrator.test.ts
git commit -m "feat: add Claude-to-local fallback when token threshold exceeded"
```

---

### Task 4: Add Local→Claude switch-back logic

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`
- Modify: `src/orchestrator/orchestrator.test.ts`

When `localFallback` is true and `Date.now() >= resetsAt`, the orchestrator tries Claude. If it succeeds, it switches back. If still rate-limited, it stays local and defers the next retry by 1 hour.

**Step 1: Write the failing tests**

Add to `src/orchestrator/orchestrator.test.ts`:

```ts
it('switches back to Claude after reset time passes', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'

  const mockLocal = {
    run: vi.fn().mockResolvedValue({ content: 'local', summary: 'local summary', inputTokens: 50, outputTokens: 20 }),
  }
  const mockClaude = {
    run: vi.fn().mockResolvedValue({
      content: 'claude back',
      summary: 'claude summary',
      inputTokens: 500,
      outputTokens: 100,
      rateLimitInfo: { tokensRemaining: 80000, tokensLimit: 100000, resetsAt: Date.now() + 86400000 },
    }),
    generateHandoffSummary: vi.fn().mockResolvedValue('handoff summary'),
  }

  const orchConfig = {
    ...mockConfig,
    claude: { ...mockConfig.claude, token_threshold: 0.99 },
    routing: { ...mockConfig.routing, rules: [{ pattern: 'refactor', agent: 'claude' as const }] },
  }
  const orch = new Orchestrator(
    orchConfig,
    mockLocal as unknown as import('../agents/local').LocalAgent,
    mockClaude as unknown as import('../agents/claude').ClaudeAgent,
  )

  // Force into fallback state with an already-expired resetsAt
  // @ts-expect-error accessing private for test
  orch.localFallback = true
  // @ts-expect-error accessing private for test
  orch.resetsAt = Date.now() - 1000  // already past
  // @ts-expect-error accessing private for test
  orch.fallbackSummary = 'work done by local agent'

  const result = await orch.process('refactor this function')
  expect(result.agent).toBe('claude')
  expect(result.content).toBe('claude back')
  expect(mockClaude.run).toHaveBeenCalledWith('refactor this function', 'work done by local agent')
  expect(orch.isLocalFallback()).toBe(false)
})

it('stays local when switch-back attempt is still rate-limited', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'

  const rateLimitError = Object.assign(new Error('rate limit'), { status: 429 })

  const mockLocal = {
    run: vi.fn().mockResolvedValue({ content: 'local', summary: 'local summary', inputTokens: 50, outputTokens: 20 }),
  }
  const mockClaude = {
    run: vi.fn().mockRejectedValue(rateLimitError),
    generateHandoffSummary: vi.fn(),
  }

  const orchConfig = {
    ...mockConfig,
    claude: { ...mockConfig.claude, token_threshold: 0.99 },
  }
  const orch = new Orchestrator(
    orchConfig,
    mockLocal as unknown as import('../agents/local').LocalAgent,
    mockClaude as unknown as import('../agents/claude').ClaudeAgent,
  )

  // @ts-expect-error accessing private for test
  orch.localFallback = true
  // @ts-expect-error accessing private for test
  orch.resetsAt = Date.now() - 1000  // past reset time
  // @ts-expect-error accessing private for test
  orch.fallbackSummary = 'local context'

  const beforeResetsAt = Date.now() + 3600000 - 1000  // ~1 hour from now

  const result = await orch.process('any prompt')
  expect(result.agent).toBe('local')
  expect(orch.isLocalFallback()).toBe(true)
  // @ts-expect-error accessing private for test
  expect(orch.resetsAt).toBeGreaterThan(beforeResetsAt)  // pushed 1 hour forward
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/orchestrator/orchestrator.test.ts
```

Expected: the 2 new switch-back tests fail.

**Step 3: Add switch-back logic to `src/orchestrator/orchestrator.ts`**

Replace the fallback block at the top of `process()`:

```ts
// Token exhaustion fallback
if (this.localFallback) {
  if (Date.now() < this.resetsAt) {
    // Still before reset — stay local
    const result = await this.localAgent.run(prompt, this.fallbackSummary)
    this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
    return { ...result, agent: 'local', routeMethod: 'rule' }
  }

  // Past reset — attempt switch-back to Claude
  try {
    const claudeResult = await this.claudeAgent.run(prompt, this.fallbackSummary)
    this.localFallback = false
    this.fallbackSummary = ''
    console.error('[locode] Claude available again, resuming')
    this.tracker.record({ agent: 'claude', input: claudeResult.inputTokens, output: claudeResult.outputTokens, model: this.config.claude.model })
    await this.checkAndTriggerFallback(claudeResult)
    return { ...claudeResult, agent: 'claude', routeMethod: 'rule' }
  } catch (err) {
    if (isRateLimitError(err)) {
      this.resetsAt = Date.now() + 60 * 60 * 1000  // retry in 1 hour
      const result = await this.localAgent.run(prompt, this.fallbackSummary)
      this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
      return { ...result, agent: 'local', routeMethod: 'rule' }
    }
    throw err
  }
}
```

Remove the old two-part fallback check (the `if (this.localFallback && Date.now() < this.resetsAt)` and the `if (this.localFallback && Date.now() >= this.resetsAt)` blocks) and replace with the single block above.

**Step 4: Run all tests**

```bash
npm test
```

Expected: all tests pass.

**Step 5: Run lint and typecheck**

```bash
npm run lint && npm run typecheck
```

Expected: both exit 0. Fix any issues before committing.

**Step 6: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/orchestrator/orchestrator.test.ts
git commit -m "feat: add local-to-Claude switch-back after token limit resets"
```

---

### Task 5: Open PR

**Step 1: Push branch and open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat: auto-switch to local agent on Claude token exhaustion" --body "$(cat <<'EOF'
## Summary

- Reads \`anthropic-ratelimit-tokens-remaining\` and \`anthropic-ratelimit-tokens-limit\` headers from every Claude response via \`.withResponse()\`
- When used fraction exceeds \`config.claude.token_threshold\` (default 0.99), Claude generates a compact handoff summary and the orchestrator switches to local agent
- Local agent continues with the handoff summary as context
- When \`resetsAt\` timestamp passes, orchestrator attempts to switch back to Claude automatically
- If still rate-limited on switch-back, retries again in 1 hour

## Config

\`\`\`yaml
claude:
  model: claude-sonnet-4-6
  token_threshold: 0.99  # switch at 99% usage
\`\`\`

## Test plan

- [ ] All tests pass (\`npm test\`)
- [ ] \`npm run lint\` exits 0
- [ ] \`npm run typecheck\` exits 0

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
