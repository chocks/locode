import http from 'http'
import { execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// --- Request Recording ---

export interface RecordedRequest {
  body: Record<string, unknown>
}

// --- Ollama Stub ---

let ollamaRequests: RecordedRequest[] = []
let ollamaServer: http.Server | null = null

function handleOllamaChat(body: Record<string, unknown>): object {
  const messages = body.messages as Array<{ role: string; content: string }> | undefined

  // Detect classification prompts from the Router's defaultResolver
  const isClassification = messages?.some(
    m => m.content.includes('"agent"') && m.content.includes('"confidence"')
  )
  if (isClassification) {
    return {
      message: {
        role: 'assistant',
        content: '{"agent": "local", "confidence": 0.9}',
        tool_calls: [],
      },
      prompt_eval_count: 20,
      eval_count: 5,
    }
  }

  // Detect if this is a follow-up after tool execution (messages contain tool results)
  const hasToolResults = messages?.some(m => m.role === 'tool')

  // Detect if the user prompt asks to read a file (triggers tool-call mode)
  const userPrompt = messages?.filter(m => m.role === 'user').pop()?.content ?? ''
  const wantsToolCall = /read.*file|show.*contents/i.test(userPrompt) && !hasToolResults

  if (wantsToolCall) {
    return {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'read_file', arguments: { path: 'package.json' } } }],
      },
      prompt_eval_count: 30,
      eval_count: 5,
    }
  }

  // Final response — either after tool execution or for simple prompts
  const responseText = hasToolResults
    ? 'Local LLM tool response: file contents received and analyzed'
    : 'Local LLM response'

  return {
    message: {
      role: 'assistant',
      content: responseText,
      tool_calls: [],
    },
    prompt_eval_count: 50,
    eval_count: 10,
  }
}

export function startOllamaStub(port = 9781): Promise<void> {
  return new Promise((resolve, reject) => {
    ollamaServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/chat') {
        let data = ''
        req.on('data', chunk => { data += chunk })
        req.on('end', () => {
          const body = JSON.parse(data)
          ollamaRequests.push({ body })
          const response = handleOllamaChat(body)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(response))
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    ollamaServer.listen(port, () => resolve())
    ollamaServer.on('error', reject)
  })
}

export function stopOllamaStub(): Promise<void> {
  return new Promise(resolve => {
    if (ollamaServer) {
      ollamaServer.close(() => resolve())
      ollamaServer = null
    } else {
      resolve()
    }
  })
}

export function getOllamaRequests(): RecordedRequest[] {
  return ollamaRequests
}

export function clearOllamaRequests(): void {
  ollamaRequests = []
}

// --- Anthropic Stub ---

let anthropicRequests: RecordedRequest[] = []
let anthropicServer: http.Server | null = null

export function startAnthropicStub(port = 9782): Promise<void> {
  return new Promise((resolve, reject) => {
    anthropicServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/messages') {
        let data = ''
        req.on('data', chunk => { data += chunk })
        req.on('end', () => {
          const body = JSON.parse(data)
          anthropicRequests.push({ body })

          // Detect if messages contain tool_result (follow-up after tool execution)
          const messages = body.messages as Array<{ role: string; content: unknown }> | undefined
          const hasToolResults = messages?.some(m => {
            if (m.role !== 'user') return false
            const content = m.content
            return Array.isArray(content) && content.some(
              (b: { type?: string }) => b.type === 'tool_result'
            )
          })

          // Detect if user prompt asks to analyze a file (triggers tool-call mode)
          const userMessages = messages?.filter(m => m.role === 'user' && typeof m.content === 'string') ?? []
          const userPrompt = userMessages.length > 0 ? (userMessages[userMessages.length - 1].content as string) : ''
          const wantsToolCall = /analyze.*file|debug.*file|explain.*bug/i.test(userPrompt) && !hasToolResults

          const response = wantsToolCall
            ? {
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'tool_use', id: 'toolu_e2e_01', name: 'read_file', input: { path: 'package.json' } }],
              model: 'claude-sonnet-4-6',
              usage: { input_tokens: 1500, output_tokens: 100 },
              stop_reason: 'tool_use',
            }
            : {
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: hasToolResults ? 'Claude tool response: file analyzed successfully' : 'Claude response' }],
              model: 'claude-sonnet-4-6',
              usage: { input_tokens: 1500, output_tokens: 300 },
              stop_reason: 'end_turn',
            }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'anthropic-ratelimit-tokens-remaining': '90000',
            'anthropic-ratelimit-tokens-limit': '100000',
            'anthropic-ratelimit-tokens-reset': '2026-01-01T00:00:00Z',
          })
          res.end(JSON.stringify(response))
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    anthropicServer.listen(port, () => resolve())
    anthropicServer.on('error', reject)
  })
}

export function stopAnthropicStub(): Promise<void> {
  return new Promise(resolve => {
    if (anthropicServer) {
      anthropicServer.close(() => resolve())
      anthropicServer = null
    } else {
      resolve()
    }
  })
}

export function getAnthropicRequests(): RecordedRequest[] {
  return anthropicRequests
}

export function clearAnthropicRequests(): void {
  anthropicRequests = []
}

// --- CLI Launcher ---

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
}

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'src', 'index.js')
const CONFIG_PATH = path.join(__dirname, 'locode.e2e.yaml')

export function runLocode(prompt: string, envOverrides?: Record<string, string>): Promise<RunResult> {
  return new Promise(resolve => {
    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: 'test-key-123',
      ANTHROPIC_BASE_URL: 'http://localhost:9782',
      ...envOverrides,
    }

    execFile(
      'node',
      [CLI_PATH, 'run', prompt, '-c', CONFIG_PATH],
      { env, timeout: 10000, cwd: PROJECT_ROOT },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        })
      },
    )
  })
}
