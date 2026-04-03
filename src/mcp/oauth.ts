import fs from 'fs'
import path from 'path'
import os from 'os'
import http from 'http'
import { execFileSync } from 'child_process'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientMetadata, OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

const CALLBACK_PORT = 19274
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`

function authDir() {
  return path.join(os.homedir(), '.locode', 'mcp-auth')
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function serverPath(serverName: string) {
  return path.join(authDir(), serverName)
}

export class LocodeMcpAuthProvider implements OAuthClientProvider {
  private serverName: string

  constructor(serverName: string) {
    this.serverName = serverName
    ensureDir(serverPath(serverName))
  }

  get redirectUrl(): string {
    return REDIRECT_URI
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [REDIRECT_URI],
      client_name: 'locode',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const filePath = path.join(serverPath(this.serverName), 'client-info.json')
    if (!fs.existsSync(filePath)) return undefined
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const filePath = path.join(serverPath(this.serverName), 'client-info.json')
    fs.writeFileSync(filePath, JSON.stringify(info, null, 2))
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const filePath = path.join(serverPath(this.serverName), 'tokens.json')
    if (!fs.existsSync(filePath)) return undefined
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const filePath = path.join(serverPath(this.serverName), 'tokens.json')
    fs.writeFileSync(filePath, JSON.stringify(tokens, null, 2))
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    console.error(`[locode] Opening browser for ${this.serverName} authorization...`)
    const url = authorizationUrl.toString()
    try {
      if (process.platform === 'darwin') {
        execFileSync('open', [url])
      } else if (process.platform === 'linux') {
        execFileSync('xdg-open', [url])
      } else {
        execFileSync('cmd', ['/c', 'start', url])
      }
    } catch {
      console.error(`[locode] Please open this URL in your browser:\n${url}`)
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const filePath = path.join(serverPath(this.serverName), 'code-verifier')
    fs.writeFileSync(filePath, codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const filePath = path.join(serverPath(this.serverName), 'code-verifier')
    return fs.readFileSync(filePath, 'utf8')
  }
}

/**
 * Starts a temporary local HTTP server to receive the OAuth callback.
 * Returns a promise that resolves with the authorization code.
 */
export function waitForAuthCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }

      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Authorization failed</h1><p>You can close this tab.</p></body></html>')
        server.close()
        reject(new Error(`OAuth error: ${error}`))
        return
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Missing authorization code</h1></body></html>')
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h1>Authorized!</h1><p>You can close this tab and return to locode.</p></body></html>')
      server.close()
      resolve(code)
    })

    server.listen(CALLBACK_PORT, () => {
      console.error(`[locode] Waiting for authorization callback on port ${CALLBACK_PORT}...`)
    })

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close()
      reject(new Error('OAuth callback timed out after 2 minutes'))
    }, 120_000)
  })
}
