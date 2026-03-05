import Handlebars from 'handlebars'
import fs from 'fs'
import path from 'path'
import { BenchmarkResult } from '../parsers/locode'

export function generateReport(results: BenchmarkResult[], outputPath: string): void {
  const templateSrc = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8')
  const template = Handlebars.compile(templateSrc)

  const locode = results.find(r => r.tool === 'locode')!

  // Estimate "Claude only" cost: all tokens routed through claude-sonnet-4-6
  const claudeOnlyInputTokens = locode.inputTokens
  const claudeOnlyOutputTokens = locode.outputTokens
  const claudeOnlyCost = ((claudeOnlyInputTokens / 1_000_000) * 3.0 + (claudeOnlyOutputTokens / 1_000_000) * 15.0).toFixed(4)
  const locodeCost = locode.estimatedCostUsd.toFixed(4)
  const savedCost = (parseFloat(claudeOnlyCost) - parseFloat(locodeCost)).toFixed(4)
  const savedCostPct = ((parseFloat(savedCost) / parseFloat(claudeOnlyCost)) * 100).toFixed(1)

  const savedInputPct = claudeOnlyInputTokens > 0
    ? (((claudeOnlyInputTokens - locode.claudeInputTokens) / claudeOnlyInputTokens) * 100).toFixed(1)
    : '0.0'
  const savedOutputPct = claudeOnlyOutputTokens > 0
    ? (((claudeOnlyOutputTokens - locode.claudeOutputTokens) / claudeOnlyOutputTokens) * 100).toFixed(1)
    : '0.0'

  const html = template({
    generatedAt: new Date().toLocaleString(),
    taskName: 'Todo Webapp',
    localRoutingPct: locode.localRoutingPct.toFixed(1),
    claudeOnlyInputTokens,
    claudeOnlyOutputTokens,
    locodeInputTokens: locode.inputTokens,
    locodeOutputTokens: locode.outputTokens,
    savedInputTokensPct: savedInputPct,
    savedOutputTokensPct: savedOutputPct,
    claudeOnlyCost,
    locodeCost,
    savedCost,
    savedCostPct,
    localTurns: locode.localTurns,
    claudeTurns: locode.claudeTurns,
    localInputTokens: locode.localInputTokens,
    localOutputTokens: locode.localOutputTokens,
    claudeInputTokens: locode.claudeInputTokens,
    claudeOutputTokens: locode.claudeOutputTokens,
  })

  fs.writeFileSync(outputPath, html)
}
