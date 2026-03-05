import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Orchestrator } from '../src/orchestrator/orchestrator'
import { loadConfig } from '../src/config/loader'
import { parseLocodeStats, BenchmarkResult } from './parsers/locode'
import { generateReport } from './report/generate'

const TASK_FILE = path.join(__dirname, 'tasks/todo-webapp.md')

async function runLocode(): Promise<Partial<BenchmarkResult>> {
  const task = fs.readFileSync(TASK_FILE, 'utf8')
  const config = loadConfig(path.join(__dirname, '../locode.yaml'))
  const orch = new Orchestrator(config)

  const start = Date.now()
  await orch.process(task)
  const durationMs = Date.now() - start

  const stats = orch.getStats()
  return {
    tool: 'locode',
    ...parseLocodeStats(JSON.stringify(stats)),
    durationMs,
  }
}

async function main() {
  console.log('Running Locode benchmark...')
  const locodeResult = await runLocode()

  const results: BenchmarkResult[] = [locodeResult as BenchmarkResult]
  const reportPath = path.join(process.cwd(), 'locode-benchmark-report.html')
  generateReport(results, reportPath)

  console.log(`\nReport saved to: ${reportPath}`)
  execSync(`open ${reportPath}`)
}

main().catch(console.error)
