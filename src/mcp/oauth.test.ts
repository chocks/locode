import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { LocodeMcpAuthProvider } from './oauth'

const TEST_HOME = path.join(os.tmpdir(), `locode-test-oauth-${Date.now()}`)

describe('LocodeMcpAuthProvider', () => {
  beforeAll(() => {
    vi.spyOn(os, 'homedir').mockReturnValue(TEST_HOME)
  })

  afterAll(() => {
    vi.restoreAllMocks()
    if (fs.existsSync(TEST_HOME)) {
      fs.rmSync(TEST_HOME, { recursive: true })
    }
  })

  it('has correct redirect URL', () => {
    const provider = new LocodeMcpAuthProvider('test-redirect')
    expect(provider.redirectUrl).toBe('http://localhost:19274/callback')
  })

  it('returns correct client metadata', () => {
    const provider = new LocodeMcpAuthProvider('test-metadata')
    const meta = provider.clientMetadata
    expect(meta.client_name).toBe('locode')
    expect(meta.redirect_uris).toContain('http://localhost:19274/callback')
    expect(meta.grant_types).toContain('authorization_code')
  })

  it('returns undefined for tokens when none saved', async () => {
    const provider = new LocodeMcpAuthProvider('test-no-tokens')
    expect(await provider.tokens()).toBeUndefined()
  })

  it('returns undefined for client info when none saved', async () => {
    const provider = new LocodeMcpAuthProvider('test-no-client')
    expect(await provider.clientInformation()).toBeUndefined()
  })

  it('persists and loads tokens', async () => {
    const provider = new LocodeMcpAuthProvider('test-tokens')
    const mockTokens = { access_token: 'abc', token_type: 'bearer' }
    await provider.saveTokens(mockTokens)
    expect(await provider.tokens()).toEqual(mockTokens)
  })

  it('persists and loads client information', async () => {
    const provider = new LocodeMcpAuthProvider('test-client-info')
    const info = { client_id: 'test-id', client_secret: 'test-secret' }
    await provider.saveClientInformation(info)
    expect(await provider.clientInformation()).toEqual(info)
  })

  it('persists and loads code verifier', async () => {
    const provider = new LocodeMcpAuthProvider('test-verifier')
    await provider.saveCodeVerifier('test-verifier-123')
    expect(await provider.codeVerifier()).toBe('test-verifier-123')
  })
})
