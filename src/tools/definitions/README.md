# Tool Definitions

Each file in this directory defines a single tool that LLM agents can call.

## Adding a New Tool

1. Create a new file (e.g. `my-tool.ts`)
2. Export a `ToolDefinition` object
3. Register it in `default-registry.ts`
4. Add tests in `definitions.test.ts`

### Template

```typescript
import type { ToolDefinition } from '../registry'

export const myToolDefinition: ToolDefinition = {
  name: 'my_tool',           // snake_case, this is what the LLM calls
  description: 'What this tool does — be specific, the LLM reads this',
  inputSchema: {
    type: 'object',
    properties: {
      arg1: { type: 'string', description: 'Describe what this arg is for' },
    },
    required: ['arg1'],
  },
  category: 'read',          // read | write | search | git | shell
  requiresConfirmation: false, // true for write operations (SafetyGate checks this)
  async handler(args) {
    const arg1 = args.arg1 as string

    // Do the work...

    // Return ToolResult on success:
    return { success: true, output: 'result text' }

    // Return ToolResult on failure:
    // return { success: false, output: '', error: 'what went wrong' }
  },
}
```

### Registration

In `default-registry.ts`:

```typescript
import { myToolDefinition } from './my-tool'

// Inside createDefaultRegistry():
registry.register(myToolDefinition)
```

### Categories

| Category | When to use | `requiresConfirmation` |
|----------|-------------|------------------------|
| `read` | Reading files, inspecting state | `false` |
| `write` | Creating/modifying files | `true` |
| `search` | Searching code, finding files | `false` |
| `git` | Git queries (read-only) | `false` |
| `shell` | Shell commands | `false` |

### ToolResult Metadata

Include metadata when it helps track what the tool did:

```typescript
return {
  success: true,
  output: 'Done',
  metadata: {
    filesRead: ['/path/to/file'],     // files that were read
    filesWritten: ['/path/to/file'],  // files that were created/modified
    linesChanged: 5,                   // lines affected
  },
}
```

### Testing

Add tests for your tool's handler in `definitions.test.ts`:

```typescript
describe('myToolDefinition', () => {
  it('has correct metadata', () => {
    expect(myToolDefinition.name).toBe('my_tool')
    expect(myToolDefinition.category).toBe('read')
    expect(myToolDefinition.inputSchema.required).toContain('arg1')
  })

  it('handler returns success for valid input', async () => {
    const result = await myToolDefinition.handler({ arg1: 'test' })
    expect(result.success).toBe(true)
  })

  it('handler returns failure for bad input', async () => {
    const result = await myToolDefinition.handler({ arg1: '' })
    expect(result.success).toBe(false)
  })
})
```

### Checklist

- [ ] File named `kebab-case.ts`, export named `camelCaseDefinition`
- [ ] `name` is `snake_case` (matches what LLMs call)
- [ ] `description` is clear enough for an LLM to know when to use it
- [ ] `inputSchema.required` lists all mandatory args
- [ ] `category` and `requiresConfirmation` are set correctly
- [ ] Registered in `default-registry.ts`
- [ ] Tests cover success path, failure path, and metadata
