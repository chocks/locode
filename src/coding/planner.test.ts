import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Planner } from './planner'
import type { GatheredContext, EditPlan } from './types'

// Mock agents
const mockLocalAgent = {
  run: vi.fn(),
}

const mockClaudeAgent = {
  run: vi.fn(),
}

describe('Planner', () => {
  let planner: Planner

  beforeEach(() => {
    vi.clearAllMocks()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    planner = new Planner(mockLocalAgent as any, mockClaudeAgent as any)
  })

  const baseContext: GatheredContext = {
    files: [{ path: 'src/a.ts', content: 'export const x = 1', relevance: 'main target' }],
    searchResults: [],
    memory: {
      recentFiles: [],
      recentEdits: [],
      recentCommands: [],
      recentErrors: [],
      sessionStart: Date.now(),
    },
  }

  describe('generatePlan', () => {
    it('parses a valid JSON plan from LLM response', async () => {
      const plan: EditPlan = {
        description: 'Add logging',
        steps: [{
          description: 'Add import',
          file: 'src/a.ts',
          operation: 'patch',
          patch: { unifiedDiff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const x = 1\n+export const x = 2\n' },
          precondition: { fileHash: 'abc123' },
          reasoning: 'Need logger import',
        }],
        estimatedFiles: ['src/a.ts'],
      }
      mockLocalAgent.run.mockResolvedValue({
        content: JSON.stringify(plan),
        summary: '',
        inputTokens: 100,
        outputTokens: 50,
      })

      const result = await planner.generatePlan('Add logging', baseContext, 'local')
      expect(result.description).toBe('Add logging')
      expect(result.steps).toHaveLength(1)
      expect(result.steps[0].file).toBe('src/a.ts')
      expect(result.steps[0].patch?.unifiedDiff).toContain('@@')
      expect(result.steps[0].precondition?.fileHash).toBe('abc123')
    })

    it('handles malformed JSON by extracting with regex', async () => {
      const response = `Here is the plan:
\`\`\`json
{
  "description": "Fix bug",
  "steps": [{ "description": "Fix return", "file": "a.ts", "operation": "replace", "search": "return null", "reasoning": "Should return value" }],
  "estimatedFiles": ["a.ts"]
}
\`\`\`
Let me know if this looks good.`
      mockLocalAgent.run.mockResolvedValue({
        content: response,
        summary: '',
        inputTokens: 100,
        outputTokens: 80,
      })

      const result = await planner.generatePlan('Fix bug', baseContext, 'local')
      expect(result.description).toBe('Fix bug')
      expect(result.steps).toHaveLength(1)
    })

    it('uses claude agent when agent param is claude', async () => {
      mockClaudeAgent.run.mockResolvedValue({
        content: JSON.stringify({
          description: 'Refactor',
          steps: [],
          estimatedFiles: [],
        }),
        summary: '',
        inputTokens: 200,
        outputTokens: 100,
      })

      await planner.generatePlan('Refactor', baseContext, 'claude')
      expect(mockClaudeAgent.run).toHaveBeenCalled()
      expect(mockLocalAgent.run).not.toHaveBeenCalled()
    })

    it('throws when no plan can be extracted', async () => {
      mockLocalAgent.run.mockResolvedValue({
        content: 'I cannot help with that.',
        summary: '',
        inputTokens: 50,
        outputTokens: 20,
      })

      await expect(planner.generatePlan('Do something', baseContext, 'local'))
        .rejects.toThrow('Failed to parse edit plan')
    })
  })

  describe('refinePlan', () => {
    it('passes errors to the LLM for plan refinement', async () => {
      const originalPlan: EditPlan = {
        description: 'Add feature',
        steps: [{ description: 'Step 1', file: 'a.ts', operation: 'replace', reasoning: 'Fix' }],
        estimatedFiles: ['a.ts'],
      }
      const refined: EditPlan = {
        description: 'Add feature (refined)',
        steps: [{ description: 'Step 1 fixed', file: 'a.ts', operation: 'replace', search: 'const x', reasoning: 'Fix with correct search' }],
        estimatedFiles: ['a.ts'],
      }

      mockLocalAgent.run.mockResolvedValue({
        content: JSON.stringify(refined),
        summary: '',
        inputTokens: 150,
        outputTokens: 80,
      })

      const result = await planner.refinePlan(originalPlan, ['Search string not found'], 'local')
      expect(result.description).toBe('Add feature (refined)')
      // Verify the errors were included in the prompt
      const callArgs = mockLocalAgent.run.mock.calls[0][0]
      expect(callArgs).toContain('Search string not found')
    })
  })
})
