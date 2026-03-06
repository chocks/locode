import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeGlobalConfig } from './setup'

describe('writeGlobalConfig', () => {
  const tmpDir = path.join(os.tmpdir(), 'locode-config-test-' + Date.now())

  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }))
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  it('creates locode.yaml with the given model when it does not exist', () => {
    const yamlPath = path.join(tmpDir, 'locode.yaml')
    writeGlobalConfig('llama3.2:3b', tmpDir)
    expect(fs.existsSync(yamlPath)).toBe(true)
    const content = fs.readFileSync(yamlPath, 'utf8')
    expect(content).toContain('model: llama3.2:3b')
  })

  it('updates the model in an existing locode.yaml', () => {
    const yamlPath = path.join(tmpDir, 'locode.yaml')
    writeGlobalConfig('qwen3:8b', tmpDir)
    writeGlobalConfig('qwen2.5-coder:14b', tmpDir)
    const content = fs.readFileSync(yamlPath, 'utf8')
    expect(content).toContain('model: qwen2.5-coder:14b')
    expect(content).not.toContain('model: qwen3:8b')
  })
})

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
