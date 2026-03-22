export type TaskIntent = 'chat' | 'inspect' | 'edit' | 'workflow'

const WORKFLOW_PATTERNS = [
  /\bworkflow\b/i,
  /\bmilestone\b/i,
  /\bopen (?:a )?pr\b/i,
  /\bcreate (?:a )?pr\b/i,
  /\bcreate (?:a )?branch\b/i,
  /\bticket\b/i,
]

const EDIT_PATTERNS = [
  /\b(add|fix|implement|refactor|change|update|modify|create|write|delete|remove|rename)\b/i,
]

const INSPECT_PATTERNS = [
  /\b(find|grep|search|read|show|list|inspect|explore|cat|ls|git\s+(?:log|diff|status|blame))\b/i,
]

const CHAT_START_PATTERNS = [
  /^(explain|describe|what|how|why|tell)\b/i,
]

export class TaskClassifier {
  classify(prompt: string): TaskIntent {
    const trimmed = prompt.trim()
    if (!trimmed) return 'chat'

    if (WORKFLOW_PATTERNS.some(pattern => pattern.test(trimmed))) {
      return 'workflow'
    }

    if (CHAT_START_PATTERNS.some(pattern => pattern.test(trimmed))) {
      return INSPECT_PATTERNS.some(inspect => inspect.test(trimmed)) ? 'inspect' : 'chat'
    }

    if (INSPECT_PATTERNS.some(pattern => pattern.test(trimmed))) {
      return 'inspect'
    }

    if (EDIT_PATTERNS.some(pattern => pattern.test(trimmed))) {
      return 'edit'
    }

    return 'chat'
  }
}
