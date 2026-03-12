import path from 'path'

export interface SafetyConfig {
  always_confirm: string[]
  auto_approve: string[]
  allowed_write_paths: string[]
}

export interface SafetyDecision {
  allowed: boolean
  reason: string
  requiresConfirmation: boolean
}

export interface ToolCall {
  tool: string
  args: Record<string, unknown>
}

export class SafetyGate {
  private config: SafetyConfig

  constructor(config: SafetyConfig) {
    this.config = config
  }

  check(call: ToolCall): SafetyDecision {
    // always_confirm takes precedence
    if (this.config.always_confirm.includes(call.tool)) {
      return { allowed: true, reason: 'requires confirmation', requiresConfirmation: true }
    }

    if (this.config.auto_approve.includes(call.tool)) {
      return { allowed: true, reason: 'auto-approved', requiresConfirmation: false }
    }

    // Default: allow without confirmation
    return { allowed: true, reason: 'default-allow', requiresConfirmation: false }
  }

  checkWritePath(filePath: string): SafetyDecision {
    const resolved = path.resolve(filePath)
    const cwd = process.cwd()

    for (const allowed of this.config.allowed_write_paths) {
      // "." means anywhere under project root
      if (allowed === '.') {
        if (resolved.startsWith(cwd)) {
          return { allowed: true, reason: 'within project root', requiresConfirmation: false }
        }
        continue
      }

      const allowedResolved = path.resolve(cwd, allowed)
      if (resolved.startsWith(allowedResolved + path.sep) || resolved === allowedResolved) {
        return { allowed: true, reason: `within ${allowed}`, requiresConfirmation: false }
      }
    }

    return {
      allowed: false,
      reason: `write to '${resolved}' is outside allowed paths: ${this.config.allowed_write_paths.join(', ')}`,
      requiresConfirmation: false,
    }
  }
}
