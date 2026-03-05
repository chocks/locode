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
