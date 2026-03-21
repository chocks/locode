import { EventEmitter } from 'events'
import { execFileSync } from 'child_process'
import type { AgentResult } from '../agents/local'
import type { ToolExecutor } from '../tools/executor'
import type { CodeEditor } from '../editor/code-editor'
import type { EditOperation } from '../editor/types'
import type {
  AgentConfig,
  AgentPhase,
  AgentRunResult,
  EditPlan,
  GatheredContext,
} from './types'
import type { StreamEvent } from './stream'
import type { Planner } from './planner'
import type { AgentMemory } from './memory'

interface LLMAgent {
  run(prompt: string, previousSummary?: string, repoContext?: string): Promise<AgentResult>
}

const MAX_ANALYZE_FILES = 5
const MAX_FILE_TOKENS = 2000 // approximate chars

export type ConfirmPlanFn = (plan: EditPlan) => Promise<boolean>

export class CodingAgent extends EventEmitter {
  private confirmPlan: ConfirmPlanFn | null = null

  constructor(
    private localAgent: LLMAgent,
    private claudeAgent: LLMAgent | null,
    private toolExecutor: ToolExecutor,
    private codeEditor: CodeEditor,
    private planner: Planner,
    private memory: AgentMemory,
    private config: AgentConfig,
  ) {
    super()
  }

  setConfirmPlan(fn: ConfirmPlanFn | null): void {
    this.confirmPlan = fn
  }

  async run(prompt: string): Promise<AgentRunResult> {
    let totalInput = 0
    let totalOutput = 0
    let agentUsed: 'local' | 'claude' = 'local'
    const initialOriginals = new Map<string, string>()
    let allEdits: EditOperation[] = []
    let allDiffs: string[] = []
    let currentPlan: EditPlan | null = null

    try {
      // === ANALYZE ===
      this.emitPhase('analyze', 'Gathering context')
      const context = await this.analyze(prompt)
      totalInput += context.tokensUsed.input
      totalOutput += context.tokensUsed.output

      // === Determine agent for PLAN+EXECUTE ===
      let planAgent: 'local' | 'claude' = 'local'

      for (let iteration = 1; iteration <= this.config.max_iterations; iteration++) {
        // === PLAN ===
        this.emitPhase('plan', `Iteration ${iteration}/${this.config.max_iterations}`)

        if (iteration === 1) {
          currentPlan = await this.planner.generatePlan(prompt, context.gathered, planAgent)
          // Auto-escalation: >2 files or >3 steps → Claude
          const uniqueFiles = new Set(currentPlan.steps.map(s => s.file))
          if ((uniqueFiles.size > 2 || currentPlan.steps.length > 3) && this.claudeAgent) {
            planAgent = 'claude'
            currentPlan = await this.planner.generatePlan(prompt, context.gathered, planAgent)
          }
        } else {
          const errors = this.collectErrors()
          currentPlan = await this.planner.refinePlan(currentPlan!, errors, planAgent)
        }

        agentUsed = planAgent
        this.emit('stream', { type: 'plan', plan: currentPlan } as StreamEvent)

        if (currentPlan.steps.length === 0) {
          break
        }

        // === CONFIRM ===
        if (!this.config.auto_confirm && this.confirmPlan) {
          const confirmed = await this.confirmPlan(currentPlan)
          if (!confirmed) {
            const result = this.buildResult(false, [], [], null, iteration, totalInput, totalOutput, agentUsed)
            this.emit('stream', { type: 'done', result } as StreamEvent)
            return result
          }
        }

        // === EXECUTE ===
        this.emitPhase('execute', `Applying ${currentPlan.steps.length} edits`)
        const edits = await this.executeSteps(currentPlan, planAgent, context.gathered)
        totalInput += edits.tokensUsed.input
        totalOutput += edits.tokensUsed.output

        const applyResult = await this.codeEditor.applyEdits(edits.operations)

        // Store initial originals (only from first iteration)
        if (iteration === 1) {
          for (const [filePath, content] of applyResult.originals) {
            if (!initialOriginals.has(filePath)) {
              initialOriginals.set(filePath, content)
            }
          }
        }

        if (applyResult.failed.length > 0) {
          // Rollback this iteration's edits
          this.emitPhase('execute', 'Edit failed, rolling back')
          await this.codeEditor.rollback(applyResult)
          const errorMsg = applyResult.failed.map(f => f.error).join('; ')
          this.emit('stream', { type: 'error', message: errorMsg } as StreamEvent)
          this.memory.record({ type: 'error', detail: errorMsg })

          if (iteration === this.config.max_iterations) {
            await this.rollbackAll(initialOriginals)
            return this.buildResult(false, [], [], null, iteration, totalInput, totalOutput, agentUsed)
          }
          continue
        }

        allEdits = [...allEdits, ...applyResult.applied]
        const previews = await this.codeEditor.preview(applyResult.applied)
        allDiffs = previews.map(p => p.diff)
        for (const p of previews) {
          this.emit('stream', { type: 'diff', file: p.file, diff: p.diff } as StreamEvent)
        }

        // === VALIDATE ===
        if (this.config.run_validation && this.config.validation_command) {
          this.emitPhase('validate', `Running: ${this.config.validation_command}`)
          const validation = this.validate(this.config.validation_command)
          this.emit('stream', { type: 'validation', passed: validation.passed, output: validation.output } as StreamEvent)

          if (!validation.passed) {
            this.memory.record({ type: 'error', detail: validation.output })
            if (iteration === this.config.max_iterations) {
              await this.rollbackAll(initialOriginals)
              return this.buildResult(false, allEdits, allDiffs, false, iteration, totalInput, totalOutput, agentUsed)
            }
            continue
          }
        }

        // === PRESENT ===
        this.emitPhase('present', 'Done')
        const result = this.buildResult(true, allEdits, allDiffs, true, iteration, totalInput, totalOutput, agentUsed)
        this.emit('stream', { type: 'done', result } as StreamEvent)
        return result
      }

      // Fell through all iterations
      const result = this.buildResult(allEdits.length > 0, allEdits, allDiffs, null, this.config.max_iterations, totalInput, totalOutput, agentUsed)
      this.emit('stream', { type: 'done', result } as StreamEvent)
      return result
    } catch (err) {
      await this.rollbackAll(initialOriginals)
      this.emit('stream', { type: 'error', message: (err as Error).message } as StreamEvent)
      throw err
    }
  }

  private async analyze(prompt: string): Promise<{
    gathered: GatheredContext
    tokensUsed: { input: number; output: number }
  }> {
    const files: GatheredContext['files'] = []
    const searchResults: GatheredContext['searchResults'] = []

    // Pre-read any files explicitly mentioned in the prompt
    const mentionedFiles = this.extractMentionedFiles(prompt)
    for (const filePath of mentionedFiles) {
      try {
        const readResult = await this.toolExecutor.execute({ tool: 'read_file', args: { path: filePath } })
        if (readResult.success) {
          const truncated = readResult.output.slice(0, MAX_FILE_TOKENS * 4)
          files.push({ path: filePath, content: truncated, relevance: 'mentioned in prompt' })
          this.memory.record({ type: 'file_read', detail: filePath })
          this.emit('stream', { type: 'tool_call', tool: 'read_file', args: { path: filePath } } as StreamEvent)
        }
      } catch {
        // File doesn't exist — that's fine
      }
    }

    // Use local agent to gather additional context via tools
    const toolList = this.toolExecutor.registry.describeForPrompt()
    const memoryContext = this.memory.toPromptContext()
    const knownFiles = this.memory.getRecentFiles()
    const skipNote = knownFiles.length > 0
      ? `\nAlready read (skip these): ${knownFiles.join(', ')}`
      : ''

    const analyzePrompt = `You have these tools:\n${toolList}\n\n${memoryContext}${skipNote}\n\nWhat additional files should I read or search to handle this request?\nRequest: ${prompt}\n\nUse tools to gather context. Limit to ${MAX_ANALYZE_FILES} files max. If you already have enough context, just respond with your analysis.`

    const result = await this.localAgent.run(analyzePrompt)

    // Extract file/search info from tool calls that the agent executed
    if (result.toolCalls) {
      for (const call of result.toolCalls) {
        this.emit('stream', { type: 'tool_call', tool: call.tool, args: call.args } as StreamEvent)

        if (call.tool === 'read_file' && call.result?.success) {
          const filePath = call.args.path as string
          if (!files.some(f => f.path === filePath)) {
            const truncated = (call.result.output ?? '').slice(0, MAX_FILE_TOKENS * 4)
            files.push({ path: filePath, content: truncated, relevance: 'analyzed' })
            this.memory.record({ type: 'file_read', detail: filePath })
          }
        } else if (call.tool === 'search_code' && call.result?.success) {
          try {
            const results = JSON.parse(call.result.output ?? '[]')
            searchResults.push(...results)
            this.memory.record({ type: 'search', detail: call.args.pattern as string })
          } catch {
            // Non-JSON search output
          }
        }
      }
    }

    return {
      gathered: {
        files,
        searchResults,
        memory: this.memory.getSnapshot(),
      },
      tokensUsed: { input: result.inputTokens, output: result.outputTokens },
    }
  }

  private extractMentionedFiles(prompt: string): string[] {
    const files: string[] = []
    const pattern = /\b([\w./-]+\.(?:ts|js|tsx|jsx|py|rs|go|java|json|yaml|yml|md|css|html|sh))\b/g
    let match
    while ((match = pattern.exec(prompt)) !== null) {
      const candidate = match[1]
      files.push(candidate)
      // Also try with src/ prefix for bare filenames
      if (!candidate.startsWith('src/') && !candidate.startsWith('/')) {
        files.push(`src/${candidate}`)
      }
    }
    return [...new Set(files)]
  }

  private async executeSteps(plan: EditPlan, agent: 'local' | 'claude', context: GatheredContext): Promise<{
    operations: EditOperation[]
    tokensUsed: { input: number; output: number }
  }> {
    const llm = agent === 'claude' && this.claudeAgent ? this.claudeAgent : this.localAgent
    const operations: EditOperation[] = []
    let totalInput = 0
    let totalOutput = 0

    for (const step of plan.steps) {
      // Include file content so the LLM can generate accurate search strings
      const fileContent = context.files.find(f => f.path === step.file)?.content
      const fileSection = fileContent
        ? `\nCURRENT FILE CONTENT of ${step.file}:\n\`\`\`\n${fileContent}\n\`\`\`\n`
        : ''

      const stepPrompt = `Generate a JSON edit operation for this step:

Step: ${step.description}
File: ${step.file}
Operation: ${step.operation}
${step.search ? `Target: ${step.search}` : ''}
Reasoning: ${step.reasoning}
${fileSection}
IMPORTANT rules for each operation type:
- "insert": "search" = exact line to insert AFTER. "content" = ONLY the new line(s) to add. Do NOT include existing file content.
- "replace": "search" = exact text to replace. "content" = the replacement text (same scope as search).
- "delete": "search" = exact text to remove. "content" is not needed.
- "create": creates a new file. "content" = full file content. "search" is not needed.

"search" must be an EXACT substring from the file. It must match uniquely (appear only once).
"content" must NEVER contain the entire file — only the new or changed lines.

Respond with ONLY a JSON object:
{ "file": "...", "operation": "...", "search": "...", "content": "..." }`

      const result = await llm.run(stepPrompt)
      totalInput += result.inputTokens
      totalOutput += result.outputTokens

      try {
        const op = this.parseEditOperation(result.content, step.file)
        operations.push(op)
      } catch {
        operations.push({
          file: step.file,
          operation: step.operation,
          search: step.search,
          content: '',
        })
      }
    }

    return { operations, tokensUsed: { input: totalInput, output: totalOutput } }
  }

  private parseEditOperation(response: string, fallbackFile: string): EditOperation {
    // Try direct JSON parse
    try {
      const op = JSON.parse(response)
      return { file: op.file ?? fallbackFile, operation: op.operation, search: op.search, content: op.content }
    } catch {
      // Fall through
    }

    // Try extracting from code block
    const match = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (match) {
      const op = JSON.parse(match[1])
      return { file: op.file ?? fallbackFile, operation: op.operation, search: op.search, content: op.content }
    }

    // Try finding JSON object
    const braceMatch = response.match(/\{[\s\S]*"operation"[\s\S]*\}/)
    if (braceMatch) {
      const op = JSON.parse(braceMatch[0])
      return { file: op.file ?? fallbackFile, operation: op.operation, search: op.search, content: op.content }
    }

    throw new Error('Failed to parse edit operation from LLM response')
  }

  private validate(command: string): { passed: boolean; output: string } {
    const parts = command.trim().split(/\s+/)
    try {
      const output = execFileSync(parts[0], parts.slice(1), {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      })
      return { passed: true, output }
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string }
      return { passed: false, output: error.stderr || error.stdout || error.message || 'Validation failed' }
    }
  }

  private collectErrors(): string[] {
    const snapshot = this.memory.getSnapshot()
    return snapshot.recentErrors
  }

  private async rollbackAll(originals: Map<string, string>): Promise<void> {
    if (originals.size === 0) return
    await this.codeEditor.rollback({ applied: [], failed: [], originals })
  }

  private buildResult(
    success: boolean,
    edits: EditOperation[],
    diffs: string[],
    validationPassed: boolean | null,
    iterations: number,
    inputTokens: number,
    outputTokens: number,
    agent: 'local' | 'claude',
  ): AgentRunResult {
    return {
      success,
      edits,
      diffs,
      validationPassed,
      iterations,
      tokensUsed: { input: inputTokens, output: outputTokens },
      agent,
    }
  }

  private emitPhase(phase: AgentPhase, detail: string): void {
    this.emit('stream', { type: 'phase', phase, detail } as StreamEvent)
  }
}
