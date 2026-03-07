# Repo Context Injection — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically load repo context files (e.g., CLAUDE.md) at startup and inject them as system prompts into both agents.

**Architecture:** New `loadRepoContext()` function reads configurable files from repo root once at Orchestrator construction. Context is passed to agents and injected as system prompt content. Config schema gets a new `repo_context_files` array field.

**Tech Stack:** TypeScript, Zod (schema), Ollama API (system message), Anthropic SDK (system param), vitest (tests)

---

### Task 1: Add `repo_context_files` to config schema

**Files:**
- Modify: `src/config/schema.ts:37-41`
- Modify: `locode.yaml:22-24`
- Test: `src/config/schema.test.ts`

**Step 1: Write the failing test**

Add to `src/config/schema.test.ts`:

```typescript
it('accepts repo_context_files as an array of strings', () => {
  const config = ConfigSchema.parse({
    ...validConfig,
    context: { ...validConfig.context, repo_context_files: ['CLAUDE.md', '.cursorrules'] },
  })
  expect(config.context.repo_context_files).toEqual(['CLAUDE.md', '.cursorrules'])
})

it('defaults repo_context_files to ["CLAUDE.md"]', () => {
  const config = ConfigSchema.parse(validConfig)
  expect(config.context.repo_context_files).toEqual(['CLAUDE.md'])
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/config/schema.test.ts`
Expected: FAIL — `repo_context_files` not in schema

**Step 3: Write minimal implementation**

In `src/config/schema.ts`, add to the `context` object (line 40, before `max_file_bytes`):

```typescript
  context: z.object({
    handoff: z.literal('summary'),
    max_summary_tokens: z.number(),
    max_file_bytes: z.number().int().positive().default(51200),
    repo_context_files: z.array(z.string()).default(['CLAUDE.md']),
  }),
```

In `locode.yaml`, add under `context:`:

```yaml
context:
  handoff: summary
  max_summary_tokens: 500
  max_file_bytes: 51200
  repo_context_files:
    - CLAUDE.md
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/config/schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts locode.yaml src/config/schema.test.ts
git commit -m "feat: add repo_context_files to config schema"
```

---

### Task 2: Create `repo-context-loader.ts` with tests

**Files:**
- Create: `src/orchestrator/repo-context-loader.ts`
- Create: `src/orchestrator/repo-context-loader.test.ts`

**Step 1: Write the failing tests**

Create `src/orchestrator/repo-context-loader.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import { execFileSync } from 'child_process'

vi.mock('fs')
vi.mock('child_process')

import { loadRepoContext } from './repo-context-loader'

const MAX_BYTES = 51200

describe('loadRepoContext', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('/fake/repo\n'))
  })

  it('returns empty string when no files are configured', () => {
    const result = loadRepoContext([], MAX_BYTES)
    expect(result).toBe('')
  })

  it('reads a file from the git repo root', () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue('# My Project')
    const result = loadRepoContext(['CLAUDE.md'], MAX_BYTES)
    expect(result).toContain('--- CLAUDE.md ---')
    expect(result).toContain('# My Project')
    expect(fs.readFileSync).toHaveBeenCalledWith('/fake/repo/CLAUDE.md', 'utf8')
  })

  it('skips missing files silently', () => {
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error('ENOENT') })
    const result = loadRepoContext(['CLAUDE.md'], MAX_BYTES)
    expect(result).toBe('')
  })

  it('truncates files exceeding maxBytes', () => {
    const bigContent = 'x'.repeat(60000)
    vi.mocked(fs.statSync).mockReturnValue({ size: 60000 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue(bigContent)
    const result = loadRepoContext(['CLAUDE.md'], MAX_BYTES)
    expect(result).toContain('truncated')
    expect(result.length).toBeLessThan(60000 + 200)
  })

  it('concatenates multiple files', () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 50 } as fs.Stats)
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('content A')
      .mockReturnValueOnce('content B')
    const result = loadRepoContext(['CLAUDE.md', '.cursorrules'], MAX_BYTES)
    expect(result).toContain('--- CLAUDE.md ---')
    expect(result).toContain('--- .cursorrules ---')
    expect(result).toContain('content A')
    expect(result).toContain('content B')
  })

  it('falls back to cwd when not in a git repo', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('not a git repo') })
    vi.mocked(fs.statSync).mockReturnValue({ size: 10 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue('fallback content')
    const result = loadRepoContext(['CLAUDE.md'], MAX_BYTES)
    expect(result).toContain('fallback content')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/orchestrator/repo-context-loader.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/orchestrator/repo-context-loader.ts`:

```typescript
import * as fs from 'fs'
import { execFileSync } from 'child_process'
import * as path from 'path'

function getRepoRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim()
  } catch {
    return process.cwd()
  }
}

export function loadRepoContext(files: string[], maxBytes: number): string {
  if (files.length === 0) return ''

  const root = getRepoRoot()
  const sections: string[] = []

  for (const file of files) {
    const filePath = path.join(root, file)
    try {
      const stat = fs.statSync(filePath)
      let content: string
      if (stat.size > maxBytes) {
        const raw = fs.readFileSync(filePath, 'utf8')
        const truncated = raw.slice(0, maxBytes)
        content = `[${file} — truncated at ${Math.round(maxBytes / 1024)}KB, ${stat.size} bytes total]\n${truncated}`
      } else {
        content = fs.readFileSync(filePath, 'utf8')
      }
      sections.push(`--- ${file} ---\n${content}`)
    } catch {
      // file not found or unreadable — skip silently
    }
  }

  return sections.join('\n\n')
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/orchestrator/repo-context-loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/repo-context-loader.ts src/orchestrator/repo-context-loader.test.ts
git commit -m "feat: add repo context loader"
```

---

### Task 3: Inject repo context into LocalAgent system prompt

**Files:**
- Modify: `src/agents/local.ts:17-25` (SYSTEM_PROMPT), `src/agents/local.ts:103` (run signature), `src/agents/local.ts:127` (system message in chat call)
- Test: `src/agents/local.test.ts`

**Step 1: Write the failing test**

Add to `src/agents/local.test.ts`:

```typescript
it('includes repo context in system prompt when provided', async () => {
  const agent = new LocalAgent(mockConfig)
  await agent.run('hello', undefined, '--- CLAUDE.md ---\n# My Project')

  const chatCall = vi.mocked(Ollama.chat).mock.calls[0][0]
  const systemMsg = chatCall.messages[0]
  expect(systemMsg.role).toBe('system')
  expect(systemMsg.content).toContain('# My Project')
  expect(systemMsg.content).toContain('You are a local coding assistant')
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/agents/local.test.ts`
Expected: FAIL — `run()` doesn't accept third parameter

**Step 3: Write minimal implementation**

In `src/agents/local.ts`:

Change the `run` signature (line 103):
```typescript
async run(prompt: string, context?: string, repoContext?: string): Promise<AgentResult> {
```

Change the system message in both `Ollama.chat` calls (lines 127 and 158) to use a computed system prompt:
```typescript
const systemPrompt = repoContext
  ? `Project context:\n${repoContext}\n\n${SYSTEM_PROMPT}`
  : SYSTEM_PROMPT
```

Then use `systemPrompt` instead of `SYSTEM_PROMPT` in the `messages` arrays.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/agents/local.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agents/local.ts src/agents/local.test.ts
git commit -m "feat: inject repo context into local agent system prompt"
```

---

### Task 4: Inject repo context into ClaudeAgent as system param

**Files:**
- Modify: `src/agents/claude.ts:32` (run signature), `src/agents/claude.ts:44-48` (API call)
- Test: `src/agents/claude.test.ts`

**Step 1: Write the failing test**

Add to `src/agents/claude.test.ts`:

```typescript
it('passes repo context as system parameter when provided', async () => {
  const agent = new ClaudeAgent(mockConfig)
  await agent.run('hello', undefined, '--- CLAUDE.md ---\n# My Project')

  const createCall = mockCreate.mock.calls[0][0]
  expect(createCall.system).toContain('# My Project')
})

it('omits system parameter when no repo context provided', async () => {
  const agent = new ClaudeAgent(mockConfig)
  await agent.run('hello')

  const createCall = mockCreate.mock.calls[0][0]
  expect(createCall.system).toBeUndefined()
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/agents/claude.test.ts`
Expected: FAIL — `run()` doesn't accept third parameter / no `system` in API call

**Step 3: Write minimal implementation**

In `src/agents/claude.ts`:

Change `run` signature (line 32):
```typescript
async run(prompt: string, context?: string, repoContext?: string): Promise<ClaudeAgentResult> {
```

Add `system` to the API call (line 44-48):
```typescript
const { data: response, response: httpResponse } = await this.client.messages.create({
  model: this.config.claude.model,
  max_tokens: 8096,
  ...(repoContext ? { system: `Project context:\n${repoContext}` } : {}),
  messages,
}).withResponse()
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/agents/claude.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agents/claude.ts src/agents/claude.test.ts
git commit -m "feat: inject repo context into Claude agent system param"
```

---

### Task 5: Wire repo context into Orchestrator

**Files:**
- Modify: `src/orchestrator/orchestrator.ts:1-6` (imports), `src/orchestrator/orchestrator.ts:37-45` (constructor), `src/orchestrator/orchestrator.ts:63-134` (process — all agent.run calls)
- Test: `src/orchestrator/orchestrator.test.ts`

**Step 1: Write the failing test**

Add to `src/orchestrator/orchestrator.test.ts`:

```typescript
vi.mock('./repo-context-loader', () => ({
  loadRepoContext: vi.fn().mockReturnValue('--- CLAUDE.md ---\n# Test Project'),
}))
```

Then add test:

```typescript
it('passes repo context to local agent on run', async () => {
  const mockLocal = {
    run: vi.fn().mockResolvedValue({ content: 'ok', summary: 'ok', inputTokens: 10, outputTokens: 5 }),
  }
  const mockClaude = { run: vi.fn() }
  const orch = new Orchestrator(mockConfig, mockLocal as unknown as import('../agents/local').LocalAgent, mockClaude as unknown as import('../agents/claude').ClaudeAgent)

  await orch.process('find files')
  expect(mockLocal.run).toHaveBeenCalledWith(
    expect.any(String),
    undefined,
    '--- CLAUDE.md ---\n# Test Project',
  )
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/orchestrator/orchestrator.test.ts`
Expected: FAIL — `run()` not called with 3rd argument

**Step 3: Write minimal implementation**

In `src/orchestrator/orchestrator.ts`:

Add import (after line 6):
```typescript
import { loadRepoContext } from './repo-context-loader'
```

Add field and load in constructor:
```typescript
private repoContext: string

constructor(config: Config, localAgent?: LocalAgent, claudeAgent?: ClaudeAgent, options?: OrchestratorOptions) {
  // ... existing code ...
  this.repoContext = loadRepoContext(config.context.repo_context_files, config.context.max_file_bytes)
}
```

Then update every `agent.run()` call throughout the class to pass `this.repoContext` as the third argument. There are 8 calls total:
- Line 68: `this.localAgent.run(prompt, this.fallbackSummary, this.repoContext)`
- Line 75: `this.claudeAgent.run(prompt, this.fallbackSummary, this.repoContext)`
- Line 84: `this.localAgent.run(prompt, this.fallbackSummary, this.repoContext)`
- Line 96: `this.claudeAgent.run(enrichedPrompt, previousSummary, this.repoContext)`
- Line 103: `this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)`
- Line 114: `this.claudeAgent.run(enrichedPrompt, previousSummary, this.repoContext)`
- Line 118: `this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)`
- Line 123: `this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)`
- Line 137: `this.localAgent.run(prompt, previousSummary, this.repoContext)` (retryWithLocal)
- Line 143: `this.claudeAgent.run(prompt, previousSummary, this.repoContext)` (retryWithClaude)

**Step 4: Run test to verify it passes**

Run: `npm test -- src/orchestrator/orchestrator.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 6: Run build**

Run: `npm run build`
Expected: Clean compile

**Step 7: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/orchestrator/orchestrator.test.ts
git commit -m "feat: wire repo context through orchestrator to agents"
```

---

### Task 6: Integration smoke test

**Step 1: Manual verification**

```bash
npm run dev
```

Type `make a new release` — the agent should now reference your CLAUDE.md release process instead of asking clarifying questions.

**Step 2: Final commit and PR**

```bash
git push -u origin feat/repo-context-injection
gh pr create --fill
```
