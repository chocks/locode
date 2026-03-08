import { execSync, execFileSync, spawn } from 'child_process'
import os from 'os'

export interface InstallOptions {
  model: string
}

export function isOllamaInstalled(): boolean {
  try {
    execFileSync('which', ['ollama'], { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

export function isOllamaRunning(): boolean {
  try {
    execFileSync('ollama', ['list'], { encoding: 'utf8', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

export function installOllama(): void {
  const platform = os.platform()
  console.log('Ollama not found. Installing...')

  if (platform === 'darwin') {
    // Try Homebrew first
    try {
      execFileSync('which', ['brew'], { encoding: 'utf8' })
      console.log('Installing via Homebrew...')
      execSync('brew install ollama', { stdio: 'inherit' })
      return
    } catch {
      // brew not available
    }
    console.log('Homebrew not found. Installing via official install script...')
    execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit' })
    return
  }

  if (platform === 'linux') {
    console.log('Installing via official install script...')
    execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit' })
    return
  }

  // Windows or other
  console.log('Please install Ollama manually:')
  console.log('  https://ollama.com/download')
  process.exit(1)
}

export function startOllama(): void {
  const platform = os.platform()
  console.log('Starting Ollama daemon...')
  if (platform === 'darwin' || platform === 'linux') {
    // Start in background, detached
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    // Give it a moment to start
    execSync('sleep 2')
  }
}

export async function runInstall(options: InstallOptions): Promise<void> {
  // 1. Check / install Ollama
  if (!isOllamaInstalled()) {
    installOllama()
  } else {
    console.log('✓ Ollama is installed')
  }

  // 2. Check / start daemon
  if (!isOllamaRunning()) {
    startOllama()
    // Verify it started
    if (!isOllamaRunning()) {
      console.error('Failed to start Ollama daemon. Run `ollama serve` manually.')
      process.exit(1)
    }
  }
  console.log('✓ Ollama daemon is running')

  // 3. Pull the model
  console.log(`Pulling model: ${options.model}`)
  console.log('This may take a few minutes on first run...\n')
  try {
    execFileSync('ollama', ['pull', options.model], { stdio: 'inherit' })
    console.log(`\n✓ Model ${options.model} is ready`)
    console.log(`\nRun 'locode' to start chatting!`)
  } catch (err) {
    console.error(`Failed to pull model: ${(err as Error).message}`)
    process.exit(1)
  }
}
