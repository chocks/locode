import * as readline from 'readline'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { isOllamaInstalled, isOllamaRunning, installOllama, startOllama } from './install'
import { getDefaultConfigPath } from '../config/loader'

const LOCODE_DIR = path.join(os.homedir(), '.locode')
const ENV_FILE = path.join(LOCODE_DIR, '.env')

const SUGGESTED_MODELS = [
  { name: 'qwen2.5-coder:7b', description: 'Recommended — fast, great for code (default)' },
  { name: 'qwen2.5-coder:14b', description: 'More capable, needs ~10GB RAM' },
  { name: 'deepseek-coder:6.7b', description: 'Strong at code, lightweight' },
  { name: 'codellama:7b', description: 'Meta code model' },
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

export function loadEnvFile(): void {
  if (!fs.existsSync(ENV_FILE)) return
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n')
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

  // Step 4: Update locode.yaml with selected model
  console.log('\nStep 4/4: Updating config\n')
  try {
    const yamlPath = path.resolve(getDefaultConfigPath())
    if (fs.existsSync(yamlPath)) {
      const lines = fs.readFileSync(yamlPath, 'utf8').split('\n')
      let replaced = false
      const updated = lines.map(line => {
        if (!replaced && line.match(/^\s+model:/)) {
          replaced = true
          return line.replace(/model:\s*.+/, `model: ${selectedModel}`)
        }
        return line
      }).join('\n')
      fs.writeFileSync(yamlPath, updated)
      console.log(`✓ ${yamlPath} updated with model: ${selectedModel}`)
    } else {
      console.log(`⚠ No locode.yaml found at ${yamlPath} — skipping config update`)
      console.log(`  Run 'locode chat --config <path>' to use a custom config location`)
    }
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
