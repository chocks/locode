import type { AgentResult } from '../agents/local'
import type { EditPlan, GatheredContext } from './types'

interface LLMAgent {
  run(prompt: string, previousSummary?: string, repoContext?: string): Promise<AgentResult>
}

export class Planner {
  constructor(
    private localAgent: LLMAgent,
    private claudeAgent: LLMAgent | null,
  ) {}

  async generatePlan(
    prompt: string,
    context: GatheredContext,
    agent: 'local' | 'claude',
  ): Promise<EditPlan> {
    const systemPrompt = this.buildPlanPrompt(prompt, context)
    const llm = this.selectAgent(agent)
    const result = await llm.run(systemPrompt)
    return this.parsePlan(result.content)
  }

  async refinePlan(
    plan: EditPlan,
    errors: string[],
    agent: 'local' | 'claude',
  ): Promise<EditPlan> {
    const prompt = this.buildRefinePrompt(plan, errors)
    const llm = this.selectAgent(agent)
    const result = await llm.run(prompt)
    return this.parsePlan(result.content)
  }

  private selectAgent(agent: 'local' | 'claude'): LLMAgent {
    if (agent === 'claude' && this.claudeAgent) {
      return this.claudeAgent
    }
    return this.localAgent
  }

  private buildPlanPrompt(prompt: string, context: GatheredContext): string {
    const fileSummary = context.files
      .map(f => `--- ${f.path} (${f.relevance}) ---\n${f.content}`)
      .join('\n\n')

    const searchSummary = context.searchResults.length > 0
      ? `Search results:\n${context.searchResults.map(r => `${r.file}:${r.line}: ${r.match}`).join('\n')}`
      : ''

    return `You are a code editing planner. Create an edit plan as JSON. Do NOT write code.

REQUEST: ${prompt}

FILES:
${fileSummary}

${searchSummary}

${context.memory.recentFiles.length > 0 ? `Recently accessed: ${context.memory.recentFiles.join(', ')}` : ''}

Respond with ONLY a JSON object:
{
  "description": "what this plan does",
  "steps": [
    {
      "description": "what this step does",
      "file": "path/to/file",
      "operation": "insert|replace|delete|create",
      "search": "exact text to find in file",
      "reasoning": "why this change"
    }
  ],
  "estimatedFiles": ["list", "of", "files"]
}`
  }

  private buildRefinePrompt(plan: EditPlan, errors: string[]): string {
    return `The following edit plan failed. Fix it based on the errors.

ORIGINAL PLAN:
${JSON.stringify(plan, null, 2)}

ERRORS:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Respond with ONLY the corrected JSON plan (same format as above).`
  }

  private parsePlan(response: string): EditPlan {
    // Try direct JSON parse
    try {
      const plan = JSON.parse(response)
      return this.validatePlan(plan)
    } catch {
      // Fall through to regex extraction
    }

    // Try extracting JSON from markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (jsonMatch) {
      try {
        const plan = JSON.parse(jsonMatch[1])
        return this.validatePlan(plan)
      } catch {
        // Fall through
      }
    }

    // Try finding a JSON object in the response
    const braceMatch = response.match(/\{[\s\S]*"steps"[\s\S]*\}/)
    if (braceMatch) {
      try {
        const plan = JSON.parse(braceMatch[0])
        return this.validatePlan(plan)
      } catch {
        // Fall through
      }
    }

    throw new Error('Failed to parse edit plan from LLM response')
  }

  private validatePlan(plan: unknown): EditPlan {
    const p = plan as EditPlan
    if (!p.description || !Array.isArray(p.steps)) {
      throw new Error('Invalid plan: missing description or steps')
    }
    return {
      description: p.description,
      steps: p.steps.map(s => ({
        description: s.description ?? '',
        file: s.file ?? '',
        operation: s.operation ?? 'replace',
        search: s.search,
        reasoning: s.reasoning ?? '',
      })),
      estimatedFiles: p.estimatedFiles ?? p.steps.map(s => s.file),
    }
  }
}
