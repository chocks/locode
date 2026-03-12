import * as readline from 'readline'
import { Orchestrator } from '../orchestrator/orchestrator'
import type { OrchestratorResult } from '../orchestrator/orchestrator'
import { createSpinner } from './spinner'
import { formatPrompt, formatContinuation, formatSeparator, type PromptMode } from './display'
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

export type ConfirmAction = 'proceed' | 'cancel' | 'switch'

export function parseConfirmation(input: string): ConfirmAction {
  const trimmed = input.trim().toLowerCase()
  if (trimmed === 'n') return 'cancel'
  if (trimmed === 's') return 'switch'
  return 'proceed'
}

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

export async function startRepl(config: Config, options?: { claudeOnly?: boolean; localOnly?: boolean; verbose?: boolean }): Promise<void> {
  const orch = new Orchestrator(config, undefined, undefined, options)
  await orch.initMcp()
  if (orch.isLocalOnly()) {
    console.log(`[local-only mode] Using ${config.local_llm.model}\n`)
  }
  if (orch.isClaudeOnly()) {
    console.log(`[claude-only mode] Using ${config.claude.model}\n`)
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const mode: PromptMode = orch.isLocalOnly() ? 'local' : orch.isClaudeOnly() ? 'claude' : 'hybrid'
  const promptModel = orch.isLocalOnly() ? config.local_llm.model : orch.isClaudeOnly() ? config.claude.model : undefined

  console.log('locode — local-first AI coding CLI')
  console.log('Type your task, or "stats" for token usage, "exit" to quit.\n')

  let lastSummary: string | undefined
  let buffer: string[] = []
  let processing = false

  const showPrompt = () => {
    if (buffer.length === 0) {
      console.log(formatSeparator())
      process.stdout.write(formatPrompt(mode, promptModel))
    } else {
      process.stdout.write(formatContinuation())
    }
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
        await orch.shutdown()
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
      process.stdout.write(formatContinuation())
      return
    }

    processing = true
    const input = buffer.join('\n').trim()
    buffer = []
    console.log(formatSeparator())

    try {
      let result: OrchestratorResult

      if (orch.isLocalOnly() || orch.isClaudeOnly() || orch.isLocalFallback()) {
        const spinner = createSpinner('Thinking...')
        spinner.start()
        try {
          result = await orch.process(input, lastSummary)
        } finally {
          spinner.stop()
        }
      } else {
        const routeSpinner = createSpinner('Routing...')
        routeSpinner.start()
        let decision: Awaited<ReturnType<typeof orch.route>>
        try {
          decision = await orch.route(input)
        } finally {
          routeSpinner.stop()
        }

        if (decision.method === 'rule') {
          const spinner = createSpinner('Thinking...')
          spinner.start()
          try {
            result = await orch.execute(input, decision.agent, lastSummary)
          } finally {
            spinner.stop()
          }
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
          const spinner = createSpinner('Thinking...')
          spinner.start()
          try {
            result = await orch.execute(input, chosenAgent, lastSummary)
          } finally {
            spinner.stop()
          }
        }
      }

      // Suggest Claude escalation
      if (result.agent === 'local' && !orch.isLocalOnly() && looksLikeStruggle(result.content)) {
        processing = false
        const answer = await askQuestion(rl, '\n[locode] Task may be too complex for local LLM. Route to Claude instead? [y/N] ')
        processing = true
        if (answer.trim().toLowerCase() === 'y') {
          const spinner = createSpinner('Thinking...')
          spinner.start()
          try {
            result = await orch.retryWithClaude(input, lastSummary)
          } finally {
            spinner.stop()
          }
        }
      }

      // Suggest local handoff
      if (result.agent === 'claude' && orch.isClaudeOnly() && looksLikeSimpleLocalTask(input)) {
        processing = false
        const answer = await askQuestion(rl, '\n[locode] This looks like a simple task. Route to local LLM to save tokens? [y/N] ')
        processing = true
        if (answer.trim().toLowerCase() === 'y') {
          const spinner = createSpinner('Thinking...')
          spinner.start()
          try {
            result = await orch.retryWithLocal(input, lastSummary)
          } finally {
            spinner.stop()
          }
        }
      }

      const resultModel = result.agent === 'local' ? config.local_llm.model : config.claude.model
      printResult(result.content, result.agent, result.routeMethod, result.reason, resultModel)
      lastSummary = result.summary
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`)
    }

    processing = false
    showPrompt()
  })

  showPrompt()
}
