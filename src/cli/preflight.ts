import { isOllamaRunning } from './install'

/**
 * Run startup health checks and print backend availability.
 * Informational only — does not exit or block.
 */
export function preflight(baseUrl: string): void {
  const ollamaOk = isOllamaRunning()
  const claudeOk = !!process.env.ANTHROPIC_API_KEY

  const host = (() => { try { return new URL(baseUrl).host } catch { return baseUrl } })()

  if (ollamaOk) {
    console.log(`  ✓ Ollama    — running (${host})`)
  } else {
    console.log(`  ✗ Ollama    — not reachable (is it running? try: ollama serve)`)
  }

  if (claudeOk) {
    console.log(`  ✓ Claude    — API key configured`)
  } else {
    console.log(`  ✗ Claude    — no API key (local-only mode)`)
  }

  if (!ollamaOk && !claudeOk) {
    console.error(`  ⚠ No backends available. Run 'locode setup' to get started.`)
  }
}
