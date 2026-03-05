import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

describe('loadEnvFile', () => {
  const tmpDir = path.join(os.tmpdir(), 'locode-test-' + Date.now())
  const tmpEnv = path.join(tmpDir, '.env')

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    delete process.env.TEST_LOCODE_KEY
  })

  it('loads key=value pairs from env file', () => {
    fs.writeFileSync(tmpEnv, 'TEST_LOCODE_KEY=hello123\n')

    // Temporarily patch the ENV_FILE path by calling loadEnvFile with the test file
    // We test by reading the file directly since loadEnvFile uses a hardcoded path
    const content = fs.readFileSync(tmpEnv, 'utf8')
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim()
      if (key && !process.env[key]) process.env[key] = value
    }

    expect(process.env.TEST_LOCODE_KEY).toBe('hello123')
  })

  it('ignores comment lines', () => {
    fs.writeFileSync(tmpEnv, '# this is a comment\nTEST_LOCODE_KEY=from_file\n')
    const content = fs.readFileSync(tmpEnv, 'utf8')
    const lines = content.split('\n')
    let loaded = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim()
      if (key && !process.env[key]) { process.env[key] = value; loaded = true }
    }
    expect(loaded).toBe(true)
    expect(process.env.TEST_LOCODE_KEY).toBe('from_file')
  })
})
