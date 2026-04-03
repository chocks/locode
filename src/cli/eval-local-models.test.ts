import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../tools/registry'
import { assessTaskRun, getDefaultEvalVariants, parseVariantSpec, resolveEvalVariants } from './eval-local-models'
import { readFileDefinition } from '../tools/definitions/read-file'
import type { AgentResult } from '../agents/local'

describe('parseVariantSpec', () => {
  it('parses a bare model name into a default variant', () => {
    expect(parseVariantSpec('gemma4:9b')).toEqual({
      label: 'gemma4-9b',
      model: 'gemma4:9b',
      thinking: false,
    })
  })

  it('parses key-value variant specs', () => {
    expect(parseVariantSpec('label=gemma-thinking,model=gemma4:27b,thinking=true,num_ctx=16384')).toEqual({
      label: 'gemma-thinking',
      model: 'gemma4:27b',
      thinking: true,
      numCtx: 16384,
    })
  })

  it('rejects unknown keys', () => {
    expect(() => parseVariantSpec('model=gemma4:9b,foo=bar')).toThrow('unknown variant key')
  })
})

describe('resolveEvalVariants', () => {
  it('returns the default comparison pair when no variants are provided', () => {
    expect(getDefaultEvalVariants().map(variant => variant.model)).toEqual(['llama3.1:8b', 'gemma4:9b'])
    expect(resolveEvalVariants(undefined).map(variant => variant.model)).toEqual(['llama3.1:8b', 'gemma4:9b'])
  })
})

describe('assessTaskRun', () => {
  it('passes when content and tool requirements are satisfied', () => {
    const registry = new ToolRegistry()
    registry.register(readFileDefinition)
    const task = {
      id: 'read-package-scripts',
      prompt: 'Read package.json',
      requiredAnyTools: ['read_file'],
      contentChecks: [/\bbuild\b/i, /\btest\b/i],
    }
    const result: AgentResult = {
      content: 'The build script runs tsc and the test script runs vitest.',
      summary: 'summary',
      inputTokens: 10,
      outputTokens: 5,
      toolCalls: [{ tool: 'read_file', args: { path: 'package.json' }, result: { success: true, output: '{}' } }],
    }

    expect(assessTaskRun(task, result, registry).passed).toBe(true)
  })

  it('fails when the model repeats the same failing tool call', () => {
    const registry = new ToolRegistry()
    registry.register(readFileDefinition)
    const task = {
      id: 'blocked-command-recovery',
      prompt: 'Try tree first',
      requiredAnyTools: ['run_command'],
      contentChecks: [/\bsrc\b/i],
      maxRepeatedFailedCallStreak: 1,
    }
    const result: AgentResult = {
      content: 'src is present.',
      summary: 'summary',
      inputTokens: 10,
      outputTokens: 5,
      toolCalls: [
        { tool: 'run_command', args: { command: 'tree' }, result: { success: false, output: '' } },
        { tool: 'run_command', args: { command: 'tree' }, result: { success: false, output: '' } },
      ],
    }

    const assessment = assessTaskRun(task, result, registry)
    expect(assessment.passed).toBe(false)
    expect(assessment.repeatedFailedCallStreak).toBe(2)
  })
})
