import fs from 'fs'
import path from 'path'
import type { TaskIntent } from '../orchestrator/task-classifier'
import type { AgentType } from '../orchestrator/router'

export interface RunArtifactInput {
  prompt: string
  intent: TaskIntent
  routeMethod: 'rule' | 'llm'
  agent: AgentType
  reason: string
  summary: string
  content: string
  inputTokens?: number
  outputTokens?: number
  metadata?: Record<string, unknown>
}

export interface RunArtifactResult {
  runDir: string
  filePath: string
}

export class RunArtifactStore {
  constructor(private baseDir: string) {}

  async write(input: RunArtifactInput): Promise<RunArtifactResult> {
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`
    const runDir = path.resolve(this.baseDir, runId)
    fs.mkdirSync(runDir, { recursive: true })

    const filePath = path.join(runDir, 'run.json')
    const payload = {
      ...input,
      createdAt: new Date().toISOString(),
    }
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify({
      summary: input.summary,
      content: input.content,
      tokens: {
        input: input.inputTokens ?? 0,
        output: input.outputTokens ?? 0,
      },
    }, null, 2))
    fs.writeFileSync(path.join(runDir, 'prompt.txt'), input.prompt)
    fs.writeFileSync(path.join(runDir, 'content.txt'), input.content)
    fs.writeFileSync(path.join(runDir, 'summary.txt'), input.summary)
    if (input.metadata) {
      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify(input.metadata, null, 2))
      if (Array.isArray(input.metadata.edits)) {
        fs.writeFileSync(path.join(runDir, 'edits.json'), JSON.stringify(input.metadata.edits, null, 2))
      }
      if (Array.isArray(input.metadata.diffs)) {
        fs.writeFileSync(path.join(runDir, 'diffs.patch'), input.metadata.diffs.join('\n\n'))
      }
    }

    return { runDir, filePath }
  }
}
