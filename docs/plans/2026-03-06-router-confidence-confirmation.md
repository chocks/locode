# Router Confidence Fix + Pre-Execution Confirmation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix hardcoded router confidence so the LLM classifier actually works, and add user confirmation before agent execution in the REPL.

**Architecture:** The router's `defaultResolver` will ask the LLM for JSON `{"agent":"local","confidence":0.85}` and parse real confidence. The orchestrator will expose separate `route()` and `execute()` methods so the REPL can insert a confirmation prompt between routing and execution. The `run` command (single-shot) continues to use `process()` which calls both without confirmation.

**Tech Stack:** TypeScript, Vitest, Ollama SDK

---

### Task 1: Update Router — LLM confidence via JSON

**Files:**
- Modify: `src/orchestrator/router.ts`
- Modify: `src/orchestrator/router.test.ts`

**Step 1: Update the test file — change mock resolver return type and add new tests**

In `src/orchestrator/router.test.ts`, the `AmbiguousResolver` type changes from returning `AgentType` to `{ agent: AgentType; confidence: number }`. Update existing tests and add new ones:

```typescript
// Update existing test at line 37 — mock now returns { agent, confidence }
it('escalates to Claude for ambiguous tasks when confidence is below threshold', async () => {
  const mockResolve = vi.fn().mockResolvedValue({ agent: 'local', confidence: 0.6 })
  const router = new Router(mockConfig, mockResolve)
  const decision = await router.classify('help me with this code')
  expect(decision.agent).toBe('claude')
  expect(decision.method).toBe('llm')
  expect(decision.confidence).toBe(0.6)
  expect(mockResolve).toHaveBeenCalled()
})

// Update existing test at line 46
it('stays local for ambiguous tasks when confidence exceeds threshold', async () => {
  const mockResolve = vi.fn().mockResolvedValue({ agent: 'local', confidence: 0.85 })
  const router = new Router(mockConfig, mockResolve)
  const decision = await router.classify('help me with this code')
  expect(decision.agent).toBe('local')
  expect(decision.method).toBe('llm')
  expect(decision.confidence).toBe(0.85)
})

// Update test at line 59
it('does not statically route "review <file>" to claude', async () => {
  const mockResolve = vi.fn().mockResolvedValue({ agent: 'local', confidence: 0.8 })
  const router = new Router(mockConfig, mockResolve)
  const decision = await router.classify('review AGENT.md')
  expect(mockResolve).toHaveBeenCalled()
  expect(decision.method).toBe('llm')
  expect(decision.agent).toBe('local')  // confidence 0.8 > threshold 0.7
})

// Update test at line 69
it('does not statically route "explain <file>" to claude', async () => {
  const mockResolve = vi.fn().mockResolvedValue({ agent: 'local', confidence: 0.8 })
  const router = new Router(mockConfig, mockResolve)
  const decision = await router.classify('explain src/index.ts')
  expect(mockResolve).toHaveBeenCalled()
  expect(decision.method).toBe('llm')
  expect(decision.agent).toBe('local')
})

// NEW: add test for high-confidence claude classification
it('respects LLM decision when confidence exceeds threshold', async () => {
  const mockResolve = vi.fn().mockResolvedValue({ agent: 'claude', confidence: 0.9 })
  const router = new Router(mockConfig, mockResolve)
  const decision = await router.classify('help me with this code')
  expect(decision.agent).toBe('claude')
  expect(decision.confidence).toBe(0.9)
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/orchestrator/router.test.ts`
Expected: FAIL — mock resolver returns wrong type

**Step 3: Update router implementation**

In `src/orchestrator/router.ts`:

```typescript
import Ollama from 'ollama'
import type { Config } from '../config/schema'

export type AgentType = 'local' | 'claude'

export interface RouteDecision {
  agent: AgentType
  method: 'rule' | 'llm'
  confidence: number
  reason: string
}

interface ResolverResult {
  agent: AgentType
  confidence: number
}

type AmbiguousResolver = (prompt: string) => Promise<ResolverResult>

export class Router {
  private config: Config
  private resolveAmbiguous: AmbiguousResolver

  constructor(config: Config, resolver?: AmbiguousResolver) {
    this.config = config
    this.resolveAmbiguous = resolver ?? this.defaultResolver.bind(this)
  }

  async classify(prompt: string): Promise<RouteDecision> {
    const lower = prompt.toLowerCase()

    for (const rule of this.config.routing.rules) {
      const regex = new RegExp(rule.pattern, 'i')
      if (regex.test(lower)) {
        return { agent: rule.agent, method: 'rule', confidence: 1.0, reason: `matched pattern: ${rule.pattern}` }
      }
    }

    // No rule matched — use local LLM to decide
    const { agent: llmAgent, confidence } = await this.resolveAmbiguous(prompt)

    // If confidence is below threshold, escalate to Claude regardless of LLM decision
    const agent = confidence < this.config.routing.escalation_threshold ? 'claude' : llmAgent
    const reason = agent === llmAgent
      ? `LLM classified as ${agent} task (confidence: ${confidence})`
      : `LLM confidence too low (${confidence}), escalating to claude`
    return { agent, method: 'llm', confidence, reason }
  }

  private async defaultResolver(prompt: string): Promise<ResolverResult> {
    try {
      const response = await Ollama.chat({
        model: this.config.local_llm.model,
        messages: [{
          role: 'user',
          content: `Classify this coding task. Reply with ONLY a JSON object, no other text.
- "local": file reading, grep, search, shell commands, git queries, repo exploration, release/tag/version tasks
- "claude": code generation, refactoring, architecture, writing tests, complex explanations

Example: {"agent": "local", "confidence": 0.85}

Task: "${prompt}"`,
        }],
      })
      const text = response.message.content.trim()
      const json = JSON.parse(text)
      const agent: AgentType = json.agent === 'claude' ? 'claude' : 'local'
      const confidence = typeof json.confidence === 'number' ? Math.min(1, Math.max(0, json.confidence)) : 0.5
      return { agent, confidence }
    } catch {
      return { agent: 'local', confidence: 0.5 }
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/orchestrator/router.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/router.ts src/orchestrator/router.test.ts
git commit -m "fix: parse real confidence from LLM instead of hardcoded 0.6"
```

---

### Task 2: Split Orchestrator into route() + execute()

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`
- Modify: `src/orchestrator/orchestrator.test.ts`

**Step 1: Write failing tests for the new route() and execute() methods**

Add to `src/orchestrator/orchestrator.test.ts`:

```typescript
it('route() returns decision without executing agent', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  const mockLocal = { run: vi.fn() }
  const mockClaude = { run: vi.fn() }
  const orch = new Orchestrator(mockConfig, mockLocal as unknown as import('../agents/local').LocalAgent, mockClaude as unknown as import('../agents/claude').ClaudeAgent)

  const decision = await orch.route('find all .ts files')
  expect(decision.agent).toBe('local')
  expect(decision.method).toBe('rule')
  expect(mockLocal.run).not.toHaveBeenCalled()
  expect(mockClaude.run).not.toHaveBeenCalled()
})

it('execute() runs the specified agent', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  const mockLocal = { run: vi.fn().mockResolvedValue({ content: 'found files', summary: 'summary', inputTokens: 100, outputTokens: 30 }) }
  const mockClaude = { run: vi.fn() }
  const orch = new Orchestrator(mockConfig, mockLocal as unknown as import('../agents/local').LocalAgent, mockClaude as unknown as import('../agents/claude').ClaudeAgent)

  const result = await orch.execute('find all .ts files', 'local')
  expect(result.agent).toBe('local')
  expect(result.content).toBe('found files')
  expect(mockLocal.run).toHaveBeenCalled()
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/orchestrator/orchestrator.test.ts`
Expected: FAIL — `route()` and `execute()` don't exist

**Step 3: Implement route() and execute() on Orchestrator**

Add to `src/orchestrator/orchestrator.ts`:

```typescript
async route(prompt: string): Promise<RouteDecision> {
  const enrichedPrompt = injectFileContext(prompt, this.config.context.max_file_bytes)
  return this.router.classify(enrichedPrompt)
}

async execute(prompt: string, agent: AgentType, previousSummary?: string): Promise<OrchestratorResult> {
  const enrichedPrompt = injectFileContext(prompt, this.config.context.max_file_bytes)

  let result: AgentResult
  let reason = `user confirmed ${agent}`

  if (agent === 'claude') {
    try {
      const claudeResult = await this.claudeAgent.run(enrichedPrompt, previousSummary, this.repoContext)
      await this.checkAndTriggerFallback(claudeResult)
      result = claudeResult
    } catch (err) {
      result = await this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)
      agent = 'local'
      reason = `Claude unavailable (${(err as Error).message}), fell back to local`
    }
  } else {
    result = await this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)
  }

  this.tracker.record({
    agent,
    input: result.inputTokens,
    output: result.outputTokens,
    model: agent === 'local' ? this.config.local_llm.model : this.config.claude.model,
  })

  return { ...result, agent, routeMethod: 'llm', reason }
}
```

Import `RouteDecision` from `./router` (already imported via `AgentType`). The existing `process()` method stays unchanged — it's used by the `run` command.

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/orchestrator/orchestrator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/orchestrator/orchestrator.test.ts
git commit -m "feat: add route() and execute() methods to Orchestrator"
```

---

### Task 3: Add pre-execution confirmation to REPL

**Files:**
- Modify: `src/cli/repl.ts`
- Modify: `src/cli/repl.test.ts`

**Step 1: Write tests for the confirmation helper**

Add to `src/cli/repl.test.ts`:

```typescript
import { parseConfirmation } from './repl'

describe('parseConfirmation', () => {
  it('returns "proceed" for empty input (default)', () => {
    expect(parseConfirmation('')).toBe('proceed')
  })

  it('returns "proceed" for "y"', () => {
    expect(parseConfirmation('y')).toBe('proceed')
  })

  it('returns "proceed" for "Y"', () => {
    expect(parseConfirmation('Y')).toBe('proceed')
  })

  it('returns "cancel" for "n"', () => {
    expect(parseConfirmation('n')).toBe('cancel')
  })

  it('returns "switch" for "s"', () => {
    expect(parseConfirmation('s')).toBe('switch')
  })

  it('returns "proceed" for unrecognized input', () => {
    expect(parseConfirmation('x')).toBe('proceed')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/cli/repl.test.ts`
Expected: FAIL — `parseConfirmation` not exported

**Step 3: Implement parseConfirmation and wire confirmation into REPL**

In `src/cli/repl.ts`, add the exported helper:

```typescript
export type ConfirmAction = 'proceed' | 'cancel' | 'switch'

export function parseConfirmation(input: string): ConfirmAction {
  const trimmed = input.trim().toLowerCase()
  if (trimmed === 'n') return 'cancel'
  if (trimmed === 's') return 'switch'
  return 'proceed'
}
```

Then update the REPL loop (inside the `rl.on('line')` handler). Replace the current:

```typescript
let result = await orch.process(input, lastSummary)
```

With logic that uses `route()` + confirmation + `execute()` when not in forced mode:

```typescript
let result: import('../orchestrator/orchestrator').OrchestratorResult

if (orch.isLocalOnly() || orch.isClaudeOnly() || orch.isLocalFallback()) {
  result = await orch.process(input, lastSummary)
} else {
  const decision = await orch.route(input)

  // Skip confirmation for rule-matched routes (high confidence)
  if (decision.method === 'rule') {
    result = await orch.execute(input, decision.agent, lastSummary)
  } else {
    const otherAgent = decision.agent === 'claude' ? 'local' : 'claude'
    console.log(`\n${decision.agent} — ${decision.reason}`)
    processing = false
    const answer = await askQuestion(rl, '   Proceed? [Y/n/s(witch)] ')
    processing = true
    const action = parseConfirmation(answer)

    if (action === 'cancel') {
      processing = false
      showPrompt()
      return
    }

    const chosenAgent = action === 'switch' ? otherAgent : decision.agent
    result = await orch.execute(input, chosenAgent, lastSummary)
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/cli/repl.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/cli/repl.ts src/cli/repl.test.ts
git commit -m "feat: add pre-execution confirmation prompt in REPL"
```

---

### Task 4: Build and verify end-to-end

**Step 1: Build**

Run: `npm run build`
Expected: No TypeScript errors

**Step 2: Manual smoke test (optional)**

Run: `npm run dev` and try:
- `grep for TODO` — should match rule, no confirmation, routes to local
- `help me with this code` — should show confirmation with LLM confidence
- Type `s` to switch agent
- Type `n` to cancel

**Step 3: Final commit if any build fixes needed**

```bash
git add -A
git commit -m "fix: resolve any build issues"
```
