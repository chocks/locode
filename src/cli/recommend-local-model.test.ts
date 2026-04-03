import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { LocalModelEvalReport, VariantSummary } from './eval-local-models'
import {
  detectHardwareProfile,
  estimateModelMemoryGb,
  loadEvalReport,
  recommendLocalModel,
  runRecommendLocalModel,
} from './recommend-local-model'

function makeSummary(model: string, overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    variant: {
      label: model.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      model,
      thinking: false,
    },
    runs: 3,
    tasksPerRun: 5,
    taskPassRate: 0.5,
    fullRunPassRate: 0,
    avgDurationMs: 10000,
    avgInputTokens: 2000,
    avgOutputTokens: 200,
    invalidToolCallRate: 0,
    repeatedFailureRate: 0,
    ...overrides,
  }
}

describe('estimateModelMemoryGb', () => {
  it('uses curated estimates for known models', () => {
    expect(estimateModelMemoryGb('gemma4:e4b')).toBe(4)
    expect(estimateModelMemoryGb('llama3.1:8b')).toBe(6)
    expect(estimateModelMemoryGb('qwen2.5-coder:14b')).toBe(9)
  })

  it('falls back to parsing parameter counts from the tag', () => {
    expect(estimateModelMemoryGb('custom-model:12b')).toBe(9)
    expect(estimateModelMemoryGb('custom-model:e2b')).toBe(2)
  })
})

describe('detectHardwareProfile', () => {
  const totalmemSpy = vi.spyOn(os, 'totalmem')
  const cpusSpy = vi.spyOn(os, 'cpus')

  afterEach(() => {
    totalmemSpy.mockReset()
    cpusSpy.mockReset()
  })

  it('returns rounded hardware information from the host', () => {
    totalmemSpy.mockReturnValue(16 * 1024 * 1024 * 1024)
    cpusSpy.mockReturnValue([{ model: 'cpu', speed: 3200, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }] as os.CpuInfo[])

    expect(detectHardwareProfile()).toMatchObject({
      totalMemoryGb: 16,
      cpuCount: 1,
    })
  })
})

describe('recommendLocalModel', () => {
  it('prefers the best-scoring model that fits the machine', () => {
    const report: LocalModelEvalReport = {
      generatedAt: '2026-04-03T00:00:00.000Z',
      cwd: '/tmp',
      variants: [
        makeSummary('gemma4:27b', { taskPassRate: 0.9, avgDurationMs: 25000 }),
        makeSummary('qwen2.5-coder:7b', { taskPassRate: 0.8, avgDurationMs: 9000 }),
        makeSummary('gemma4:e4b', { taskPassRate: 0.6, avgDurationMs: 7000 }),
      ],
      runs: [],
    }

    const recommendation = recommendLocalModel(report, {
      platform: 'darwin',
      arch: 'arm64',
      totalMemoryGb: 16,
      cpuCount: 10,
    })

    expect(recommendation.recommended.summary.variant.model).toBe('qwen2.5-coder:7b')
    expect(recommendation.recommended.fitsHardware).toBe(true)
    expect(recommendation.candidates[0].summary.variant.model).toBe('qwen2.5-coder:7b')
  })

  it('breaks ties on speed after reliability', () => {
    const report: LocalModelEvalReport = {
      generatedAt: '2026-04-03T00:00:00.000Z',
      cwd: '/tmp',
      variants: [
        makeSummary('gemma4:e4b', { taskPassRate: 0.6, avgDurationMs: 24000 }),
        makeSummary('llama3.1:8b', { taskPassRate: 0.6, avgDurationMs: 6000 }),
      ],
      runs: [],
    }

    const recommendation = recommendLocalModel(report, {
      platform: 'darwin',
      arch: 'arm64',
      totalMemoryGb: 24,
      cpuCount: 10,
    })

    expect(recommendation.recommended.summary.variant.model).toBe('llama3.1:8b')
  })

  it('falls back to the best overall model when none fit memory', () => {
    const report: LocalModelEvalReport = {
      generatedAt: '2026-04-03T00:00:00.000Z',
      cwd: '/tmp',
      variants: [
        makeSummary('gemma4:27b', { taskPassRate: 0.9, avgDurationMs: 25000 }),
        makeSummary('devstral:24b', { taskPassRate: 0.85, avgDurationMs: 21000 }),
      ],
      runs: [],
    }

    const recommendation = recommendLocalModel(report, {
      platform: 'darwin',
      arch: 'arm64',
      totalMemoryGb: 8,
      cpuCount: 8,
    })

    expect(recommendation.recommended.summary.variant.model).toBe('gemma4:27b')
    expect(recommendation.recommended.fitsHardware).toBe(false)
    expect(recommendation.fittingCandidates).toHaveLength(0)
  })
})

describe('eval report helpers', () => {
  const tmpDir = path.join(os.tmpdir(), `locode-recommend-test-${Date.now()}`)

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('loads a saved report and prints a recommendation', () => {
    const reportPath = path.join(tmpDir, 'report.json')
    const report: LocalModelEvalReport = {
      generatedAt: '2026-04-03T00:00:00.000Z',
      cwd: '/tmp',
      variants: [
        makeSummary('gemma4:e4b', { taskPassRate: 0.6, avgDurationMs: 24000 }),
        makeSummary('llama3.1:8b', { taskPassRate: 0.33, avgDurationMs: 6000 }),
      ],
      runs: [],
    }
    fs.writeFileSync(reportPath, JSON.stringify(report))

    expect(loadEvalReport(reportPath).variants).toHaveLength(2)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    runRecommendLocalModel({
      reportPath,
      hardware: { platform: 'darwin', arch: 'arm64', totalMemoryGb: 16, cpuCount: 8 },
      top: 2,
    })

    const printed = consoleSpy.mock.calls.flat().join('\n')
    expect(printed).toContain('Recommended local model')
    expect(printed).toContain('gemma4:e4b')
  })
})
