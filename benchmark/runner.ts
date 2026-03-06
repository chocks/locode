import { execSync, execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Orchestrator } from '../src/orchestrator/orchestrator'
import { loadConfig } from '../src/config/loader'
import { parseLocodeStats, BenchmarkResult } from './parsers/locode'
import { generateReport } from './report/generate'

const TASK_FILE = path.join(__dirname, 'tasks/todo-webapp.md')

async function runMode(mode: BenchmarkResult['mode']): Promise<BenchmarkResult> {
  const task = fs.readFileSync(TASK_FILE, 'utf8')
  const config = loadConfig(path.join(__dirname, '../locode.yaml'))
  const orch = new Orchestrator(config, undefined, undefined, {
    claudeOnly: mode === 'claude-only',
    localOnly: mode === 'local-only',
  })

  console.log(`  Running ${mode} mode...`)
  const start = Date.now()
  await orch.process(task)
  const durationMs = Date.now() - start

  const stats = orch.getStats()
  return {
    ...parseLocodeStats(JSON.stringify(stats), mode),
    durationMs,
  } as BenchmarkResult
}

async function main() {
  console.log('Locode Benchmark — 3-mode comparison\n')
  console.log('Task: Build a todo webapp\n')

  const results: BenchmarkResult[] = []
  for (const mode of ['claude-only', 'hybrid', 'local-only'] as const) {
    results.push(await runMode(mode))
  }

  const reportPath = path.join(process.cwd(), 'locode-benchmark-report.html')
  generateReport(results, reportPath)
  console.log(`\nReport saved to: ${reportPath}`)
  execFileSync('open', [reportPath])
}

main().catch(console.error)
