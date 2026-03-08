# CLI Visual Polish — Spinner & Styled Prompt

**Date:** 2026-03-07
**Status:** Approved

## Goal

Add a thinking spinner animation and a styled prompt bar to the locode CLI for better UX feedback.

## Design

### 1. Spinner (`src/cli/spinner.ts`)

Zero-dependency spinner using ANSI escape codes. Braille characters cycling at ~80ms. Writes to `stderr` to avoid polluting piped output.

```ts
const spinner = createSpinner('Thinking...')
spinner.start()
// ... async work ...
spinner.stop()  // clears the spinner line
```

- Detects non-TTY and skips animation (prints message once)
- Uses braille frames: `['\\u280B','\\u2819','\\u2839','\\u2838','\\u283C','\\u2834','\\u2826','\\u2827','\\u2807','\\u280F']`

### 2. Styled Prompt

Replace plain `> ` with colored mode-aware prompt:

- **Hybrid mode:** green `>`
- **Local-only:** cyan `> local`
- **Claude-only:** magenta `> claude`
- **Multiline continuation:** dim `... `

### 3. Integration Points

- `repl.ts` — wrap `orch.process()`, `orch.execute()`, `orch.route()`, and retry calls with spinner
- `index.ts` run command — wrap single-shot `orch.process()` with spinner
- No changes to orchestrator — spinner is purely a CLI concern

### 4. Files

| File | Change |
|---|---|
| `src/cli/spinner.ts` | New — spinner utility |
| `src/cli/spinner.test.ts` | New — tests |
| `src/cli/repl.ts` | Use spinner + styled prompt |
| `src/cli/display.ts` | Export prompt formatting helpers |
| `src/index.ts` | Add spinner to run command |

No new dependencies. No config changes.
