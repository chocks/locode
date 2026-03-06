# Token Exhaustion Fallback Design

## Goal

When Claude's daily token limit is nearly exhausted, automatically switch to the local agent for continued work. When the limit resets, automatically hand work back to Claude. All within a single interactive session.

## Trigger

After each Claude response, read `anthropic-ratelimit-tokens-remaining` and `anthropic-ratelimit-tokens-limit` from the HTTP response headers (via Anthropic SDK's `.withResponse()`). When `remaining / limit < (1 - token_threshold)`, initiate a proactive handoff to local.

## State Machine

```
NORMAL
  → tokens remaining < threshold → [Claude generates handoff summary] → LOCAL_FALLBACK
LOCAL_FALLBACK
  → Date.now() > resetsAt → [try Claude with local summary] → NORMAL (success)
                                                            → LOCAL_FALLBACK (still rate-limited)
```

## Components

### ClaudeAgent changes

- Switch `client.messages.create()` to `client.messages.create(...).withResponse()` to access headers
- Return a `RateLimitInfo` object alongside `AgentResult`:
  ```ts
  interface RateLimitInfo {
    tokensRemaining: number
    tokensLimit: number
    resetsAt: number  // Unix timestamp ms
  }
  ```
- Add `generateHandoffSummary(context: string): Promise<string>` — calls Claude with a compact summarization prompt (≤200 tokens output) to produce a handoff summary for the local agent

### Orchestrator changes

- After each Claude call, evaluate `RateLimitInfo` against `config.claude.token_threshold`
- At threshold breach:
  1. Call `generateHandoffSummary()` with recent context
  2. If summary generation fails (last tokens used), fall back to last `result.summary`
  3. Set `localFallback = true`, store `resetsAt`
  4. Log: `[locode] Claude tokens at 99%, switching to local agent`
- On each prompt while `localFallback = true`:
  - If `Date.now() < resetsAt` → route to local with stored summary as context
  - If `Date.now() >= resetsAt` → attempt Claude call with local summary as context
    - Success → set `localFallback = false`, log `[locode] Claude available again, resuming`
    - `RateLimitError` → stay local, update `resetsAt` from new headers if available, else add 1 hour

### Config

New field in `schema.ts` and `locode.yaml`:

```yaml
claude:
  model: claude-sonnet-4-6
  token_threshold: 0.99   # switch to local when this fraction of daily limit is consumed
```

## Edge Cases

- `generateHandoffSummary()` fails → use last recorded `result.summary` as context
- `resetsAt` header absent → default to next midnight UTC
- Switch-back fails with non-rate-limit error → propagate error normally, exit fallback mode
- `token_threshold` not set → default `0.99`

## Testing

All tests use `vi.mock()` — no real API calls.

**`claude.test.ts`:**
- Mock `.withResponse()` with varying header values
- Verify `RateLimitInfo` is parsed correctly
- Verify `generateHandoffSummary()` sends a compact summarization prompt

**`orchestrator.test.ts`:**
- Ratio below threshold → stays on Claude, no fallback triggered
- Ratio above threshold → summary generated, `localFallback` flips, next prompt routes to local
- Past `resetsAt` → switch-back attempted, succeeds → back to normal mode
- Past `resetsAt` → switch-back attempted, still rate-limited → stays local, `resetsAt` updated
