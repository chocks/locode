import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { Orchestrator } from '../orchestrator/orchestrator'
import { generateReport } from '../../benchmark/report/generate'
import { parseLocodeStats, BenchmarkResult } from '../../benchmark/parsers/locode'
import type { Config } from '../config/schema'

export interface BenchmarkOptions {
  prompts: string[]       // one or more prompts to run
  output: string          // path to save HTML report
  open: boolean           // auto-open in browser
}

const DEFAULT_TASK_FILE = path.join(__dirname, '../../benchmark/tasks/todo-webapp.md')

export function resolvePrompts(opts: { prompt?: string[]; task?: string }): string[] {
  if (opts.task) {
    const content = fs.readFileSync(path.resolve(opts.task), 'utf8')
    return [content]
  }
  if (opts.prompt && opts.prompt.length > 0) {
    return opts.prompt
  }
  // Default: load built-in todo-webapp task
  return [fs.readFileSync(DEFAULT_TASK_FILE, 'utf8')]
}

async function runMode(
  config: Config,
  prompts: string[],
  mode: BenchmarkResult['mode']
): Promise<BenchmarkResult> {
  const orch = new Orchestrator(config, undefined, undefined, {
    claudeOnly: mode === 'claude-only',
    localOnly: mode === 'local-only',
  })

  const start = Date.now()
  for (const prompt of prompts) {
    await orch.process(prompt)
  }
  const durationMs = Date.now() - start

  const stats = orch.getStats()
  return {
    ...parseLocodeStats(JSON.stringify(stats), mode),
    durationMs,
  } as BenchmarkResult
}

export async function runBenchmark(config: Config, opts: BenchmarkOptions): Promise<void> {
  const { prompts, output, open } = opts

  console.log('\nLocode Benchmark\n')
  console.log(`Prompts  : ${prompts.length}`)
  console.log(`Output   : ${output}\n`)

  if (prompts.length === 1) {
    const preview = prompts[0].slice(0, 80).replace(/\n/g, ' ')
    console.log(`Task: ${preview}${prompts[0].length > 80 ? '...' : ''}\n`)
  } else {
    prompts.forEach((p, i) => {
      const preview = p.slice(0, 60).replace(/\n/g, ' ')
      console.log(`  ${i + 1}. ${preview}${p.length > 60 ? '...' : ''}`)
    })
    console.log()
  }

  const results: BenchmarkResult[] = []
  for (const mode of ['claude-only', 'hybrid', 'local-only'] as const) {
    process.stdout.write(`Running ${mode.padEnd(12)} ...`)
    const result = await runMode(config, prompts, mode)
    results.push(result)
    console.log(` done (${result.durationMs}ms)`)
  }

  generateReport(results, output)
  console.log(`\nReport saved to: ${output}`)

  if (open) {
    try {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
      execSync(`${opener} "${output}"`)
    } catch {
      // non-fatal if auto-open fails
    }
  }
}
