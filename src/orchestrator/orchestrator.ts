import { Router, AgentType, RouteDecision } from './router'
import { LocalAgent, AgentResult } from '../agents/local'
import { ClaudeAgent, ClaudeAgentResult } from '../agents/claude'
import { TokenTracker } from '../tracker/tracker'
import type { Config } from '../config/schema'
import { injectFileContext } from './file-context-injector'
import { loadRepoContext } from './repo-context-loader'
import { McpManager } from '../mcp/client'
import { ToolExecutor } from '../tools/executor'
import { SafetyGate } from '../tools/safety-gate'
import { createDefaultRegistry } from '../tools/definitions/default-registry'

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
}

export class Orchestrator {
  private router: Router
  private localAgent: LocalAgent
  private claudeAgent: ClaudeAgent
  private tracker: TokenTracker
  private config: Config
  private localOnly: boolean
  private claudeOnly: boolean
  private localFallback: boolean = false
  private fallbackSummary: string = ''
  private resetsAt: number = 0
  private repoContext: string = ''
  private mcpManager: McpManager | null = null

  private toolExecutor: ToolExecutor

  constructor(config: Config, localAgent?: LocalAgent, claudeAgent?: ClaudeAgent, options?: OrchestratorOptions) {
    this.config = config
    this.router = new Router(config)
    const registry = createDefaultRegistry()
    const safetyGate = new SafetyGate(config.safety)
    this.toolExecutor = new ToolExecutor(registry, safetyGate)
    this.localAgent = localAgent ?? new LocalAgent(config, this.toolExecutor)
    this.claudeAgent = claudeAgent ?? new ClaudeAgent(config, this.toolExecutor)
    this.tracker = new TokenTracker(config.token_tracking)
    this.claudeOnly = options?.claudeOnly ?? false
    this.localOnly = options?.localOnly ?? (!process.env.ANTHROPIC_API_KEY)
    this.repoContext = loadRepoContext(config.context.repo_context_files, config.context.max_file_bytes)
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
    // Rebuild local agent with updated registry (MCP tools now included)
    this.localAgent = new LocalAgent(this.config, this.toolExecutor)
  }

  async shutdown(): Promise<void> {
    if (this.mcpManager) await this.mcpManager.disconnectAll()
  }

  isLocalOnly(): boolean { return this.localOnly }
  isClaudeOnly(): boolean { return this.claudeOnly }
  isLocalFallback(): boolean { return this.localFallback }

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

    if (this.claudeOnly) {
      const result = await this.claudeAgent.run(enrichedPrompt, previousSummary, this.repoContext)
      this.tracker.record({ agent: 'claude', input: result.inputTokens, output: result.outputTokens, model: this.config.claude.model })
      await this.checkAndTriggerFallback(result)
      return { ...result, agent: 'claude', routeMethod: 'rule', reason: '--claude-only mode' }
    }

    if (this.localOnly) {
      const result = await this.localAgent.run(enrichedPrompt, previousSummary, this.repoContext)
      this.tracker.record({ agent: 'local', input: result.inputTokens, output: result.outputTokens, model: this.config.local_llm.model })
      return { ...result, agent: 'local', routeMethod: 'rule', reason: '--local-only mode' }
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

    return { ...result, agent: decision.agent, routeMethod: decision.method, reason }
  }

  async route(prompt: string): Promise<RouteDecision> {
    const enrichedPrompt = injectFileContext(prompt, this.config.context.max_file_bytes)
    return this.router.classify(enrichedPrompt)
  }

  async execute(prompt: string, agent: AgentType, previousSummary?: string): Promise<OrchestratorResult> {
    const enrichedPrompt = injectFileContext(prompt, this.config.context.max_file_bytes)

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

    return { ...result, agent: actualAgent, routeMethod: 'llm', reason }
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

  getStats() { return this.tracker.getStats() }
  resetStats() { this.tracker.reset() }

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
