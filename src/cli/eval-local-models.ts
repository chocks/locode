import fs from 'fs'
import path from 'path'
import { LocalAgent, type AgentResult, type ToolCallRecord } from '../agents/local'
import type { Config } from '../config/schema'
import { ToolExecutor } from '../tools/executor'
import { ToolRegistry } from '../tools/registry'
import { SafetyGate } from '../tools/safety-gate'
import { readFileDefinition } from '../tools/definitions/read-file'
import { runCommandDefinition } from '../tools/definitions/run-command'
import { gitQueryDefinition } from '../tools/definitions/git-query'
import { listFilesDefinition } from '../tools/definitions/list-files'
import { searchCodeDefinition } from '../tools/definitions/search-code'

export interface EvalVariant {
  label: string
  model: string
  thinking: boolean
  numCtx?: number
}

interface EvalTaskDefinition {
  id: string
  prompt: string
  requiredAnyTools: string[]
  contentChecks: RegExp[]
  maxRepeatedFailedCallStreak?: number
}

export interface TaskAssessment {
  passed: boolean
  usedTools: string[]
  invalidTools: string[]
  failedCalls: number
  repeatedFailedCallStreak: number
  notes: string[]
}

export interface TaskRunResult {
  taskId: string
  prompt: string
  durationMs: number
  content: string
  summary: string
  inputTokens: number
  outputTokens: number
  toolCalls: ToolCallRecord[]
  assessment: TaskAssessment
}

export interface VariantRunResult {
  variant: EvalVariant
  runNumber: number
  startedAt: string
  taskRuns: TaskRunResult[]
}

export interface VariantSummary {
  variant: EvalVariant
  runs: number
  tasksPerRun: number
  taskPassRate: number
  fullRunPassRate: number
  avgDurationMs: number
  avgInputTokens: number
  avgOutputTokens: number
  invalidToolCallRate: number
  repeatedFailureRate: number
}

export interface LocalModelEvalReport {
  generatedAt: string
  cwd: string
  variants: VariantSummary[]
  runs: VariantRunResult[]
}

export interface LocalModelEvalOptions {
  variantSpecs?: string[]
  runs: number
  output: string
  taskIds?: string[]
  verbose?: boolean
}

const DEFAULT_OUTPUT = '.locode/evals/local-model-eval.json'

const DEFAULT_VARIANTS: EvalVariant[] = [
  { label: 'llama3.1-baseline', model: 'llama3.1:8b', thinking: false, numCtx: 8192 },
  { label: 'gemma4-candidate', model: 'gemma4:9b', thinking: false, numCtx: 8192 },
]

const EVAL_TASKS: EvalTaskDefinition[] = [
  {
    id: 'read-package-scripts',
    prompt: 'Read package.json and summarize the build and test npm scripts in one sentence.',
    requiredAnyTools: ['read_file', 'run_command'],
    contentChecks: [/\bbuild\b/i, /\btest\b/i],
  },
  {
    id: 'find-execute-parallel',
    prompt: 'Search the codebase for ToolExecutor and tell me which file defines executeParallel.',
    requiredAnyTools: ['search_code', 'read_file', 'run_command'],
    contentChecks: [/src\/tools\/executor\.ts/i, /executeParallel/],
  },
  {
    id: 'git-track-setup',
    prompt: 'Use git to check whether src/cli/setup.ts is tracked, and answer yes or no in one sentence.',
    requiredAnyTools: ['git_query'],
    contentChecks: [/src\/cli\/setup\.ts/i, /\b(yes|tracked|ls-files)\b/i],
  },
  {
    id: 'blocked-command-recovery',
    prompt: 'Try the command "tree" to inspect the repository root. If it fails or is blocked, recover with an allowed alternative and summarize the top-level directories.',
    requiredAnyTools: ['run_command', 'list_files'],
    contentChecks: [/\bsrc\b/i, /\bdocs\b/i],
    maxRepeatedFailedCallStreak: 1,
  },
  {
    id: 'find-local-fallback-threshold',
    prompt: 'Find where Claude local fallback is triggered and name the config field that controls the threshold. Include the file path in your answer.',
    requiredAnyTools: ['search_code', 'read_file', 'run_command'],
    contentChecks: [/src\/orchestrator\/orchestrator\.ts/i, /\btoken_threshold\b/i],
  },
]

export function getDefaultEvalOutputPath(): string {
  return DEFAULT_OUTPUT
}

export function getDefaultEvalVariants(): EvalVariant[] {
  return DEFAULT_VARIANTS.map(variant => ({ ...variant }))
}

export function parseVariantSpec(spec: string): EvalVariant {
  const trimmed = spec.trim()
  if (!trimmed) {
    throw new Error('variant spec cannot be empty')
  }

  if (!trimmed.includes('=')) {
    return {
      label: trimmed.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase(),
      model: trimmed,
      thinking: false,
    }
  }

  const parsed: Partial<EvalVariant> = {}
  for (const segment of trimmed.split(',')) {
    const [rawKey, ...rest] = segment.split('=')
    const key = rawKey.trim()
    const value = rest.join('=').trim()
    if (!key || !value) {
      throw new Error(`invalid variant segment: "${segment}"`)
    }

    switch (key) {
      case 'label':
        parsed.label = value
        break
      case 'model':
        parsed.model = value
        break
      case 'thinking':
        parsed.thinking = value === 'true'
        break
      case 'num_ctx': {
        const parsedCtx = Number.parseInt(value, 10)
        if (!Number.isFinite(parsedCtx) || parsedCtx <= 0) {
          throw new Error(`invalid num_ctx value: "${value}"`)
        }
        parsed.numCtx = parsedCtx
        break
      }
      default:
        throw new Error(`unknown variant key: "${key}"`)
    }
  }

  if (!parsed.model) {
    throw new Error(`variant spec must include model=...: "${spec}"`)
  }

  const label = parsed.label
    ?? parsed.model.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()

  return {
    label,
    model: parsed.model,
    thinking: parsed.thinking ?? false,
    numCtx: parsed.numCtx,
  }
}

export function resolveEvalVariants(specs?: string[]): EvalVariant[] {
  if (!specs || specs.length === 0) {
    return getDefaultEvalVariants()
  }
  return specs.map(parseVariantSpec)
}

function createEvalRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(readFileDefinition)
  registry.register(runCommandDefinition)
  registry.register(gitQueryDefinition)
  registry.register(listFilesDefinition)
  registry.register(searchCodeDefinition)
  return registry
}

function createEvalExecutor(): ToolExecutor {
  const registry = createEvalRegistry()
  const safetyGate = new SafetyGate({
    always_confirm: [],
    auto_approve: registry.list().map(tool => tool.name),
    allowed_write_paths: ['.'],
  })
  return new ToolExecutor(registry, safetyGate)
}

function getEvalTasks(taskIds?: string[]): EvalTaskDefinition[] {
  if (!taskIds || taskIds.length === 0) {
    return EVAL_TASKS
  }

  const selected = taskIds.map(taskId => {
    const task = EVAL_TASKS.find(candidate => candidate.id === taskId)
    if (!task) {
      throw new Error(`unknown eval task: "${taskId}"`)
    }
    return task
  })

  return selected
}

function getRepeatedFailedCallStreak(toolCalls: ToolCallRecord[]): number {
  let currentStreak = 0
  let maxStreak = 0
  let lastFailedKey = ''

  for (const call of toolCalls) {
    if (call.result?.success) {
      currentStreak = 0
      lastFailedKey = ''
      continue
    }

    const key = `${call.tool}:${JSON.stringify(call.args)}`
    if (key === lastFailedKey) {
      currentStreak++
    } else {
      currentStreak = 1
      lastFailedKey = key
    }
    maxStreak = Math.max(maxStreak, currentStreak)
  }

  return maxStreak
}

export function assessTaskRun(task: EvalTaskDefinition, result: AgentResult, registry: ToolRegistry): TaskAssessment {
  const toolCalls = result.toolCalls ?? []
  const usedTools = [...new Set(toolCalls.map(call => call.tool))]
  const invalidTools = usedTools.filter(tool => !registry.get(tool))
  const failedCalls = toolCalls.filter(call => !call.result?.success).length
  const repeatedFailedCallStreak = getRepeatedFailedCallStreak(toolCalls)
  const notes: string[] = []

  const requiredToolSatisfied = task.requiredAnyTools.some(tool => usedTools.includes(tool))
  if (!requiredToolSatisfied) {
    notes.push(`expected one of tools: ${task.requiredAnyTools.join(', ')}`)
  }

  for (const regex of task.contentChecks) {
    if (!regex.test(result.content)) {
      notes.push(`response did not match ${regex}`)
    }
  }

  if (invalidTools.length > 0) {
    notes.push(`invalid tools used: ${invalidTools.join(', ')}`)
  }

  const allowedRepeatedFailure = task.maxRepeatedFailedCallStreak ?? 1
  if (repeatedFailedCallStreak > allowedRepeatedFailure) {
    notes.push(`repeated failure streak ${repeatedFailedCallStreak} exceeded limit ${allowedRepeatedFailure}`)
  }

  if (!result.content.trim()) {
    notes.push('final response was empty')
  }

  return {
    passed: notes.length === 0,
    usedTools,
    invalidTools,
    failedCalls,
    repeatedFailedCallStreak,
    notes,
  }
}

async function runVariant(
  config: Config,
  variant: EvalVariant,
  runNumber: number,
  tasks: EvalTaskDefinition[],
  verbose?: boolean,
): Promise<VariantRunResult> {
  const toolExecutor = createEvalExecutor()
  const registry = toolExecutor.registry
  const localAgent = new LocalAgent({
    ...config,
    local_llm: {
      ...config.local_llm,
      model: variant.model,
      thinking: variant.thinking,
      options: {
        ...config.local_llm.options,
        ...(variant.numCtx ? { num_ctx: variant.numCtx } : {}),
      },
    },
  }, toolExecutor, { verbose })

  const taskRuns: TaskRunResult[] = []
  for (const task of tasks) {
    const start = Date.now()
    const result = await localAgent.run(task.prompt)
    const durationMs = Date.now() - start
    taskRuns.push({
      taskId: task.id,
      prompt: task.prompt,
      durationMs,
      content: result.content,
      summary: result.summary,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      toolCalls: result.toolCalls ?? [],
      assessment: assessTaskRun(task, result, registry),
    })
  }

  return {
    variant,
    runNumber,
    startedAt: new Date().toISOString(),
    taskRuns,
  }
}

function summarizeVariantRuns(variant: EvalVariant, runs: VariantRunResult[]): VariantSummary {
  const taskRuns = runs.flatMap(run => run.taskRuns)
  const passedTasks = taskRuns.filter(run => run.assessment.passed).length
  const fullRunPasses = runs.filter(run => run.taskRuns.every(taskRun => taskRun.assessment.passed)).length
  const invalidToolRuns = taskRuns.filter(run => run.assessment.invalidTools.length > 0).length
  const repeatedFailureRuns = taskRuns.filter(run => run.assessment.repeatedFailedCallStreak > 1).length

  const totalDurationMs = taskRuns.reduce((sum, run) => sum + run.durationMs, 0)
  const totalInputTokens = taskRuns.reduce((sum, run) => sum + run.inputTokens, 0)
  const totalOutputTokens = taskRuns.reduce((sum, run) => sum + run.outputTokens, 0)

  return {
    variant,
    runs: runs.length,
    tasksPerRun: runs[0]?.taskRuns.length ?? 0,
    taskPassRate: taskRuns.length === 0 ? 0 : passedTasks / taskRuns.length,
    fullRunPassRate: runs.length === 0 ? 0 : fullRunPasses / runs.length,
    avgDurationMs: taskRuns.length === 0 ? 0 : totalDurationMs / taskRuns.length,
    avgInputTokens: taskRuns.length === 0 ? 0 : totalInputTokens / taskRuns.length,
    avgOutputTokens: taskRuns.length === 0 ? 0 : totalOutputTokens / taskRuns.length,
    invalidToolCallRate: taskRuns.length === 0 ? 0 : invalidToolRuns / taskRuns.length,
    repeatedFailureRate: taskRuns.length === 0 ? 0 : repeatedFailureRuns / taskRuns.length,
  }
}

function printSummary(report: LocalModelEvalReport): void {
  console.log('\nLocal Model Tool-Calling Eval\n')
  for (const summary of report.variants) {
    console.log(`${summary.variant.label} (${summary.variant.model})`)
    console.log(`  task pass rate      ${(summary.taskPassRate * 100).toFixed(1)}%`)
    console.log(`  full run pass rate  ${(summary.fullRunPassRate * 100).toFixed(1)}%`)
    console.log(`  avg duration        ${Math.round(summary.avgDurationMs)}ms`)
    console.log(`  avg tokens          in ${Math.round(summary.avgInputTokens)} / out ${Math.round(summary.avgOutputTokens)}`)
    console.log(`  invalid tool rate   ${(summary.invalidToolCallRate * 100).toFixed(1)}%`)
    console.log(`  repeat failure rate ${(summary.repeatedFailureRate * 100).toFixed(1)}%\n`)
  }
}

export async function runLocalModelEval(config: Config, options: LocalModelEvalOptions): Promise<LocalModelEvalReport> {
  const variants = resolveEvalVariants(options.variantSpecs)
  const tasks = getEvalTasks(options.taskIds)
  const runs: VariantRunResult[] = []

  for (const variant of variants) {
    for (let runNumber = 1; runNumber <= options.runs; runNumber++) {
      process.stdout.write(`Running ${variant.label} (${variant.model}) [run ${runNumber}/${options.runs}] ...`)
      const result = await runVariant(config, variant, runNumber, tasks, options.verbose)
      runs.push(result)
      const passed = result.taskRuns.filter(taskRun => taskRun.assessment.passed).length
      console.log(` ${passed}/${result.taskRuns.length} tasks passed`)
    }
  }

  const report: LocalModelEvalReport = {
    generatedAt: new Date().toISOString(),
    cwd: process.cwd(),
    variants: variants.map(variant => summarizeVariantRuns(
      variant,
      runs.filter(run => run.variant.label === variant.label),
    )),
    runs,
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true })
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2))
  printSummary(report)
  console.log(`Detailed report saved to: ${options.output}`)

  return report
}
