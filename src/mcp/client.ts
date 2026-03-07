import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { LocodeMcpAuthProvider, waitForAuthCallback } from './oauth'
import type { Config } from '../config/schema'

export interface McpTool {
  server: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

type McpServerConfig = Config['mcp_servers'][string]

export class McpManager {
  private clients: Map<string, Client> = new Map()
  private transports: Map<string, StdioClientTransport | StreamableHTTPClientTransport> = new Map()
  private tools: McpTool[] = []

  async connectAll(config: Config): Promise<void> {
    const entries = Object.entries(config.mcp_servers)
    await Promise.all(entries.map(([name, server]) => this.connect(name, server)))
  }

  private async connect(name: string, server: McpServerConfig): Promise<void> {
    if (server.type === 'stdio') {
      await this.connectStdio(name, server)
    } else {
      await this.connectRemote(name, server)
    }
  }

  private async connectStdio(name: string, server: { command: string; args: string[]; env: Record<string, string> }): Promise<void> {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...process.env, ...server.env } as Record<string, string>,
    })

    const client = new Client({ name: `locode-${name}`, version: '1.0.0' })
    await client.connect(transport)
    await this.discoverTools(name, client)
    this.clients.set(name, client)
    this.transports.set(name, transport)
  }

  private async connectRemote(name: string, server: { url: string }): Promise<void> {
    const authProvider = new LocodeMcpAuthProvider(name)
    const transport = new StreamableHTTPClientTransport(
      new URL(server.url),
      { authProvider },
    )

    const client = new Client({ name: `locode-${name}`, version: '1.0.0' })

    try {
      await client.connect(transport)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        // OAuth flow: wait for browser callback, then finish auth
        const code = await waitForAuthCallback()
        await transport.finishAuth(code)
        // Reconnect with the new token
        await client.connect(transport)
      } else {
        throw err
      }
    }

    await this.discoverTools(name, client)
    this.clients.set(name, client)
    this.transports.set(name, transport)
  }

  private async discoverTools(name: string, client: Client): Promise<void> {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      this.tools.push({
        server: name,
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema as Record<string, unknown>,
      })
    }
  }

  getTools(): McpTool[] {
    return this.tools
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.find(t => t.name === toolName)
    if (!tool) return `Unknown MCP tool: ${toolName}`

    const client = this.clients.get(tool.server)
    if (!client) return `MCP server not connected: ${tool.server}`

    const result = await client.callTool({ name: toolName, arguments: args })
    const content = result.content as Array<{ type: string; text?: string }>
    return content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text!)
      .join('\n')
  }

  async disconnectAll(): Promise<void> {
    const closings = [...this.clients.values()].map(c => c.close())
    await Promise.all(closings)
    this.clients.clear()
    this.transports.clear()
    this.tools = []
  }
}
