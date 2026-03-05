#!/usr/bin/env node
import { Command } from 'commander'
import { loadConfig, getDefaultConfigPath } from './config/loader'
import { startRepl } from './cli/repl'
import { Orchestrator } from './orchestrator/orchestrator'
import { runInstall } from './cli/install'
import { runSetup, loadEnvFile } from './cli/setup'
import path from 'path'

loadEnvFile()

const program = new Command()

program
  .name('locode')
  .description('Local-first AI coding CLI')
  .version('0.1.0')

program
  .command('chat', { isDefault: true })
  .description('Start interactive REPL session')
  .option('-c, --config <path>', 'path to locode.yaml', getDefaultConfigPath())
  .action(async (opts) => {
    const config = loadConfig(path.resolve(opts.config))
    await startRepl(config)
  })

program
  .command('run <prompt>')
  .description('Single-shot task execution')
  .option('-c, --config <path>', 'path to locode.yaml', getDefaultConfigPath())
  .action(async (prompt, opts) => {
    const config = loadConfig(path.resolve(opts.config))
    const orch = new Orchestrator(config)
    if (orch.isLocalOnly()) {
      console.error('[local-only mode] ANTHROPIC_API_KEY not set — using local LLM')
    }
    const result = await orch.process(prompt)
    console.log(result.content)
    process.exit(0)
  })

program
  .command('install [model]')
  .description('Install Ollama and pull a local LLM model')
  .option('-c, --config <path>', 'path to locode.yaml', getDefaultConfigPath())
  .action(async (model, opts) => {
    // Use model from arg, or fall back to config default
    let targetModel = model
    if (!targetModel) {
      try {
        const config = loadConfig(path.resolve(opts.config))
        targetModel = config.local_llm.model
      } catch {
        targetModel = 'qwen2.5-coder:7b'
      }
    }
    await runInstall({ model: targetModel })
  })

program
  .command('setup')
  .description('First-run setup wizard: install Ollama, pick a model, set API key')
  .action(async () => {
    await runSetup()
  })

program.parse()
