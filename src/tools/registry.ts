export interface ToolResult {
  success: boolean
  output: string
  error?: string
  metadata?: {
    filesRead?: string[]
    filesWritten?: string[]
    linesChanged?: number
  }
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
  category: 'read' | 'write' | 'search' | 'git' | 'shell'
  requiresConfirmation?: boolean
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`)
    }
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()]
  }

  listForLLM(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return this.list().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }))
  }

  listForClaude(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    return this.list().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }))
  }

  describeForPrompt(): string {
    return this.list().map(tool => {
      const props = tool.inputSchema.properties as Record<string, unknown> | undefined
      const params = props ? Object.keys(props).join(', ') : ''
      return `${tool.name}(${params})\n  ${tool.description}`
    }).join('\n\n')
  }

  validate(name: string, args: Record<string, unknown>): ValidationResult {
    const tool = this.tools.get(name)
    if (!tool) {
      return { valid: false, errors: [`unknown tool: '${name}'`] }
    }

    const required = tool.inputSchema.required as string[] | undefined
    if (!required || required.length === 0) {
      return { valid: true, errors: [] }
    }

    const errors: string[] = []
    for (const field of required) {
      if (!(field in args)) {
        errors.push(`missing required field: '${field}'`)
      }
    }

    return { valid: errors.length === 0, errors }
  }
}
