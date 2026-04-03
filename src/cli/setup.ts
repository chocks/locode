import * as readline from 'readline'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { isOllamaInstalled, isOllamaRunning, installOllama, startOllama } from './install'

const LOCODE_DIR = path.join(os.homedir(), '.locode')
const ENV_FILE = path.join(LOCODE_DIR, '.env')

const CONFIG_TEMPLATE = (model: string) => `\
local_llm:
  provider: ollama
  model: ${model}
  base_url: http://localhost:11434

claude:
  model: claude-sonnet-4-6
  token_threshold: 0.99

routing:
  rules:
    - pattern: "find|grep|search|ls|cat|read|explore|where is"
      agent: local
    - pattern: "git log|git diff|git status|git blame"
      agent: local
    - pattern: "refactor|architect|design|explain|review|generate|write tests"
      agent: claude
  ambiguous_resolver: local
  escalation_threshold: 0.7

context:
  handoff: summary
  max_summary_tokens: 500

token_tracking:
  enabled: true
  log_file: ~/.locode/usage.log
`

export function writeGlobalConfig(model: string, locodeDir: string = LOCODE_DIR): void {
  fs.mkdirSync(locodeDir, { recursive: true })
  const yamlPath = path.join(locodeDir, 'locode.yaml')
  if (!fs.existsSync(yamlPath)) {
    fs.writeFileSync(yamlPath, CONFIG_TEMPLATE(model))
    return
  }
  // Update the local_llm.model line — look for model: under the local_llm section
  const content = fs.readFileSync(yamlPath, 'utf8')
  const updated = content.replace(
    /(local_llm:\s*\n(?:\s+\w+:.*\n)*?\s+)model:\s*.+/,
    `$1model: ${model}`,
  )
  fs.writeFileSync(yamlPath, updated)
}

const SUGGESTED_MODELS = [
  { name: 'qwen3:8b', description: 'Recommended — fast, excellent for code (default)' },
  { name: 'qwen3:14b', description: 'More capable, needs ~10GB RAM' },
  { name: 'qwen3:4b', description: 'Lightweight, very fast' },
  { name: 'llama3.2:3b', description: 'General purpose, very fast' },
]

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

function askMasked(question: string): Promise<string> {
  return new Promise(resolve => {
    process.stdout.write(question)
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let input = ''
    stdin.on('data', function handler(char: string) {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.removeListener('data', handler)
        process.stdout.write('\n')
        resolve(input)
      } else if (char === '\u0003') {
        process.exit()
      } else if (char === '\u007f') {
        if (input.length > 0) {
          input = input.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else {
        input += char
        process.stdout.write('*')
      }
    })
  })
}

export function loadEnvFile(envPath: string = ENV_FILE): void {
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (key && !process.env[key]) {
      process.env[key] = value
    }
  }
}

function saveApiKey(key: string): void {
  fs.mkdirSync(LOCODE_DIR, { recursive: true })
  const content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : ''
  // Remove existing ANTHROPIC_API_KEY line if present
  const filtered = content.split('\n').filter(l => !l.startsWith('ANTHROPIC_API_KEY=')).join('\n')
  const updated = filtered.trimEnd() + (filtered.trim() ? '\n' : '') + `ANTHROPIC_API_KEY=${key}\n`
  fs.writeFileSync(ENV_FILE, updated, { mode: 0o600 })
}

export async function runSetup(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  console.log('\n╔════════════════════════════════╗')
  console.log('║      Locode Setup Wizard       ║')
  console.log('╚════════════════════════════════╝\n')

  // Step 1: Ollama
  console.log('Step 1/4: Ollama\n')
  if (!isOllamaInstalled()) {
    const answer = await ask(rl, 'Ollama is not installed. Install it now? [Y/n] ')
    if (answer.toLowerCase() === 'n') {
      console.log('Skipping. Install Ollama from https://ollama.com and re-run setup.')
      rl.close()
      return
    }
    installOllama()
  } else {
    console.log('✓ Ollama is installed')
  }

  if (!isOllamaRunning()) {
    startOllama()
  }
  console.log('✓ Ollama daemon is running\n')

  // Step 2: Model selection
  console.log('Step 2/4: Choose a local LLM model\n')
  SUGGESTED_MODELS.forEach((m, i) => {
    const marker = i === 0 ? ' (default)' : ''
    console.log(`  ${i + 1}. ${m.name}${marker}`)
    console.log(`     ${m.description}`)
  })
  console.log()
  const modelAnswer = await ask(rl, `Select model [1-${SUGGESTED_MODELS.length}] or type a custom name (default: 1): `)

  let selectedModel: string
  const modelNum = parseInt(modelAnswer.trim())
  if (!modelAnswer.trim() || (modelNum >= 1 && modelNum <= SUGGESTED_MODELS.length)) {
    selectedModel = SUGGESTED_MODELS[(modelNum || 1) - 1].name
  } else {
    selectedModel = modelAnswer.trim()
  }

  console.log(`\nPulling ${selectedModel}...`)
  try {
    execFileSync('ollama', ['pull', selectedModel], { stdio: 'inherit' })
    console.log(`✓ ${selectedModel} is ready\n`)
  } catch {
    console.error(`Failed to pull ${selectedModel}. You can retry with: locode install ${selectedModel}`)
  }

  // Step 3: Anthropic API key
  console.log('Step 3/4: Anthropic API key (optional)\n')
  console.log('Required for complex tasks routed to Claude.')
  console.log('Get yours at https://console.anthropic.com\n')

  const existingKey = process.env.ANTHROPIC_API_KEY
  if (existingKey) {
    const masked = existingKey.slice(0, 8) + '...' + existingKey.slice(-4)
    const reuse = await ask(rl, `API key already set (${masked}). Keep it? [Y/n] `)
    if (reuse.toLowerCase() === 'n') {
      rl.close()
      const newKey = await askMasked('Enter new Anthropic API key (or press Enter to skip): ')
      if (newKey.trim()) {
        saveApiKey(newKey.trim())
        process.env.ANTHROPIC_API_KEY = newKey.trim()
        console.log(`✓ API key saved to ${ENV_FILE}`)
      }
    } else {
      console.log('✓ Keeping existing API key')
    }
  } else {
    rl.close()
    const apiKey = await askMasked('Enter Anthropic API key (or press Enter to skip): ')
    if (apiKey.trim()) {
      saveApiKey(apiKey.trim())
      process.env.ANTHROPIC_API_KEY = apiKey.trim()
      console.log(`✓ API key saved to ${ENV_FILE}`)
    } else {
      console.log('⚠ Skipped — Locode will run in local-only mode')
    }
  }

  // Step 4: Write global config to ~/.locode/locode.yaml
  console.log('\nStep 4/4: Updating config\n')
  try {
    writeGlobalConfig(selectedModel)
    const globalYamlPath = path.join(LOCODE_DIR, 'locode.yaml')
    console.log(`✓ ${globalYamlPath} updated with model: ${selectedModel}`)
  } catch (err) {
    console.error(`⚠ Could not update config: ${(err as Error).message}`)
  }

  console.log('\n╔════════════════════════════════╗')
  console.log('║         Setup Complete!        ║')
  console.log('╚════════════════════════════════╝\n')
  console.log(`  Local model : ${selectedModel}`)
  console.log(`  Claude      : ${process.env.ANTHROPIC_API_KEY ? 'enabled' : 'disabled (local-only mode)'}`)
  console.log(`  Config file : ${ENV_FILE}\n`)
  console.log("Run 'locode' to start!\n")

  try { rl.close() } catch { /* already closed */ }
}
