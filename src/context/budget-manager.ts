import type { BudgetPriority, BudgetedFile } from './types'

const PRIORITY_WEIGHTS: Record<BudgetPriority, number> = {
  direct_match: 1.0,
  symbol_match: 0.8,
  semantic_match: 0.6,
  dependency: 0.4,
  git_context: 0.3,
}

export interface BudgetManagerOptions {
  maxPerFile?: number
  maxFiles?: number
}

export class BudgetManager {
  private maxPerFile: number
  private maxFiles: number

  constructor(
    private totalTokens: number,
    opts: BudgetManagerOptions = {},
  ) {
    this.maxPerFile = opts.maxPerFile ?? totalTokens
    this.maxFiles = opts.maxFiles ?? Infinity
  }

  allocate(
    files: Array<{ path: string; content: string; priority: BudgetPriority }>,
  ): BudgetedFile[] {
    if (files.length === 0) return []

    const sorted = [...files].sort((a, b) =>
      PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority],
    )

    const limited = sorted.slice(0, this.maxFiles)

    const totalWeight = limited.reduce(
      (sum, f) => sum + PRIORITY_WEIGHTS[f.priority], 0,
    )

    const result: BudgetedFile[] = []
    let remaining = this.totalTokens

    for (const file of limited) {
      if (remaining <= 0) {
        result.push({
          path: file.path, content: '', tokensUsed: 0, truncated: true,
        })
        continue
      }

      const weight = PRIORITY_WEIGHTS[file.priority]
      const weightedBudget = Math.floor((weight / totalWeight) * this.totalTokens)
      const fileBudget = Math.min(weightedBudget, this.maxPerFile, remaining)
      const requestedChars = file.content.length
      const usedChars = Math.min(requestedChars, fileBudget)
      const truncated = usedChars < requestedChars

      result.push({
        path: file.path,
        content: file.content.slice(0, usedChars),
        tokensUsed: usedChars,
        truncated,
      })

      remaining -= usedChars
    }

    return result
  }
}
