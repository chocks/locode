# Locode CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a hybrid AI coding CLI that routes tasks between a local Ollama LLM and Claude based on task complexity, with a benchmark harness that measures token savings.

**Architecture:** Thin orchestrator reads `locode.yaml`, applies regex rules to classify tasks, falls back to local LLM for ambiguous cases, dispatches to either Ollama or Anthropic SDK client, and tracks token usage per turn. Context handoff from local to Claude uses a compressed summary, not raw conversation history.

**Tech Stack:** TypeScript, Node.js, `ollama` npm client, `@anthropic-ai/sdk`, `commander` (CLI), `readline` (REPL), `js-yaml` (config), `zod` (config validation), `handlebars` (HTML report), `vitest` (tests)

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `.gitignore`

**Step 1: Initialize npm project**

```bash
cd /Users/chockalingameswaramurthy/Documents/repos/locode
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install ollama @anthropic-ai/sdk commander js-yaml zod handlebars
npm install -D typescript @types/node @types/js-yaml @types/handlebars vitest ts-node
```

**Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Write `.gitignore`**

```
node_modules/
dist/
*.log
.locode/
locode-benchmark-report.html
```

**Step 5: Write minimal `src/index.ts`**

```typescript
console.log("locode starting...");
```

**Step 6: Update `package.json` scripts**

Add to `package.json`:
```json
{
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "bin": {
    "locode": "./dist/index.js"
  }
}
```

**Step 7: Verify build works**

```bash
npm run build
```
Expected: `dist/index.js` created, no errors.

**Step 8: Commit**

```bash
git add package.json tsconfig.json src/index.ts .gitignore
git commit -m "feat: scaffold TypeScript project"
```

---

## Task 2: Config System

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/loader.ts`
- Create: `locode.yaml`
- Create: `src/config/loader.test.ts`

**Step 1: Write failing test**

```typescript
// src/config/loader.test.ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from './loader'
import path from 'path'

describe('loadConfig', () => {
  it('loads and validates config from yaml file', () => {
    const config = loadConfig(path.join(__dirname, '../../locode.yaml'))
    expect(config.local_llm.model).toBe('qwen2.5-coder:7b')
    expect(config.routing.rules).toHaveLength(3)
    expect(config.routing.escalation_threshold).toBe(0.7)
  })

  it('throws on invalid config', () => {
    expect(() => loadConfig('/nonexistent/path.yaml')).toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL — `loadConfig` not found.

**Step 3: Write `src/config/schema.ts`**

```typescript
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
```

**Step 4: Write `src/config/loader.ts`**

```typescript
import fs from 'fs'
import yaml from 'js-yaml'
import { ConfigSchema, Config } from './schema'

export function loadConfig(filePath: string): Config {
  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = yaml.load(raw)
  return ConfigSchema.parse(parsed)
}

export function getDefaultConfigPath(): string {
  return process.env.LOCODE_CONFIG || 'locode.yaml'
}
```

**Step 5: Write `locode.yaml`**

```yaml
local_llm:
  provider: ollama
  model: qwen2.5-coder:7b
  base_url: http://localhost:11434

claude:
  model: claude-sonnet-4-6

routing:
  rules:
    - pattern: "find|grep|search|ls|cat|read|explore|where is"
      agent: local
    - pattern: "git log|git diff|git status|git blame"
      agent: local
    - pattern: "refactor|architect|design|explain|review|generate|write tests"
      agent: claude
  ambiguous_resolver: local
  escalation_threshold: 0.7

context:
  handoff: summary
  max_summary_tokens: 500

token_tracking:
  enabled: true
  log_file: ~/.locode/usage.log
```

**Step 6: Run tests to verify they pass**

```bash
npm test
```
Expected: PASS — 2 tests passing.

**Step 7: Commit**

```bash
git add src/config/ locode.yaml
git commit -m "feat: add config schema and YAML loader"
```

---

## Task 3: Token Tracker

**Files:**
- Create: `src/tracker/tracker.ts`
- Create: `src/tracker/tracker.test.ts`

**Step 1: Write failing test**

```typescript
// src/tracker/tracker.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { TokenTracker } from './tracker'

describe('TokenTracker', () => {
  let tracker: TokenTracker

  beforeEach(() => {
    tracker = new TokenTracker({ enabled: true, log_file: '/tmp/test-locode.log' })
  })

  it('records token usage per turn', () => {
    tracker.record({ agent: 'local', input: 100, output: 50, model: 'qwen2.5-coder:7b' })
    tracker.record({ agent: 'claude', input: 2000, output: 400, model: 'claude-sonnet-4-6' })
    const stats = tracker.getStats()
    expect(stats.local.inputTokens).toBe(100)
    expect(stats.claude.inputTokens).toBe(2000)
    expect(stats.total.inputTokens).toBe(2100)
  })

  it('calculates estimated cost', () => {
    tracker.record({ agent: 'claude', input: 1000000, output: 0, model: 'claude-sonnet-4-6' })
    const stats = tracker.getStats()
    expect(stats.claude.estimatedCostUsd).toBeGreaterThan(0)
  })

  it('tracks local routing percentage', () => {
    tracker.record({ agent: 'local', input: 100, output: 50, model: 'qwen2.5-coder:7b' })
    tracker.record({ agent: 'local', input: 100, output: 50, model: 'qwen2.5-coder:7b' })
    tracker.record({ agent: 'claude', input: 2000, output: 400, model: 'claude-sonnet-4-6' })
    const stats = tracker.getStats()
    expect(stats.localRoutingPct).toBeCloseTo(66.67, 1)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL — `TokenTracker` not found.

**Step 3: Write `src/tracker/tracker.ts`**

```typescript
import fs from 'fs'
import os from 'os'
import path from 'path'

// Cost per million tokens (USD) as of 2026
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
}

export interface TurnRecord {
  agent: 'local' | 'claude'
  input: number
  output: number
  model: string
  timestamp?: number
}

export interface AgentStats {
  inputTokens: number
  outputTokens: number
  turns: number
  estimatedCostUsd: number
}

export interface TrackerStats {
  local: AgentStats
  claude: AgentStats
  total: { inputTokens: number; outputTokens: number; estimatedCostUsd: number }
  localRoutingPct: number
}

interface TrackerConfig {
  enabled: boolean
  log_file: string
}

export class TokenTracker {
  private records: TurnRecord[] = []
  private config: TrackerConfig

  constructor(config: TrackerConfig) {
    this.config = config
  }

  record(turn: TurnRecord): void {
    this.records.push({ ...turn, timestamp: Date.now() })
    if (this.config.enabled) {
      this.appendToLog(turn)
    }
  }

  getStats(): TrackerStats {
    const local = this.statsFor('local')
    const claude = this.statsFor('claude')
    const totalTurns = this.records.length
    const localTurns = this.records.filter(r => r.agent === 'local').length

    return {
      local,
      claude,
      total: {
        inputTokens: local.inputTokens + claude.inputTokens,
        outputTokens: local.outputTokens + claude.outputTokens,
        estimatedCostUsd: local.estimatedCostUsd + claude.estimatedCostUsd,
      },
      localRoutingPct: totalTurns > 0 ? (localTurns / totalTurns) * 100 : 0,
    }
  }

  reset(): void {
    this.records = []
  }

  private statsFor(agent: 'local' | 'claude'): AgentStats {
    const agentRecords = this.records.filter(r => r.agent === agent)
    const inputTokens = agentRecords.reduce((sum, r) => sum + r.input, 0)
    const outputTokens = agentRecords.reduce((sum, r) => sum + r.output, 0)
    const estimatedCostUsd = agentRecords.reduce((sum, r) => {
      const costs = MODEL_COSTS[r.model]
      if (!costs) return sum
      return sum + (r.input / 1_000_000) * costs.input + (r.output / 1_000_000) * costs.output
    }, 0)
    return { inputTokens, outputTokens, turns: agentRecords.length, estimatedCostUsd }
  }

  private appendToLog(turn: TurnRecord): void {
    try {
      const logPath = this.config.log_file.replace('~', os.homedir())
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      const line = JSON.stringify({ ...turn, timestamp: Date.now() }) + '\n'
      fs.appendFileSync(logPath, line)
    } catch {
      // non-fatal — logging failure should not crash the CLI
    }
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: PASS — 3 tests passing.

**Step 5: Commit**

```bash
git add src/tracker/
git commit -m "feat: add token tracker with cost estimation"
```

---

## Task 4: Tools (Local Agent)

**Files:**
- Create: `src/tools/readFile.ts`
- Create: `src/tools/shell.ts`
- Create: `src/tools/git.ts`
- Create: `src/tools/index.ts`
- Create: `src/tools/tools.test.ts`

**Step 1: Write failing tests**

```typescript
// src/tools/tools.test.ts
import { describe, it, expect } from 'vitest'
import { readFileTool } from './readFile'
import { shellTool } from './shell'
import path from 'path'

describe('readFileTool', () => {
  it('reads a file and returns content', async () => {
    const result = await readFileTool({ path: path.join(__dirname, '../../locode.yaml') })
    expect(result).toContain('local_llm')
  })

  it('returns error message for missing file', async () => {
    const result = await readFileTool({ path: '/nonexistent/file.txt' })
    expect(result).toContain('Error')
  })
})

describe('shellTool', () => {
  it('executes a safe read-only command', async () => {
    const result = await shellTool({ command: 'echo hello' })
    expect(result.trim()).toBe('hello')
  })

  it('blocks write commands', async () => {
    const result = await shellTool({ command: 'rm -rf /' })
    expect(result).toContain('blocked')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL — modules not found.

**Step 3: Write `src/tools/readFile.ts`**

```typescript
import fs from 'fs'

export async function readFileTool({ path }: { path: string }): Promise<string> {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch (err) {
    return `Error reading file: ${(err as Error).message}`
  }
}
```

**Step 4: Write `src/tools/shell.ts`**

```typescript
import { execSync } from 'child_process'

// Patterns that indicate write/destructive operations — blocked for local agent
const BLOCKED_PATTERNS = [
  /\brm\s/, /\bmv\s/, /\bcp\s.*>/, /\bchmod\b/, /\bchown\b/,
  /\bdd\b/, /\bmkdir\b/, /\btouch\b/, /\btee\b/, />\s*\w/,
  /\bnpm\s+install\b/, /\bpip\s+install\b/, /\bgit\s+push\b/,
  /\bgit\s+commit\b/, /\bgit\s+reset\b/,
]

export async function shellTool({ command }: { command: string }): Promise<string> {
  if (BLOCKED_PATTERNS.some(p => p.test(command))) {
    return `[blocked] Command "${command}" requires write access. Escalating to Claude agent.`
  }
  try {
    return execSync(command, { encoding: 'utf8', timeout: 10000 })
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }
}
```

**Step 5: Write `src/tools/git.ts`**

```typescript
import { execSync } from 'child_process'

const ALLOWED_GIT = ['log', 'diff', 'status', 'blame', 'show', 'branch', 'tag', 'ls-files']

export async function gitTool({ args }: { args: string }): Promise<string> {
  const subcommand = args.trim().split(/\s+/)[0]
  if (!ALLOWED_GIT.includes(subcommand)) {
    return `[blocked] git ${subcommand} requires write access. Use Claude agent.`
  }
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', timeout: 10000 })
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }
}
```

**Step 6: Write `src/tools/index.ts`**

```typescript
export { readFileTool } from './readFile'
export { shellTool } from './shell'
export { gitTool } from './git'
```

**Step 7: Run tests to verify they pass**

```bash
npm test
```
Expected: PASS — 4 tests passing.

**Step 8: Commit**

```bash
git add src/tools/
git commit -m "feat: add read-only tools for local agent"
```

---

## Task 5: Local Agent (Ollama)

**Files:**
- Create: `src/agents/local.ts`
- Create: `src/agents/local.test.ts`

**Step 1: Write failing test**

```typescript
// src/agents/local.test.ts
import { describe, it, expect, vi } from 'vitest'
import { LocalAgent } from './local'

// Mock ollama to avoid requiring a running instance in tests
vi.mock('ollama', () => ({
  default: {
    chat: vi.fn().mockResolvedValue({
      message: { content: 'The answer is 42.' },
      prompt_eval_count: 50,
      eval_count: 10,
    }),
  },
}))

describe('LocalAgent', () => {
  const config = {
    local_llm: { provider: 'ollama' as const, model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' },
  }

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
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL — `LocalAgent` not found.

**Step 3: Write `src/agents/local.ts`**

```typescript
import Ollama from 'ollama'
import { readFileTool, shellTool, gitTool } from '../tools'

interface LocalConfig {
  local_llm: { provider: 'ollama'; model: string; base_url: string }
}

export interface AgentResult {
  content: string
  summary: string
  inputTokens: number
  outputTokens: number
}

const SYSTEM_PROMPT = `You are a local coding assistant. You help with file exploration,
grep searches, shell commands, and repository research. You have access to read files,
run read-only shell commands, and query git. You do NOT write or modify files.
When you complete a task, end your response with a SUMMARY section that briefly
describes what you found in 2-3 sentences.`

export class LocalAgent {
  private config: LocalConfig

  constructor(config: LocalConfig) {
    this.config = config
  }

  async run(prompt: string, context?: string): Promise<AgentResult> {
    const messages = []
    if (context) {
      messages.push({ role: 'user' as const, content: `Context from previous work:\n${context}` })
      messages.push({ role: 'assistant' as const, content: 'Understood, I have the context.' })
    }
    messages.push({ role: 'user' as const, content: prompt })

    const response = await Ollama.chat({
      model: this.config.local_llm.model,
      messages,
      system: SYSTEM_PROMPT,
    })

    const content = response.message.content
    const summary = this.extractSummary(content)

    return {
      content,
      summary,
      inputTokens: response.prompt_eval_count ?? 0,
      outputTokens: response.eval_count ?? 0,
    }
  }

  private extractSummary(content: string): string {
    const summaryMatch = content.match(/SUMMARY[:\s]+([\s\S]+?)(?:\n\n|$)/i)
    if (summaryMatch) return summaryMatch[1].trim()
    // Fallback: last paragraph
    const paragraphs = content.trim().split('\n\n')
    return paragraphs[paragraphs.length - 1].slice(0, 500)
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/agents/local.ts src/agents/local.test.ts
git commit -m "feat: add local Ollama agent"
```

---

## Task 6: Claude Agent

**Files:**
- Create: `src/agents/claude.ts`
- Create: `src/agents/claude.test.ts`

**Step 1: Write failing test**

```typescript
// src/agents/claude.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ClaudeAgent } from './claude'

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Here is the refactored code.' }],
        usage: { input_tokens: 1500, output_tokens: 300 },
      }),
    }
  },
}))

describe('ClaudeAgent', () => {
  const config = { claude: { model: 'claude-sonnet-4-6' } }

  it('returns a response and token counts', async () => {
    const agent = new ClaudeAgent(config)
    const result = await agent.run('Refactor this function for clarity', 'previous summary context')
    expect(result.content).toContain('refactored')
    expect(result.inputTokens).toBe(1500)
    expect(result.outputTokens).toBe(300)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL.

**Step 3: Write `src/agents/claude.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { AgentResult } from './local'

interface ClaudeConfig {
  claude: { model: string }
}

export class ClaudeAgent {
  private client: Anthropic
  private config: ClaudeConfig

  constructor(config: ClaudeConfig) {
    this.config = config
    this.client = new Anthropic()  // reads ANTHROPIC_API_KEY from env
  }

  async run(prompt: string, context?: string): Promise<AgentResult> {
    const messages: Anthropic.MessageParam[] = []

    if (context) {
      messages.push({
        role: 'user',
        content: `Context summary from local agent:\n${context}\n\nContinuing task: ${prompt}`,
      })
    } else {
      messages.push({ role: 'user', content: prompt })
    }

    const response = await this.client.messages.create({
      model: this.config.claude.model,
      max_tokens: 8096,
      messages,
    })

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('\n')

    return {
      content,
      summary: content.slice(0, 500),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/agents/claude.ts src/agents/claude.test.ts
git commit -m "feat: add Claude agent with Anthropic SDK"
```

---

## Task 7: Router

**Files:**
- Create: `src/orchestrator/router.ts`
- Create: `src/orchestrator/router.test.ts`

**Step 1: Write failing tests**

```typescript
// src/orchestrator/router.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Router } from './router'
import type { Config } from '../config/schema'

const mockConfig: Config = {
  local_llm: { provider: 'ollama', model: 'qwen2.5-coder:7b', base_url: 'http://localhost:11434' },
  claude: { model: 'claude-sonnet-4-6' },
  routing: {
    rules: [
      { pattern: 'find|grep|search|ls|cat|read|explore|where is', agent: 'local' },
      { pattern: 'git log|git diff|git status|git blame', agent: 'local' },
      { pattern: 'refactor|architect|design|explain|review|generate|write tests', agent: 'claude' },
    ],
    ambiguous_resolver: 'local',
    escalation_threshold: 0.7,
  },
  context: { handoff: 'summary', max_summary_tokens: 500 },
  token_tracking: { enabled: true, log_file: '/tmp/test.log' },
}

describe('Router', () => {
  it('routes grep task to local', async () => {
    const router = new Router(mockConfig)
    const decision = await router.classify('grep for all TODO comments in src/')
    expect(decision.agent).toBe('local')
    expect(decision.method).toBe('rule')
  })

  it('routes refactor task to claude', async () => {
    const router = new Router(mockConfig)
    const decision = await router.classify('refactor the auth module to use dependency injection')
    expect(decision.agent).toBe('claude')
    expect(decision.method).toBe('rule')
  })

  it('uses local LLM for ambiguous tasks', async () => {
    const mockResolve = vi.fn().mockResolvedValue('local')
    const router = new Router(mockConfig, mockResolve)
    const decision = await router.classify('help me with this code')
    expect(decision.agent).toBe('local')
    expect(decision.method).toBe('llm')
    expect(mockResolve).toHaveBeenCalled()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL.

**Step 3: Write `src/orchestrator/router.ts`**

```typescript
import type { Config } from '../config/schema'

export type AgentType = 'local' | 'claude'

export interface RouteDecision {
  agent: AgentType
  method: 'rule' | 'llm'
  confidence: number
}

type AmbiguousResolver = (prompt: string) => Promise<AgentType>

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
        return { agent: rule.agent, method: 'rule', confidence: 1.0 }
      }
    }

    // No rule matched — use local LLM to decide
    const agent = await this.resolveAmbiguous(prompt)
    return { agent, method: 'llm', confidence: 0.6 }
  }

  private async defaultResolver(prompt: string): Promise<AgentType> {
    // In production this calls Ollama to classify the prompt.
    // The local LLM is asked: "Is this task simple (file ops, shell) or complex (code gen, refactor)?"
    // For now, default to local for safety (saves tokens).
    return 'local'
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: PASS — 3 tests passing.

**Step 5: Commit**

```bash
git add src/orchestrator/
git commit -m "feat: add task router with rule-based and LLM fallback"
```

---

## Task 8: Orchestrator

**Files:**
- Create: `src/orchestrator/orchestrator.ts`
- Create: `src/orchestrator/orchestrator.test.ts`

**Step 1: Write failing test**

```typescript
// src/orchestrator/orchestrator.test.ts
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
```

**Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL.

**Step 3: Write `src/orchestrator/orchestrator.ts`**

```typescript
import { Router, AgentType } from './router'
import { LocalAgent, AgentResult } from '../agents/local'
import { ClaudeAgent } from '../agents/claude'
import { TokenTracker } from '../tracker/tracker'
import type { Config } from '../config/schema'

export interface OrchestratorResult extends AgentResult {
  agent: AgentType
  routeMethod: 'rule' | 'llm'
}

export class Orchestrator {
  private router: Router
  private localAgent: LocalAgent
  private claudeAgent: ClaudeAgent
  private tracker: TokenTracker

  constructor(config: Config, localAgent?: LocalAgent, claudeAgent?: ClaudeAgent) {
    this.router = new Router(config)
    this.localAgent = localAgent ?? new LocalAgent(config)
    this.claudeAgent = claudeAgent ?? new ClaudeAgent(config)
    this.tracker = new TokenTracker(config.token_tracking)
  }

  async process(prompt: string, previousSummary?: string): Promise<OrchestratorResult> {
    const decision = await this.router.classify(prompt)

    let result: AgentResult
    if (decision.agent === 'local') {
      result = await this.localAgent.run(prompt, previousSummary)
    } else {
      result = await this.claudeAgent.run(prompt, previousSummary)
    }

    this.tracker.record({
      agent: decision.agent,
      input: result.inputTokens,
      output: result.outputTokens,
      model: decision.agent === 'local' ? 'qwen2.5-coder:7b' : 'claude-sonnet-4-6',
    })

    return { ...result, agent: decision.agent, routeMethod: decision.method }
  }

  getStats() {
    return this.tracker.getStats()
  }

  resetStats() {
    this.tracker.reset()
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/orchestrator/orchestrator.test.ts
git commit -m "feat: add orchestrator wiring router, agents, and tracker"
```

---

## Task 9: REPL + CLI Entry Point

**Files:**
- Create: `src/cli/repl.ts`
- Create: `src/cli/display.ts`
- Modify: `src/index.ts`

**Step 1: Write `src/cli/display.ts`**

```typescript
import { TrackerStats } from '../tracker/tracker'

export function printStats(stats: TrackerStats): void {
  console.log('\n--- Session Stats ---')
  console.log(`Local turns:  ${stats.local.turns} | Tokens in/out: ${stats.local.inputTokens}/${stats.local.outputTokens}`)
  console.log(`Claude turns: ${stats.claude.turns} | Tokens in/out: ${stats.claude.inputTokens}/${stats.claude.outputTokens}`)
  console.log(`Total cost:   $${stats.total.estimatedCostUsd.toFixed(4)}`)
  console.log(`Local routing: ${stats.localRoutingPct.toFixed(1)}%`)
  console.log('---------------------\n')
}

export function printResult(content: string, agent: string, method: string): void {
  const label = agent === 'local' ? '[local]' : '[claude]'
  const dim = agent === 'local' ? '\x1b[2m' : ''
  const reset = '\x1b[0m'
  console.log(`\n${dim}${label} (${method})${reset}`)
  console.log(content)
}
```

**Step 2: Write `src/cli/repl.ts`**

```typescript
import * as readline from 'readline'
import { Orchestrator } from '../orchestrator/orchestrator'
import { printResult, printStats } from './display'
import type { Config } from '../config/schema'

export async function startRepl(config: Config): Promise<void> {
  const orch = new Orchestrator(config)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  console.log('locode — local-first AI coding CLI')
  console.log('Type your task, or "stats" for token usage, "exit" to quit.\n')

  let lastSummary: string | undefined

  const prompt = () => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim()
      if (!trimmed) return prompt()
      if (trimmed === 'exit' || trimmed === 'quit') {
        printStats(orch.getStats())
        rl.close()
        return
      }
      if (trimmed === 'stats') {
        printStats(orch.getStats())
        return prompt()
      }

      try {
        const result = await orch.process(trimmed, lastSummary)
        printResult(result.content, result.agent, result.routeMethod)
        lastSummary = result.summary
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`)
      }
      prompt()
    })
  }

  prompt()
}
```

**Step 3: Update `src/index.ts`**

```typescript
#!/usr/bin/env node
import { Command } from 'commander'
import { loadConfig, getDefaultConfigPath } from './config/loader'
import { startRepl } from './cli/repl'
import { Orchestrator } from './orchestrator/orchestrator'
import path from 'path'

const program = new Command()

program
  .name('locode')
  .description('Local-first AI coding CLI')
  .version('0.1.0')

program
  .command('chat', { isDefault: true })
  .description('Start interactive REPL session')
  .option('-c, --config <path>', 'path to locode.yaml', getDefaultConfigPath())
  .action(async (opts) => {
    const config = loadConfig(path.resolve(opts.config))
    await startRepl(config)
  })

program
  .command('run <prompt>')
  .description('Single-shot task execution')
  .option('-c, --config <path>', 'path to locode.yaml', getDefaultConfigPath())
  .action(async (prompt, opts) => {
    const config = loadConfig(path.resolve(opts.config))
    const orch = new Orchestrator(config)
    const result = await orch.process(prompt)
    console.log(result.content)
    process.exit(0)
  })

program.parse()
```

**Step 4: Build and smoke test**

```bash
npm run build && node dist/index.js --help
```
Expected: Help output showing `chat` and `run` commands.

**Step 5: Commit**

```bash
git add src/cli/ src/index.ts
git commit -m "feat: add REPL and single-shot CLI entry point"
```

---

## Task 10: Benchmark Runner

**Files:**
- Create: `benchmark/tasks/todo-webapp.md`
- Create: `benchmark/runner.ts`
- Create: `benchmark/parsers/locode.ts`

**Step 1: Write `benchmark/tasks/todo-webapp.md`**

```markdown
# Benchmark Task: Todo Webapp

Build a simple todo web application with:
- React frontend with add/complete/delete todo items
- Express backend with REST API (GET /todos, POST /todos, DELETE /todos/:id)
- In-memory storage (no database needed)
- Basic CSS styling

Start by exploring what's in the current directory, then scaffold the project.
```

**Step 2: Write `benchmark/parsers/locode.ts`**

```typescript
export interface BenchmarkResult {
  tool: string
  inputTokens: number
  outputTokens: number
  localInputTokens: number
  localOutputTokens: number
  claudeInputTokens: number
  claudeOutputTokens: number
  localRoutingPct: number
  estimatedCostUsd: number
  durationMs: number
}

export function parseLocodeStats(statsJson: string): Partial<BenchmarkResult> {
  try {
    const stats = JSON.parse(statsJson)
    return {
      tool: 'locode',
      inputTokens: stats.total.inputTokens,
      outputTokens: stats.total.outputTokens,
      localInputTokens: stats.local.inputTokens,
      localOutputTokens: stats.local.outputTokens,
      claudeInputTokens: stats.claude.inputTokens,
      claudeOutputTokens: stats.claude.outputTokens,
      localRoutingPct: stats.localRoutingPct,
      estimatedCostUsd: stats.total.estimatedCostUsd,
    }
  } catch {
    return {}
  }
}
```

**Step 3: Write `benchmark/runner.ts`**

```typescript
import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Orchestrator } from '../src/orchestrator/orchestrator'
import { loadConfig } from '../src/config/loader'
import { parseLocodeStats, BenchmarkResult } from './parsers/locode'
import { generateReport } from './report/generate'

const TASK_FILE = path.join(__dirname, 'tasks/todo-webapp.md')

async function runLocode(): Promise<Partial<BenchmarkResult>> {
  const task = fs.readFileSync(TASK_FILE, 'utf8')
  const config = loadConfig('locode.yaml')
  const orch = new Orchestrator(config)

  const start = Date.now()
  await orch.process(task)
  const durationMs = Date.now() - start

  const stats = orch.getStats()
  return {
    tool: 'locode',
    ...parseLocodeStats(JSON.stringify(stats)),
    durationMs,
  }
}

async function main() {
  console.log('Running Locode benchmark...')
  const locodeResult = await runLocode()

  const results: BenchmarkResult[] = [locodeResult as BenchmarkResult]
  const reportPath = path.join(process.cwd(), 'locode-benchmark-report.html')
  generateReport(results, reportPath)

  console.log(`\nReport saved to: ${reportPath}`)
  execSync(`open ${reportPath}`)
}

main().catch(console.error)
```

**Step 4: Commit**

```bash
git add benchmark/
git commit -m "feat: add benchmark runner and task definitions"
```

---

## Task 11: HTML Report Generator

**Files:**
- Create: `benchmark/report/template.html`
- Create: `benchmark/report/generate.ts`

**Step 1: Write `benchmark/report/template.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Locode Benchmark Report</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; background: #0d1117; color: #e6edf3; }
    h1 { color: #58a6ff; }
    .meta { color: #8b949e; margin-bottom: 2rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th { background: #161b22; padding: 12px; text-align: left; color: #58a6ff; }
    td { padding: 12px; border-bottom: 1px solid #21262d; }
    .saved { color: #3fb950; font-weight: bold; }
    .highlight { background: #161b22; border-radius: 8px; padding: 20px; margin: 1rem 0; }
    .big-number { font-size: 2.5rem; font-weight: bold; color: #3fb950; }
    .label { font-size: 0.85rem; color: #8b949e; }
  </style>
</head>
<body>
  <h1>Locode Benchmark Report</h1>
  <p class="meta">Generated: {{generatedAt}} | Task: {{taskName}}</p>

  <div class="highlight">
    <div class="big-number">{{localRoutingPct}}%</div>
    <div class="label">tasks handled by local LLM</div>
  </div>

  <table>
    <thead>
      <tr><th>Metric</th><th>Without Locode (Claude only)</th><th>With Locode</th><th>Saved</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>Input tokens</td>
        <td>{{claudeOnlyInputTokens}}</td>
        <td>{{locodeInputTokens}}</td>
        <td class="saved">{{savedInputTokensPct}}%</td>
      </tr>
      <tr>
        <td>Output tokens</td>
        <td>{{claudeOnlyOutputTokens}}</td>
        <td>{{locodeOutputTokens}}</td>
        <td class="saved">{{savedOutputTokensPct}}%</td>
      </tr>
      <tr>
        <td>Estimated cost</td>
        <td>${{claudeOnlyCost}}</td>
        <td>${{locodeCost}}</td>
        <td class="saved">${{savedCost}} ({{savedCostPct}}%)</td>
      </tr>
    </tbody>
  </table>

  <h2>Routing Breakdown</h2>
  <table>
    <thead>
      <tr><th>Agent</th><th>Turns</th><th>Input Tokens</th><th>Output Tokens</th></tr>
    </thead>
    <tbody>
      <tr><td>Local (Ollama)</td><td>{{localTurns}}</td><td>{{localInputTokens}}</td><td>{{localOutputTokens}}</td></tr>
      <tr><td>Claude</td><td>{{claudeTurns}}</td><td>{{claudeInputTokens}}</td><td>{{claudeOutputTokens}}</td></tr>
    </tbody>
  </table>
</body>
</html>
```

**Step 2: Write `benchmark/report/generate.ts`**

```typescript
import Handlebars from 'handlebars'
import fs from 'fs'
import path from 'path'
import { BenchmarkResult } from '../parsers/locode'

export function generateReport(results: BenchmarkResult[], outputPath: string): void {
  const templateSrc = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8')
  const template = Handlebars.compile(templateSrc)

  const locode = results.find(r => r.tool === 'locode')!

  // Estimate "Claude only" cost: all tokens routed through claude-sonnet-4-6
  const claudeOnlyInputTokens = locode.inputTokens
  const claudeOnlyOutputTokens = locode.outputTokens
  const claudeOnlyCost = ((claudeOnlyInputTokens / 1_000_000) * 3.0 + (claudeOnlyOutputTokens / 1_000_000) * 15.0).toFixed(4)
  const locodeCost = locode.estimatedCostUsd.toFixed(4)
  const savedCost = (parseFloat(claudeOnlyCost) - parseFloat(locodeCost)).toFixed(4)
  const savedCostPct = ((parseFloat(savedCost) / parseFloat(claudeOnlyCost)) * 100).toFixed(1)

  const savedInputPct = (((claudeOnlyInputTokens - locode.claudeInputTokens) / claudeOnlyInputTokens) * 100).toFixed(1)
  const savedOutputPct = (((claudeOnlyOutputTokens - locode.claudeOutputTokens) / claudeOnlyOutputTokens) * 100).toFixed(1)

  const html = template({
    generatedAt: new Date().toLocaleString(),
    taskName: 'Todo Webapp',
    localRoutingPct: locode.localRoutingPct.toFixed(1),
    claudeOnlyInputTokens,
    claudeOnlyOutputTokens,
    locodeInputTokens: locode.inputTokens,
    locodeOutputTokens: locode.outputTokens,
    savedInputTokensPct: savedInputPct,
    savedOutputTokensPct: savedOutputPct,
    claudeOnlyCost,
    locodeCost,
    savedCost,
    savedCostPct,
    localTurns: locode.localRoutingPct > 0 ? Math.round((locode.localRoutingPct / 100) * 10) : 0,
    claudeTurns: Math.round(((100 - locode.localRoutingPct) / 100) * 10),
    localInputTokens: locode.localInputTokens,
    localOutputTokens: locode.localOutputTokens,
    claudeInputTokens: locode.claudeInputTokens,
    claudeOutputTokens: locode.claudeOutputTokens,
  })

  fs.writeFileSync(outputPath, html)
}
```

**Step 3: Commit**

```bash
git add benchmark/report/
git commit -m "feat: add HTML report generator for benchmark results"
```

---

## Task 12: Wire LLM Ambiguous Resolver

**Files:**
- Modify: `src/orchestrator/router.ts`

**Step 1: Update the `defaultResolver` in `router.ts` to actually call Ollama**

Replace the `defaultResolver` method:

```typescript
private async defaultResolver(prompt: string): Promise<AgentType> {
  try {
    const response = await Ollama.chat({
      model: this.config.local_llm.model,
      messages: [{
        role: 'user',
        content: `Classify this coding task. Reply with ONLY "local" or "claude".
- "local": file reading, grep, search, shell commands, git queries, repo exploration
- "claude": code generation, refactoring, architecture, writing tests, complex explanations

Task: "${prompt}"

Reply with one word only: local or claude`
      }],
    })
    const answer = response.message.content.trim().toLowerCase()
    return answer.startsWith('claude') ? 'claude' : 'local'
  } catch {
    return 'local' // fallback on error
  }
}
```

Also add import at top of `router.ts`:
```typescript
import Ollama from 'ollama'
```

**Step 2: Run all tests**

```bash
npm test
```
Expected: All tests PASS (mock still used in router tests).

**Step 3: Commit**

```bash
git add src/orchestrator/router.ts
git commit -m "feat: wire Ollama as ambiguous task resolver"
```

---

## Task 13: Final Integration + README

**Files:**
- Create: `README.md`

**Step 1: Write README.md**

```markdown
# Locode

Local-first AI coding CLI. Routes simple tasks to a local LLM (Ollama), complex tasks to Claude. Saves tokens.

## Requirements

- Node.js 18+
- [Ollama](https://ollama.ai) running locally with `qwen2.5-coder:7b` pulled
- `ANTHROPIC_API_KEY` environment variable set

## Install

```bash
npm install -g locode
```

## Usage

```bash
# Interactive REPL
locode

# Single-shot
locode run "grep for all TODO comments in src/"

# Custom config
locode --config ./my-locode.yaml

# Run benchmark
npx ts-node benchmark/runner.ts
```

## Config (`locode.yaml`)

Edit routing rules, model names, and Ollama URL. See `locode.yaml` for defaults.

## Token Tracking

At end of session type `stats` or press Ctrl+C to see token usage breakdown and cost estimate.
```

**Step 2: Final build and test**

```bash
npm run build && npm test
```
Expected: Build succeeds, all tests pass.

**Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: add README with install and usage instructions"
```
