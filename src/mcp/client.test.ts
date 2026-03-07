import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  const MockClient = vi.fn()
  MockClient.prototype.connect = vi.fn()
  MockClient.prototype.close = vi.fn()
  MockClient.prototype.listTools = vi.fn().mockResolvedValue({
    tools: [
      {
        name: 'list_issues',
        description: 'List Linear issues',
        inputSchema: { type: 'object', properties: { teamId: { type: 'string' } } },
      },
      {
        name: 'get_issue',
        description: 'Get a Linear issue by ID',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    ],
  })
  MockClient.prototype.callTool = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'tool result here' }],
  })
  return { Client: MockClient }
})

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  const MockTransport = vi.fn()
  MockTransport.prototype.finishAuth = vi.fn()
  return { StreamableHTTPClientTransport: MockTransport }
})

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor() { super('Unauthorized') }
  },
}))

vi.mock('./oauth', () => ({
  LocodeMcpAuthProvider: vi.fn(),
  waitForAuthCallback: vi.fn().mockResolvedValue('auth-code-123'),
}))

import { McpManager } from './client'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Config } from '../config/schema'

function makeConfig(mcp_servers: Config['mcp_servers']): Config {
  return {
    local_llm: { provider: 'ollama', model: 'qwen3:8b', base_url: 'http://localhost:11434' },
    claude: { model: 'claude-sonnet-4-6', token_threshold: 0.99 },
    routing: { rules: [], ambiguous_resolver: 'local', escalation_threshold: 0.7 },
    context: { handoff: 'summary', max_summary_tokens: 500, max_file_bytes: 51200 },
    token_tracking: { enabled: false, log_file: '/tmp/test.log' },
    mcp_servers,
  }
}

function getMockClient() {
  return (Client as unknown as ReturnType<typeof vi.fn>).mock.instances[0] as {
    connect: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    listTools: ReturnType<typeof vi.fn>
    callTool: ReturnType<typeof vi.fn>
  }
}

describe('McpManager', () => {
  let manager: McpManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new McpManager()
  })

  it('connects to a stdio server and discovers tools', async () => {
    const config = makeConfig({
      github: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'tok' },
      },
    })

    await manager.connectAll(config)

    const tools = manager.getTools()
    expect(tools).toHaveLength(2)
    expect(tools[0].name).toBe('list_issues')
    expect(tools[0].server).toBe('github')
  })

  it('connects to a remote server and discovers tools', async () => {
    const config = makeConfig({
      linear: { type: 'remote', url: 'https://mcp.linear.app/sse' },
    })

    await manager.connectAll(config)

    const tools = manager.getTools()
    expect(tools).toHaveLength(2)
    expect(tools[0].server).toBe('linear')
  })

  it('handles OAuth flow on UnauthorizedError for remote servers', async () => {
    const { UnauthorizedError } = await import('@modelcontextprotocol/sdk/client/auth.js')
    const { waitForAuthCallback } = await import('./oauth')

    const config = makeConfig({
      linear: { type: 'remote', url: 'https://mcp.linear.app/sse' },
    })

    // Set up on prototype level since instance isn't created yet
    const proto = (Client as unknown as ReturnType<typeof vi.fn>).prototype
    proto.connect
      .mockRejectedValueOnce(new UnauthorizedError())
      .mockResolvedValueOnce(undefined)

    await manager.connectAll(config)

    expect(waitForAuthCallback).toHaveBeenCalled()
    expect(proto.connect).toHaveBeenCalledTimes(2)
  })

  it('returns empty tools when no servers configured', async () => {
    await manager.connectAll(makeConfig({}))
    expect(manager.getTools()).toHaveLength(0)
  })

  it('calls a tool and returns text content', async () => {
    await manager.connectAll(makeConfig({
      test: { type: 'stdio', command: 'test-server', args: [], env: {} },
    }))

    const result = await manager.callTool('list_issues', { teamId: 'T1' })
    expect(result).toBe('tool result here')

    const mock = getMockClient()
    expect(mock.callTool).toHaveBeenCalledWith({
      name: 'list_issues',
      arguments: { teamId: 'T1' },
    })
  })

  it('returns error for unknown tool name', async () => {
    await manager.connectAll(makeConfig({}))
    const result = await manager.callTool('nonexistent', {})
    expect(result).toContain('Unknown MCP tool')
  })

  it('disconnects all clients', async () => {
    await manager.connectAll(makeConfig({
      test: { type: 'stdio', command: 'test-server', args: [], env: {} },
    }))

    await manager.disconnectAll()
    expect(manager.getTools()).toHaveLength(0)

    const mock = getMockClient()
    expect(mock.close).toHaveBeenCalled()
  })
})
