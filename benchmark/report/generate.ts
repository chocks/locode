import Handlebars from 'handlebars'
import fs from 'fs'
import path from 'path'
import { BenchmarkResult } from '../parsers/locode'

// Pricing per million tokens (USD) - claude-sonnet-4-6
const PRICING = { input: 3.0, output: 15.0 }

function calcCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * PRICING.input + (outputTokens / 1_000_000) * PRICING.output
}

export function generateReport(results: BenchmarkResult[], outputPath: string): void {
  const templateSrc = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8')
  Handlebars.registerHelper('ifCond', function(this: unknown, v1: unknown, v2: unknown, options: Handlebars.HelperOptions) {
    return v1 === v2 ? options.fn(this) : options.inverse(this)
  })
  const template = Handlebars.compile(templateSrc)

  const claudeOnly = results.find(r => r.mode === 'claude-only')!
  const hybrid = results.find(r => r.mode === 'hybrid')!

  const claudeOnlyCost = calcCost(claudeOnly.claudeInputTokens, claudeOnly.claudeOutputTokens)
  const hybridCost = calcCost(hybrid.claudeInputTokens, hybrid.claudeOutputTokens)

  const savedDollars = claudeOnlyCost - hybridCost
  const savingsPct = claudeOnlyCost > 0
    ? ((savedDollars / claudeOnlyCost) * 100).toFixed(1)
    : '0.0'

  const modes = [
    {
      mode: 'claude-only',
      claudeInputTokens: claudeOnly.claudeInputTokens.toLocaleString(),
      claudeOutputTokens: claudeOnly.claudeOutputTokens.toLocaleString(),
      cost: claudeOnlyCost.toFixed(4),
      badgeClass: 'badge-red',
      best: false,
      savingsClass: 'red',
      savingsLabel: 'baseline',
    },
    {
      mode: 'hybrid',
      claudeInputTokens: hybrid.claudeInputTokens.toLocaleString(),
      claudeOutputTokens: hybrid.claudeOutputTokens.toLocaleString(),
      cost: hybridCost.toFixed(4),
      badgeClass: 'badge-yellow',
      best: true,
      savingsClass: 'green',
      savingsLabel: `−${savingsPct}% ($${savedDollars.toFixed(4)} saved)`,
    },
    {
      mode: 'local-only',
      claudeInputTokens: '0',
      claudeOutputTokens: '0',
      cost: '0.0000',
      badgeClass: 'badge-green',
      best: false,
      savingsClass: 'green',
      savingsLabel: '100% saved (no Claude)',
    },
  ]

  const html = template({
    generatedAt: new Date().toLocaleString(),
    taskName: 'Todo Webapp',
    claudeModel: 'claude-sonnet-4-6',
    hybridCost: hybridCost.toFixed(4),
    claudeOnlyCost: claudeOnlyCost.toFixed(4),
    savingsPct,
    savedDollars: savedDollars.toFixed(4),
    modes,
    hybridLocalTurns: hybrid.localTurns,
    hybridClaudeTurns: hybrid.claudeTurns,
    hybridLocalTokens: (hybrid.localInputTokens + hybrid.localOutputTokens).toLocaleString(),
    hybridClaudeTokens: (hybrid.claudeInputTokens + hybrid.claudeOutputTokens).toLocaleString(),
  })

  fs.writeFileSync(outputPath, html)
}
