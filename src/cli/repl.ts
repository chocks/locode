import * as readline from 'readline'
import { Orchestrator } from '../orchestrator/orchestrator'
import { printResult, printStats } from './display'
import type { Config } from '../config/schema'

// ~50k chars ≈ 12.5k tokens — large enough for full files, small enough to avoid OOM
const MAX_INPUT_CHARS = 50_000

export function hasUnclosedCodeBlock(text: string): boolean {
  const matches = text.match(/```/g)
  return !!matches && matches.length % 2 !== 0
}

export function looksLikeStruggle(response: string): boolean {
  const patterns = [
    /i (don'?t|cannot|can'?t|am unable to) (have|access|use|run|read|execute)/i,
    /i'?m (unable|not able) to (access|use|run|read|execute)/i,
    /not able to (access|use|run|read|execute)/i,
    /beyond my (capabilities|ability)/i,
    /i lack (the )?(ability|access|capability)/i,
  ]
  return patterns.some(p => p.test(response))
}

export function looksLikeSimpleLocalTask(prompt: string): boolean {
  return /\b(find|grep|search|ls|cat|read|explore|show|list|git\s+(log|diff|status|blame))\b/i.test(prompt)
}

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

export async function startRepl(config: Config, options?: { claudeOnly?: boolean; localOnly?: boolean }): Promise<void> {
  const orch = new Orchestrator(config, undefined, undefined, options)
  if (orch.isLocalOnly()) {
    console.log('[local-only mode] All tasks routed to local LLM\n')
  }
  if (orch.isClaudeOnly()) {
    console.log('[claude-only mode] All tasks routed to Claude\n')
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  console.log('locode — local-first AI coding CLI')
  console.log('Type your task, or "stats" for token usage, "exit" to quit.\n')

  let lastSummary: string | undefined
  let buffer: string[] = []
  let processing = false

  const showPrompt = () => {
    process.stdout.write(buffer.length === 0 ? '> ' : '... ')
  }

  rl.on('line', async (line) => {
    if (processing) return

    buffer.push(line)
    const fullText = buffer.join('\n').trim()

    if (!fullText) {
      buffer = []
      showPrompt()
      return
    }

    // Special commands only on the first line of a fresh input
    if (buffer.length === 1) {
      const trimmed = line.trim()
      if (trimmed === 'exit' || trimmed === 'quit') {
        printStats(orch.getStats())
        rl.close()
        return
      }
      if (trimmed === 'stats') {
        printStats(orch.getStats())
        buffer = []
        showPrompt()
        return
      }
    }

    // Guard against oversized input
    if (fullText.length > MAX_INPUT_CHARS) {
      console.error(`[locode] Input exceeds ${MAX_INPUT_CHARS.toLocaleString()} characters. Please shorten your prompt.`)
      buffer = []
      showPrompt()
      return
    }

    // Continue collecting lines if a code fence is still open
    if (hasUnclosedCodeBlock(fullText)) {
      process.stdout.write('... ')
      return
    }

    processing = true
    const input = buffer.join('\n').trim()
    buffer = []

    try {
      let result = await orch.process(input, lastSummary)

      // Suggest Claude escalation if local agent signals it can't handle the task
      if (result.agent === 'local' && !orch.isLocalOnly() && looksLikeStruggle(result.content)) {
        processing = false
        const answer = await askQuestion(rl, '\n[locode] Task may be too complex for local LLM. Route to Claude instead? [y/N] ')
        processing = true
        if (answer.trim().toLowerCase() === 'y') {
          result = await orch.retryWithClaude(input, lastSummary)
        }
      }

      // Suggest local handoff if Claude handled a task that looks simple (e.g. in --claude mode)
      if (result.agent === 'claude' && orch.isClaudeOnly() && looksLikeSimpleLocalTask(input)) {
        processing = false
        const answer = await askQuestion(rl, '\n[locode] This looks like a simple task. Route to local LLM to save tokens? [y/N] ')
        processing = true
        if (answer.trim().toLowerCase() === 'y') {
          result = await orch.retryWithLocal(input, lastSummary)
        }
      }

      printResult(result.content, result.agent, result.routeMethod)
      lastSummary = result.summary
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`)
    }

    processing = false
    showPrompt()
  })

  showPrompt()
}
