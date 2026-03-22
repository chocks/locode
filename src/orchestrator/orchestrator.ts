import { Router, AgentType, RouteDecision } from './router'
import { LocalAgent, AgentResult } from '../agents/local'
import { ClaudeAgent, ClaudeAgentResult } from '../agents/claude'
import { TokenTracker } from '../tracker/tracker'
import { DEFAULT_RUNTIME_CONFIG, type Config } from '../config/schema'
import { injectFileContext } from './file-context-injector'
import { loadRepoContext } from './repo-context-loader'
import { McpManager } from '../mcp/client'
import { ToolExecutor } from '../tools/executor'
import { SafetyGate } from '../tools/safety-gate'
import { createDefaultRegistry } from '../tools/definitions/default-registry'
import { CodingAgent } from '../coding/coding-agent'
import { Planner } from '../coding/planner'
import { AgentMemory } from '../coding/memory'
import { CodeEditor } from '../editor/code-editor'
import { TaskClassifier, type TaskIntent } from './task-classifier'
import { RunArtifactStore } from '../runtime/run-artifact-store'
import type { ApprovalHandler } from '../tools/executor'
import { PersistentContextCache } from '../runtime/persistent-context-cache'

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && 'status' in err && (err as { status: number }).status === 429
}

export interface OrchestratorResult extends AgentResult {
  agent: AgentType
  routeMethod: 'rule' | 'llm'
  reason: string
}

interface OrchestratorOptions {
  localOnly?: boolean
  claudeOnly?: boolean
  verbose?: boolean
}

export class Orchestrator {
  private router: Router
  private localAgent: LocalAgent
  private claudeAgent: ClaudeAgent
  private tracker: TokenTracker
  private config: Config
  private localOnly: boolean
  private claudeOnly: boolean
  private verbose: boolean
  private localFallback: boolean = false
  private fallbackSummary: string = ''
  private resetsAt: number = 0
  private repoContext: string = ''
  private mcpManager: McpManager | null = null

  private toolExecutor: ToolExecutor
  private codingAgent: CodingAgent | null = null
  private taskClassifier: TaskClassifier
  private artifactStore: RunArtifactStore
  private persistentContextCache: PersistentContextCache

  constructor(config: Config, localAgent?: LocalAgent, claudeAgent?: ClaudeAgent, options?: OrchestratorOptions) {
    this.config = config
    this.router = new Router(config)
    this.taskClassifier = new TaskClassifier()
    const runtimeConfig = { ...DEFAULT_RUNTIME_CONFIG, ...config.runtime }
    this.artifactStore = new RunArtifactStore(runtimeConfig.artifacts_dir)
    this.persistentContextCache = new PersistentContextCache(config.performance?.cache_dir ?? '.locode/context-cache')
    const registry = createDefaultRegistry()
    const safetyGate = new SafetyGate(config.safety)
    this.toolExecutor = new ToolExecutor(registry, safetyGate)
    if (runtimeConfig.approval_mode === 'auto') {
      this.toolExecutor.setApprovalHandler(async () => true)
    } else if (runtimeConfig.approval_mode === 'read-only') {
      this.toolExecutor.setApprovalHandler(async () => false)
    }
    this.localAgent = localAgent ?? new LocalAgent(config, this.toolExecutor, { verbose: options?.verbose })
    this.claudeAgent = claudeAgent ?? new ClaudeAgent(config, this.toolExecutor)
    this.tracker = new TokenTracker(config.token_tracking)
    this.claudeOnly = options?.claudeOnly ?? false
    this.localOnly = options?.localOnly ?? (!process.env.ANTHROPIC_API_KEY)
    this.verbose = options?.verbose ?? false
    this.repoContext = loadRepoContext(config.context.repo_context_files, config.context.max_file_bytes)

    this.rebuildCodingAgent(safetyGate)
  }

  async initMcp(): Promise<void> {
    if (Object.keys(this.config.mcp_servers).length === 0) return
    this.mcpManager = new McpManager()
    await this.mcpManager.connectAll(this.config)
    // Register MCP tools into the shared registry
    const mcpTools = this.mcpManager.getTools()
    for (const tool of mcpTools) {
      const manager = this.mcpManager
      this.toolExecutor.registry.register({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        category: 'read',
        async handler(args) {
          const output = await manager.callTool(tool.name, args as Record<string, string>)
          return { success: true, output }
        },
      })
    }
    // Rebuild local agent and coding agent with updated registry (MCP tools now included)
    this.localAgent = new LocalAgent(this.config, this.toolExecutor, { verbose: this.verbose })
    this.rebuildCodingAgent(new SafetyGate(this.config.safety))
  }

  async shutdown(): Promise<void> {
    if (this.mcpManager) await this.mcpManager.disconnectAll()
  }

  isLocalOnly(): boolean { return this.localOnly }
  isClaudeOnly(): boolean { return this.claudeOnly }
  isLocalFallback(): boolean { return this.localFallback }
  classifyTask(prompt: string): TaskIntent { return this.taskClassifier.classify(prompt) }
  setApprovalHandler(handler: ApprovalHandler | null): void { this.toolExecutor.setApprovalHandler(handler) }

  async process(prompt: string, previousSummary?: string): Promise<OrchestratorResult> {
    // Token exhaustion fallback
    if (this.localFallback) {
      if (Date.now() < this.resetsAt) {
        // Still before reset — stay local
        const result = await this.localAgent.run(prompt, this.fallbackSummary, this.repoContext)
        this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
        return { ...result, agent: 'local', routeMethod: 'rule', reason: 'Claude token limit reached, using local until reset' }
      }

      // Past reset — attempt switch-back to Claude
      try {
        const claudeResult = await this.claudeAgent.run(prompt, this.fallbackSummary, this.repoContext)
        this.localFallback = false
        this.fallbackSummary = ''
        this.tracker.record({ agent: 'claude', input: claudeResult.inputTokens, output: claudeResult.outputTokens, model: this.config.claude.model })
        await this.checkAndTriggerFallback(claudeResult)
        return { ...claudeResult, agent: 'claude', routeMethod: 'rule', reason: 'Claude available again after token reset' }
      } catch (err) {
        if (isRateLimitError(err)) {
          this.resetsAt = Date.now() + 60 * 60 * 1000  // retry in 1 hour
          const result = await this.localAgent.run(prompt, this.fallbackSummary, this.repoContext)
          this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
          return { ...result, agent: 'local', routeMethod: 'rule', reason: 'Claude still rate-limited, staying on local' }
        }
        throw err
      }
    }

    // Enrich prompt with any referenced file contents before routing/dispatch
    const enrichedPrompt = injectFileContext(prompt, this.config.context.max_file_bytes)

    const intent = this.classifyTask(prompt)
    if (!this.localFallback && this.codingAgent && intent === 'edit') {
      const preferredAgent = this.claudeOnly ? 'claude' : this.localOnly ? 'local' : undefined
      return this.runCodingAgent(enrichedPrompt, preferredAgent)
    }

    if (this.claudeOnly) {
      const result = await this.claudeAgent.run(enrichedPrompt, previousSummary, this.repoContext)
      this.tracker.record({ agent: 'claude', input: result.inputTokens, output: result.outputTokens, model: this.config.claude.model })
      await this.checkAndTriggerFallback(result)
      const finalResult = { ...result, agent: 'claude' as const, routeMethod: 'rule' as const, reason: '--claude-only mode' }
      await this.writeArtifact(enrichedPrompt, intent, finalResult)
      return finalResult
    }

    if (this.localOnly) {
      const result = await this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)
      this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
      const finalResult = { ...result, agent: 'local' as const, routeMethod: 'rule' as const, reason: '--local-only mode' }
      await this.writeArtifact(enrichedPrompt, intent, finalResult)
      return finalResult
    }

    const decision = await this.router.classify(enrichedPrompt)
    let reason = decision.reason

    let result: AgentResult
    if (decision.agent === 'claude') {
      try {
        const claudeResult = await this.claudeAgent.run(enrichedPrompt, previousSummary, this.repoContext)
        await this.checkAndTriggerFallback(claudeResult)
        result = claudeResult
      } catch (err) {
        result = await this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)
        decision.agent = 'local'
        reason = `Claude unavailable (${(err as Error).message}), fell back to local`
      }
    } else {
      result = await this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)
    }

    this.tracker.record({
      agent: decision.agent,
      input: result.inputTokens,
      output: result.outputTokens,
      model: decision.agent === 'local' ? this.config.local_llm.model : this.config.claude.model,
    })

    const finalResult = { ...result, agent: decision.agent, routeMethod: decision.method, reason }
    await this.writeArtifact(enrichedPrompt, intent, finalResult)
    return finalResult
  }

  async route(prompt: string): Promise<RouteDecision> {
    const enrichedPrompt = injectFileContext(prompt, this.config.context.max_file_bytes)
    return this.router.classify(enrichedPrompt)
  }

  async execute(prompt: string, agent: AgentType, previousSummary?: string): Promise<OrchestratorResult> {
    const enrichedPrompt = injectFileContext(prompt, this.config.context.max_file_bytes)
    const intent = this.classifyTask(prompt)

    if (this.codingAgent && intent === 'edit') {
      return this.runCodingAgent(enrichedPrompt, agent)
    }

    let result: AgentResult
    let actualAgent = agent
    let reason = `user confirmed ${agent}`

    if (agent === 'claude') {
      try {
        const claudeResult = await this.claudeAgent.run(enrichedPrompt, previousSummary, this.repoContext)
        await this.checkAndTriggerFallback(claudeResult)
        result = claudeResult
      } catch (err) {
        result = await this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)
        actualAgent = 'local'
        reason = `Claude unavailable (${(err as Error).message}), fell back to local`
      }
    } else {
      result = await this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)
    }

    this.tracker.record({
      agent: actualAgent,
      input: result.inputTokens,
      output: result.outputTokens,
      model: actualAgent === 'local' ? this.config.local_llm.model : this.config.claude.model,
    })

    const finalResult = { ...result, agent: actualAgent, routeMethod: 'llm' as const, reason }
    await this.writeArtifact(enrichedPrompt, intent, finalResult)
    return finalResult
  }

  async retryWithLocal(prompt: string, previousSummary?: string): Promise<OrchestratorResult> {
    const result = await this.localAgent.run(prompt, previousSummary, this.repoContext)
    this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
    return { ...result, agent: 'local', routeMethod: 'rule', reason: 'user requested local retry' }
  }

  async retryWithClaude(prompt: string, previousSummary?: string): Promise<OrchestratorResult> {
    const result = await this.claudeAgent.run(prompt, previousSummary, this.repoContext)
    this.tracker.record({ agent: 'claude', input: result.inputTokens, output: result.outputTokens, model: this.config.claude.model })
    await this.checkAndTriggerFallback(result)
    return { ...result, agent: 'claude', routeMethod: 'rule', reason: 'user requested Claude escalation' }
  }

  isCodingTask(prompt: string): boolean {
    return this.classifyTask(prompt) === 'edit'
  }

  async runCodingAgent(prompt: string, preferredAgent?: AgentType): Promise<OrchestratorResult> {
    if (!this.codingAgent) {
      return this.process(prompt)
    }
    const result = await this.codingAgent.run(prompt, { preferredAgent })
    this.tracker.record({
      agent: result.agent,
      input: result.tokensUsed.input,
      output: result.tokensUsed.output,
      model: result.agent === 'local' ? this.config.local_llm.model : this.config.claude.model,
    })
    const summary = result.success
      ? `Applied ${result.edits.length} edits (${result.iterations} iterations)`
      : 'Coding agent failed to apply edits'
    const finalResult: OrchestratorResult = {
      content: result.diffs.join('\n') || summary,
      summary,
      inputTokens: result.tokensUsed.input,
      outputTokens: result.tokensUsed.output,
      agent: result.agent,
      routeMethod: 'rule',
      reason: 'coding task detected',
    }
    await this.writeArtifact(prompt, 'edit', finalResult, {
      edits: result.edits,
      diffs: result.diffs,
      iterations: result.iterations,
      validationPassed: result.validationPassed,
    })
    return finalResult
  }

  getCodingAgent(): CodingAgent | null {
    return this.codingAgent
  }

  getStats() { return this.tracker.getStats() }
  resetStats() { this.tracker.reset() }

  private rebuildCodingAgent(safetyGate: SafetyGate): void {
    if (!this.config.agent) {
      this.codingAgent = null
      return
    }
    const codeEditor = new CodeEditor(safetyGate, process.cwd())
    const planner = new Planner(this.localAgent, this.claudeAgent)
    const agentMemory = new AgentMemory()
    this.codingAgent = new CodingAgent(
      this.localAgent,
      this.localOnly ? null : this.claudeAgent,
      this.toolExecutor,
      codeEditor,
      planner,
      agentMemory,
      this.config.agent,
      this.config.performance,
      this.persistentContextCache,
    )
  }

  private async writeArtifact(
    prompt: string,
    intent: TaskIntent,
    result: OrchestratorResult,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.artifactStore.write({
        prompt,
        intent,
        routeMethod: result.routeMethod,
        agent: result.agent,
        reason: result.reason,
        summary: result.summary,
        content: result.content,
        metadata,
      })
    } catch {
      // Artifact writing should never break the user-facing run.
    }
  }

  private async checkAndTriggerFallback(result: ClaudeAgentResult): Promise<void> {
    const info = result.rateLimitInfo
    if (!info || info.tokensLimit === 0) return

    const usedFraction = (info.tokensLimit - info.tokensRemaining) / info.tokensLimit
    if (usedFraction < this.config.claude.token_threshold) return

    console.error(`[locode] Claude tokens at ${Math.round(usedFraction * 100)}%, switching to local agent`)

    try {
      this.fallbackSummary = await this.claudeAgent.generateHandoffSummary(result.summary)
    } catch {
      this.fallbackSummary = result.summary
    }

    this.localFallback = true
    this.resetsAt = info.resetsAt
  }
}
