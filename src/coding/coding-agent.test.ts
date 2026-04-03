import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodingAgent } from './coding-agent'
import type { AgentConfig, EditPlan } from './types'
import { AgentMemory } from './memory'
import type { PerformanceConfig } from '../config/schema'
import { PersistentContextCache } from '../runtime/persistent-context-cache'

// Mock dependencies
const mockLocalAgent = {
  run: vi.fn(),
}

const mockClaudeAgent = {
  run: vi.fn(),
}

const mockToolExecutor = {
  execute: vi.fn(),
  executeParallel: vi.fn(),
  registry: {
    describeForPrompt: vi.fn().mockReturnValue('read_file(path)\nsearch_code(pattern)'),
    listForLLM: vi.fn().mockReturnValue([]),
  },
}

const mockCodeEditor = {
  applyEdits: vi.fn(),
  rollback: vi.fn(),
  preview: vi.fn(),
}

const mockPlanner = {
  generatePlan: vi.fn(),
  refinePlan: vi.fn(),
}

const defaultConfig: AgentConfig = {
  max_iterations: 3,
  auto_confirm: true,
  show_plan: false,
  run_validation: false,
}

const defaultPerformance: PerformanceConfig = {
  parallel_reads: 4,
  warm_index_on_startup: true,
  cache_context: true,
  cache_dir: '.locode/context-cache',
  cache_max_entries: 200,
  cache_max_bytes: 5 * 1024 * 1024,
  max_prompt_chars: 24000,
  lazy_semantic_search: true,
}

 
function createAgent(config = defaultConfig, performance = defaultPerformance, persistentCache?: PersistentContextCache | null): CodingAgent {
  return new CodingAgent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockLocalAgent as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockClaudeAgent as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockToolExecutor as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockCodeEditor as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockPlanner as any,
    new AgentMemory(),
    config,
    performance,
    persistentCache ?? null,
  )
}

describe('CodingAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes a simple single-file edit using local agent', async () => {
    const agent = createAgent()

    // ANALYZE: local agent returns tool calls with results
    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'I read src/a.ts',
      summary: '',
      inputTokens: 50,
      outputTokens: 30,
      toolCalls: [{
        tool: 'read_file',
        args: { path: 'src/a.ts' },
        result: { success: true, output: 'export const x = 1\n' },
      }],
    })

    // PLAN: planner returns a simple plan
    const plan: EditPlan = {
      description: 'Update constant',
      steps: [{
        description: 'Change x to 2',
        file: 'src/a.ts',
        operation: 'replace',
        search: 'const x = 1',
        reasoning: 'Update value',
      }],
      estimatedFiles: ['src/a.ts'],
    }
    mockPlanner.generatePlan.mockResolvedValue(plan)

    // EXECUTE: local agent generates EditOperation
    mockLocalAgent.run.mockResolvedValueOnce({
      content: JSON.stringify({
        file: 'src/a.ts',
        operation: 'replace',
        search: 'const x = 1',
        content: 'const x = 2',
      }),
      summary: '',
      inputTokens: 80,
      outputTokens: 40,
    })

    // CodeEditor applies successfully
    mockCodeEditor.applyEdits.mockResolvedValue({
      applied: [{ file: 'src/a.ts', operation: 'replace', search: 'const x = 1', content: 'const x = 2' }],
      failed: [],
      originals: new Map([['src/a.ts', 'export const x = 1\n']]),
    })

    mockCodeEditor.preview.mockResolvedValue([{
      file: 'src/a.ts',
      diff: '-const x = 1\n+const x = 2',
      additions: 1,
      deletions: 1,
    }])

    const result = await agent.run('Change x to 2 in src/a.ts')
    expect(result.success).toBe(true)
    expect(result.edits).toHaveLength(1)
    expect(result.agent).toBe('local')
    expect(result.iterations).toBe(1)
  })

  it('auto-escalates to Claude when plan has >3 steps', async () => {
    const agent = createAgent()

    // ANALYZE phase
    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'Reading files',
      summary: '',
      inputTokens: 50,
      outputTokens: 30,
    })

    // PLAN: planner returns a large plan (>3 steps)
    const plan: EditPlan = {
      description: 'Big refactor',
      steps: [
        { description: 's1', file: 'a.ts', operation: 'replace', reasoning: '' },
        { description: 's2', file: 'b.ts', operation: 'replace', reasoning: '' },
        { description: 's3', file: 'c.ts', operation: 'insert', reasoning: '' },
        { description: 's4', file: 'd.ts', operation: 'create', reasoning: '' },
      ],
      estimatedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
    }
    mockPlanner.generatePlan.mockResolvedValue(plan)

    // EXECUTE: Claude generates EditOperations
    for (let i = 0; i < 4; i++) {
      mockClaudeAgent.run.mockResolvedValueOnce({
        content: JSON.stringify({
          file: plan.steps[i].file,
          operation: plan.steps[i].operation,
          search: 'x',
          content: 'y',
        }),
        summary: '',
        inputTokens: 100,
        outputTokens: 50,
      })
    }

    mockCodeEditor.applyEdits.mockResolvedValue({
      applied: plan.steps.map(s => ({ file: s.file, operation: s.operation })),
      failed: [],
      originals: new Map(),
    })

    mockCodeEditor.preview.mockResolvedValue([])

    const result = await agent.run('Refactor everything')
    expect(result.agent).toBe('claude')
  })

  it('rolls back on execute failure and retries with refined plan', async () => {
    const agent = createAgent()

    // ANALYZE
    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'ok', summary: '', inputTokens: 30, outputTokens: 20,
    })

    // PLAN (iteration 1)
    const plan1: EditPlan = {
      description: 'Fix bug',
      steps: [{ description: 'Fix', file: 'a.ts', operation: 'replace', search: 'bad', reasoning: '' }],
      estimatedFiles: ['a.ts'],
    }
    mockPlanner.generatePlan.mockResolvedValueOnce(plan1)

    // EXECUTE (iteration 1): LLM generates op
    mockLocalAgent.run.mockResolvedValueOnce({
      content: JSON.stringify({ file: 'a.ts', operation: 'replace', search: 'bad', content: 'good' }),
      summary: '', inputTokens: 50, outputTokens: 30,
    })

    // applyEdits fails
    mockCodeEditor.applyEdits.mockResolvedValueOnce({
      applied: [],
      failed: [{ edit: { file: 'a.ts', operation: 'replace' as const, search: 'bad', content: 'good' }, error: 'Search string not found' }],
      originals: new Map<string, string>(),
    })

    // PLAN (iteration 2 — refinePlan)
    const plan2: EditPlan = {
      description: 'Fix bug (refined)',
      steps: [{ description: 'Fix with correct search', file: 'a.ts', operation: 'replace', search: 'wrong', reasoning: '' }],
      estimatedFiles: ['a.ts'],
    }
    mockPlanner.refinePlan.mockResolvedValueOnce(plan2)

    // EXECUTE (iteration 2)
    mockLocalAgent.run.mockResolvedValueOnce({
      content: JSON.stringify({ file: 'a.ts', operation: 'replace', search: 'wrong', content: 'right' }),
      summary: '', inputTokens: 50, outputTokens: 30,
    })

    mockCodeEditor.applyEdits.mockResolvedValueOnce({
      applied: [{ file: 'a.ts', operation: 'replace', search: 'wrong', content: 'right' }],
      failed: [],
      originals: new Map([['a.ts', 'original']]),
    })

    mockCodeEditor.preview.mockResolvedValue([{
      file: 'a.ts',
      diff: '-wrong\n+right',
      additions: 1,
      deletions: 1,
    }])

    const result = await agent.run('Fix the bug')
    expect(result.success).toBe(true)
    expect(result.iterations).toBe(2)
    expect(mockPlanner.refinePlan).toHaveBeenCalled()
    expect(mockCodeEditor.rollback).toHaveBeenCalled()
  })

  it('generates previews before applying edits so diffs reflect original content', async () => {
    const agent = createAgent()

    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'ok', summary: '', inputTokens: 30, outputTokens: 20,
    })

    mockPlanner.generatePlan.mockResolvedValue({
      description: 'Update file',
      steps: [{ description: 'Fix', file: 'a.ts', operation: 'replace', search: 'bad', reasoning: '' }],
      estimatedFiles: ['a.ts'],
    })

    mockLocalAgent.run.mockResolvedValueOnce({
      content: JSON.stringify({ file: 'a.ts', operation: 'replace', search: 'bad', content: 'good' }),
      summary: '', inputTokens: 50, outputTokens: 30,
    })

    mockCodeEditor.preview.mockResolvedValue([{
      file: 'a.ts',
      diff: '-bad\n+good',
      additions: 1,
      deletions: 1,
    }])
    mockCodeEditor.applyEdits.mockResolvedValue({
      applied: [{ file: 'a.ts', operation: 'replace', search: 'bad', content: 'good' }],
      failed: [],
      originals: new Map([['a.ts', 'bad']]),
    })

    await agent.run('Fix a.ts')

    expect(mockCodeEditor.preview.mock.invocationCallOrder[0]).toBeLessThan(
      mockCodeEditor.applyEdits.mock.invocationCallOrder[0]
    )
  })

  it('emits stream events during execution', async () => {
    const agent = createAgent()
    const events: string[] = []
    agent.on('stream', (event) => events.push(event.type))

    // Minimal successful run
    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'ok', summary: '', inputTokens: 30, outputTokens: 20,
    })

    mockPlanner.generatePlan.mockResolvedValue({
      description: 'Test',
      steps: [],
      estimatedFiles: [],
    })

    mockCodeEditor.applyEdits.mockResolvedValue({ applied: [], failed: [], originals: new Map() })
    mockCodeEditor.preview.mockResolvedValue([])

    await agent.run('test')
    expect(events).toContain('phase')
    expect(events).toContain('done')
  })

  it('reuses cached analyze context for repeated prompts when cache_context is enabled', async () => {
    const agent = createAgent()

    mockLocalAgent.run
      .mockResolvedValueOnce({
        content: 'analysis',
        summary: '',
        inputTokens: 30,
        outputTokens: 20,
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ file: 'a.ts', operation: 'create', content: 'x' }),
        summary: '',
        inputTokens: 20,
        outputTokens: 10,
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ file: 'a.ts', operation: 'create', content: 'x' }),
        summary: '',
        inputTokens: 20,
        outputTokens: 10,
      })

    mockPlanner.generatePlan.mockResolvedValue({
      description: 'Create file',
      steps: [{ description: 'Create file', file: 'a.ts', operation: 'create', reasoning: '' }],
      estimatedFiles: ['a.ts'],
    })

    mockCodeEditor.preview.mockResolvedValue([])
    mockCodeEditor.applyEdits.mockResolvedValue({
      applied: [{ file: 'a.ts', operation: 'create', content: 'x' }],
      failed: [],
      originals: new Map([['a.ts', null]]),
    })

    await agent.run('Create a.ts')
    await agent.run('Create a.ts')

    expect(mockLocalAgent.run).toHaveBeenCalledTimes(3)
  })

  it('enforces a total prompt budget across gathered file context', async () => {
    const agent = createAgent(defaultConfig, {
      ...defaultPerformance,
      max_prompt_chars: 12,
      cache_context: false,
    })

    mockToolExecutor.executeParallel.mockResolvedValue([
      { success: true, output: 'abcdefghij' },
      { success: true, output: 'klmnopqrst' },
    ])

    mockLocalAgent.run.mockResolvedValueOnce({
      content: 'No extra context needed',
      summary: '',
      inputTokens: 20,
      outputTokens: 10,
    })

    mockPlanner.generatePlan.mockResolvedValue({
      description: 'No-op',
      steps: [],
      estimatedFiles: [],
    })

    const result = await agent.run('Update src/a.ts and src/b.ts')
    const gatheredContext = mockPlanner.generatePlan.mock.calls[0][1]
    const totalChars = gatheredContext.files.reduce((sum: number, file: { content: string }) => sum + file.content.length, 0)

    expect(result.promptBudget).toEqual(expect.objectContaining({
      maxChars: 12,
      usedChars: 12,
      remainingChars: 0,
    }))
    expect(totalChars).toBeLessThanOrEqual(12)
    expect(gatheredContext.files).toEqual([
      expect.objectContaining({ path: 'src/a.ts', content: 'abcdefghij' }),
      expect.objectContaining({ path: 'src/b.ts', content: 'kl' }),
    ])
  })
})
