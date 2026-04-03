import fs from 'fs'
import os from 'os'
import type { LocalModelEvalReport, VariantSummary } from './eval-local-models'
import { getDefaultEvalOutputPath } from './eval-local-models'

export interface HardwareProfile {
  platform: string
  arch: string
  totalMemoryGb: number
  cpuCount: number
}

export interface RankedVariant {
  summary: VariantSummary
  estimatedMemoryGb?: number
  requiredMemoryGb?: number
  fitsHardware: boolean
}

export interface LocalModelRecommendation {
  hardware: HardwareProfile
  recommended: RankedVariant
  candidates: RankedVariant[]
  fittingCandidates: RankedVariant[]
}

export interface RecommendLocalModelOptions {
  reportPath?: string
  hardware?: HardwareProfile
  top?: number
  json?: boolean
}

const CURATED_MEMORY_ESTIMATES: Record<string, number> = {
  'llama3.1:8b': 6,
  'llama3.2:3b': 2.5,
  'gemma4:2b': 3,
  'gemma4:e4b': 4,
  'gemma4:27b': 18,
  'qwen2.5-coder:7b': 5,
  'qwen2.5-coder:14b': 9,
  'qwen2.5-coder:32b': 20,
  'devstral:24b': 14,
  'mistral-small:24b': 14,
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

function compareRankedVariants(left: RankedVariant, right: RankedVariant): number {
  if (left.fitsHardware !== right.fitsHardware) {
    return left.fitsHardware ? -1 : 1
  }
  if (left.summary.fullRunPassRate !== right.summary.fullRunPassRate) {
    return right.summary.fullRunPassRate - left.summary.fullRunPassRate
  }
  if (left.summary.taskPassRate !== right.summary.taskPassRate) {
    return right.summary.taskPassRate - left.summary.taskPassRate
  }
  if (left.summary.invalidToolCallRate !== right.summary.invalidToolCallRate) {
    return left.summary.invalidToolCallRate - right.summary.invalidToolCallRate
  }
  if (left.summary.repeatedFailureRate !== right.summary.repeatedFailureRate) {
    return left.summary.repeatedFailureRate - right.summary.repeatedFailureRate
  }
  if (left.summary.avgDurationMs !== right.summary.avgDurationMs) {
    return left.summary.avgDurationMs - right.summary.avgDurationMs
  }
  if (left.summary.avgOutputTokens !== right.summary.avgOutputTokens) {
    return left.summary.avgOutputTokens - right.summary.avgOutputTokens
  }
  if (left.summary.avgInputTokens !== right.summary.avgInputTokens) {
    return left.summary.avgInputTokens - right.summary.avgInputTokens
  }
  return left.summary.variant.model.localeCompare(right.summary.variant.model)
}

export function estimateModelMemoryGb(model: string): number | undefined {
  if (CURATED_MEMORY_ESTIMATES[model] !== undefined) {
    return CURATED_MEMORY_ESTIMATES[model]
  }

  const match = model.match(/:(?:e)?(\d+(?:\.\d+)?)b$/i)
  if (!match) {
    return undefined
  }

  const sizeB = Number.parseFloat(match[1])
  if (!Number.isFinite(sizeB) || sizeB <= 0) {
    return undefined
  }

  return roundToOneDecimal(Math.max(2, sizeB * 0.75))
}

export function detectHardwareProfile(): HardwareProfile {
  return {
    platform: process.platform,
    arch: process.arch,
    totalMemoryGb: roundToOneDecimal(os.totalmem() / (1024 ** 3)),
    cpuCount: os.cpus().length,
  }
}

export function loadEvalReport(reportPath: string): LocalModelEvalReport {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`eval report not found at ${reportPath}`)
  }

  const raw = fs.readFileSync(reportPath, 'utf8')
  const parsed = JSON.parse(raw) as LocalModelEvalReport

  if (!Array.isArray(parsed.variants) || !Array.isArray(parsed.runs)) {
    throw new Error(`invalid eval report at ${reportPath}`)
  }

  return parsed
}

function getRequiredMemoryGb(estimatedMemoryGb?: number): number | undefined {
  if (estimatedMemoryGb === undefined) {
    return undefined
  }
  return roundToOneDecimal(estimatedMemoryGb + Math.max(2, estimatedMemoryGb * 0.25))
}

function buildRankedVariant(summary: VariantSummary, hardware: HardwareProfile): RankedVariant {
  const estimatedMemoryGb = estimateModelMemoryGb(summary.variant.model)
  const requiredMemoryGb = getRequiredMemoryGb(estimatedMemoryGb)

  return {
    summary,
    estimatedMemoryGb,
    requiredMemoryGb,
    fitsHardware: requiredMemoryGb === undefined || hardware.totalMemoryGb >= requiredMemoryGb,
  }
}

export function recommendLocalModel(
  report: LocalModelEvalReport,
  hardware: HardwareProfile = detectHardwareProfile(),
): LocalModelRecommendation {
  if (report.variants.length === 0) {
    throw new Error('eval report has no variants to rank')
  }

  const candidates = report.variants
    .map(summary => buildRankedVariant(summary, hardware))
    .sort(compareRankedVariants)
  const fittingCandidates = candidates.filter(candidate => candidate.fitsHardware)
  const recommended = (fittingCandidates[0] ?? candidates[0])!

  return {
    hardware,
    recommended,
    candidates,
    fittingCandidates,
  }
}

function printHumanRecommendation(recommendation: LocalModelRecommendation, top: number): void {
  const { hardware, recommended, candidates, fittingCandidates } = recommendation
  console.log('\nRecommended local model\n')
  console.log(`Hardware: ${hardware.platform}/${hardware.arch}, ${hardware.totalMemoryGb} GB RAM, ${hardware.cpuCount} CPU cores`)
  if (fittingCandidates.length === 0) {
    console.log('No evaluated model appears to fit this machine with safety headroom. Falling back to the best result overall.\n')
  }
  console.log(`${recommended.summary.variant.model}`)
  console.log(`  task pass rate      ${(recommended.summary.taskPassRate * 100).toFixed(1)}%`)
  console.log(`  full run pass rate  ${(recommended.summary.fullRunPassRate * 100).toFixed(1)}%`)
  console.log(`  avg duration        ${Math.round(recommended.summary.avgDurationMs)}ms`)
  console.log(`  avg tokens          in ${Math.round(recommended.summary.avgInputTokens)} / out ${Math.round(recommended.summary.avgOutputTokens)}`)
  if (recommended.estimatedMemoryGb !== undefined) {
    console.log(`  estimated RAM       ~${recommended.estimatedMemoryGb} GB (recommend >= ${recommended.requiredMemoryGb} GB total)`)
  }

  const limit = Math.max(1, top)
  console.log('\nTop candidates\n')
  for (const candidate of candidates.slice(0, limit)) {
    const fitLabel = candidate.fitsHardware ? 'fits' : 'may not fit'
    const memoryLabel = candidate.estimatedMemoryGb === undefined
      ? 'RAM estimate unknown'
      : `~${candidate.estimatedMemoryGb} GB`
    console.log(`${candidate.summary.variant.model}  ${fitLabel}`)
    console.log(`  pass ${(candidate.summary.taskPassRate * 100).toFixed(1)}%  full ${(candidate.summary.fullRunPassRate * 100).toFixed(1)}%  duration ${Math.round(candidate.summary.avgDurationMs)}ms  ${memoryLabel}`)
  }
}

export function runRecommendLocalModel(options: RecommendLocalModelOptions = {}): LocalModelRecommendation {
  const reportPath = options.reportPath ?? getDefaultEvalOutputPath()
  const report = loadEvalReport(reportPath)
  const recommendation = recommendLocalModel(report, options.hardware)

  if (options.json) {
    console.log(JSON.stringify({
      reportPath,
      hardware: recommendation.hardware,
      recommended: recommendation.recommended,
      candidates: recommendation.candidates.slice(0, Math.max(1, options.top ?? 3)),
    }, null, 2))
  } else {
    printHumanRecommendation(recommendation, options.top ?? 3)
    console.log(`\nReport: ${reportPath}`)
  }

  return recommendation
}
