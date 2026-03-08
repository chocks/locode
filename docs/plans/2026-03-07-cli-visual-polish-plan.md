# CLI Visual Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a thinking spinner and styled mode-aware prompt to the locode CLI.

**Architecture:** New `spinner.ts` module provides a zero-dependency ANSI spinner. `display.ts` gains prompt formatting helpers. `repl.ts` integrates both — spinner wraps async LLM calls, styled prompt replaces plain `> `.

**Tech Stack:** Node.js built-ins only (`process.stderr`, ANSI escape codes, `setInterval`). No new dependencies.

---

### Task 1: Spinner Module — Tests

**Files:**
- Create: `src/cli/spinner.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSpinner } from './spinner'

describe('createSpinner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes spinner frames to stderr on TTY', () => {
    const write = vi.fn()
    const spinner = createSpinner('Thinking...', { write, isTTY: true })
    spinner.start()

    vi.advanceTimersByTime(80)
    expect(write).toHaveBeenCalled()
    const firstCall = write.mock.calls[0][0] as string
    expect(firstCall).toContain('Thinking...')

    spinner.stop()
  })

  it('clears the line on stop', () => {
    const write = vi.fn()
    const spinner = createSpinner('Thinking...', { write, isTTY: true })
    spinner.start()
    vi.advanceTimersByTime(80)

    write.mockClear()
    spinner.stop()

    const stopCall = write.mock.calls[0][0] as string
    expect(stopCall).toContain('\r')
  })

  it('skips animation on non-TTY', () => {
    const write = vi.fn()
    const spinner = createSpinner('Thinking...', { write, isTTY: false })
    spinner.start()

    vi.advanceTimersByTime(200)
    // Should print message once (no animation)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toContain('Thinking...')

    spinner.stop()
  })

  it('stop is safe to call without start', () => {
    const write = vi.fn()
    const spinner = createSpinner('Thinking...', { write, isTTY: true })
    expect(() => spinner.stop()).not.toThrow()
  })

  it('cycles through frames over time', () => {
    const write = vi.fn()
    const spinner = createSpinner('Thinking...', { write, isTTY: true })
    spinner.start()

    vi.advanceTimersByTime(80 * 3)
    // Should have multiple calls with different frames
    const frames = write.mock.calls.map((c: [string]) => c[0])
    const uniqueFrames = new Set(frames)
    expect(uniqueFrames.size).toBeGreaterThan(1)

    spinner.stop()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/spinner.test.ts`
Expected: FAIL — `./spinner` module not found

---

### Task 2: Spinner Module — Implementation

**Files:**
- Create: `src/cli/spinner.ts`

**Step 3: Write minimal implementation**

```ts
const FRAMES = ['\u280B','\u2819','\u2839','\u2838','\u283C','\u2834','\u2826','\u2827','\u2807','\u280F']
const INTERVAL = 80

export interface SpinnerOptions {
  write?: (data: string) => void
  isTTY?: boolean
}

export interface Spinner {
  start(): void
  stop(): void
}

export function createSpinner(message: string, opts?: SpinnerOptions): Spinner {
  const write = opts?.write ?? ((data: string) => process.stderr.write(data))
  const isTTY = opts?.isTTY ?? (process.stderr.isTTY ?? false)

  let timer: ReturnType<typeof setInterval> | null = null
  let frameIndex = 0

  return {
    start() {
      if (!isTTY) {
        write(`  ${message}\n`)
        return
      }
      // Hide cursor
      write('\x1b[?25l')
      timer = setInterval(() => {
        const frame = FRAMES[frameIndex % FRAMES.length]
        write(`\r\x1b[2K  \x1b[36m${frame}\x1b[0m ${message}`)
        frameIndex++
      }, INTERVAL)
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      if (isTTY) {
        // Clear line and show cursor
        write('\r\x1b[2K\x1b[?25h')
      }
    },
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/spinner.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/cli/spinner.ts src/cli/spinner.test.ts
git commit -m "feat: add zero-dependency CLI spinner"
```

---

### Task 3: Styled Prompt Helpers — Tests

**Files:**
- Modify: `src/cli/display.ts`
- Test: existing tests are in `src/cli/repl.test.ts` but display has none — we add inline

**Step 6: Add prompt helper tests to a new test file**

Create `src/cli/display.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatPrompt, formatContinuation } from './display'

describe('formatPrompt', () => {
  it('returns green prompt for hybrid mode', () => {
    const result = formatPrompt('hybrid')
    expect(result).toContain('>')
    expect(result).toContain('\x1b[32m') // green
  })

  it('returns cyan prompt with "local" for local-only mode', () => {
    const result = formatPrompt('local')
    expect(result).toContain('local')
    expect(result).toContain('\x1b[36m') // cyan
  })

  it('returns magenta prompt with "claude" for claude-only mode', () => {
    const result = formatPrompt('claude')
    expect(result).toContain('claude')
    expect(result).toContain('\x1b[35m') // magenta
  })
})

describe('formatContinuation', () => {
  it('returns a dim continuation prompt', () => {
    const result = formatContinuation()
    expect(result).toContain('\x1b[2m') // dim
    expect(result).toContain('...')
  })
})
```

**Step 7: Run tests to verify they fail**

Run: `npx vitest run src/cli/display.test.ts`
Expected: FAIL — `formatPrompt` / `formatContinuation` not exported

---

### Task 4: Styled Prompt Helpers — Implementation

**Files:**
- Modify: `src/cli/display.ts` — add `formatPrompt` and `formatContinuation` exports

**Step 8: Add prompt helpers to display.ts**

Append to existing `src/cli/display.ts` (after the existing `printResult` function):

```ts
export type PromptMode = 'hybrid' | 'local' | 'claude'

export function formatPrompt(mode: PromptMode): string {
  switch (mode) {
    case 'local':
      return '\x1b[36m> local\x1b[0m '
    case 'claude':
      return '\x1b[35m> claude\x1b[0m '
    default:
      return '\x1b[32m>\x1b[0m '
  }
}

export function formatContinuation(): string {
  return '\x1b[2m...\x1b[0m '
}
```

**Step 9: Run tests to verify they pass**

Run: `npx vitest run src/cli/display.test.ts`
Expected: PASS (all 4 tests)

**Step 10: Commit**

```bash
git add src/cli/display.ts src/cli/display.test.ts
git commit -m "feat: add styled prompt formatting helpers"
```

---

### Task 5: Integrate Spinner & Prompt into REPL

**Files:**
- Modify: `src/cli/repl.ts`

**Step 11: Update repl.ts imports**

Add at the top of `src/cli/repl.ts`:

```ts
import { createSpinner } from './spinner'
import { formatPrompt, formatContinuation, type PromptMode } from './display'
```

**Step 12: Replace showPrompt with styled version**

Replace the `showPrompt` closure and add mode detection. Changes to `startRepl`:

1. After `const rl = ...` line, determine the mode:

```ts
const mode: PromptMode = orch.isLocalOnly() ? 'local' : orch.isClaudeOnly() ? 'claude' : 'hybrid'
```

2. Replace `showPrompt`:

```ts
const showPrompt = () => {
  process.stdout.write(buffer.length === 0 ? formatPrompt(mode) : formatContinuation())
}
```

3. Replace the multiline continuation `process.stdout.write('... ')` with:

```ts
process.stdout.write(formatContinuation())
```

**Step 13: Wrap LLM calls with spinner**

In the `try` block inside the `rl.on('line', ...)` handler, wrap each async orchestrator call. The pattern is:

```ts
const spinner = createSpinner('Thinking...')
spinner.start()
try {
  result = await orch.process(input, lastSummary)
} finally {
  spinner.stop()
}
```

Apply this pattern to:
- `orch.process(input, lastSummary)` (line ~118)
- `orch.route(input)` (line ~120) — use message `'Routing...'`
- `orch.execute(input, ...)` (line ~124 and ~140) — use `'Thinking...'`
- `orch.retryWithClaude(input, lastSummary)` (line ~150)
- `orch.retryWithLocal(input, lastSummary)` (line ~159)

**Important:** Stop the spinner BEFORE any `askQuestion` call (routing confirmation, struggle escalation, simple-task handoff) since the spinner writes to stderr and would interfere with readline.

**Step 14: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS (existing repl tests are pure-function unit tests, unaffected)

**Step 15: Commit**

```bash
git add src/cli/repl.ts
git commit -m "feat: integrate spinner and styled prompt into REPL"
```

---

### Task 6: Add Spinner to Single-Shot Run Command

**Files:**
- Modify: `src/index.ts`

**Step 16: Add spinner to the `run` command action**

In `src/index.ts`, add import at top:

```ts
import { createSpinner } from './cli/spinner'
```

In the `run` command `.action()`, wrap `orch.process(prompt)`:

```ts
const spinner = createSpinner('Thinking...')
spinner.start()
let result
try {
  result = await orch.process(prompt)
} finally {
  spinner.stop()
}
console.log(result.content)
```

**Step 17: Build and verify**

Run: `npm run build`
Expected: Clean compile, no errors

**Step 18: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 19: Commit**

```bash
git add src/index.ts
git commit -m "feat: add spinner to single-shot run command"
```

---

### Task 7: Manual Smoke Test

**Step 20: Test the REPL interactively**

Run: `npm run dev -- chat --local-only`

Verify:
- Prompt shows cyan `> local` text
- Typing a prompt shows braille spinner with "Thinking..."
- Spinner disappears when response arrives
- Multiline input (with ``` code fences) shows dim `...` continuation

**Step 21: Test single-shot mode**

Run: `npm run dev -- run "explain hello world" --local-only`

Verify:
- Spinner shows while processing
- Spinner clears before output prints

**Step 22: Final commit if any adjustments needed, then done**
