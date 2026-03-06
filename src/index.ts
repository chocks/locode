#!/usr/bin/env node
import { Command } from 'commander'
import { loadConfig, getDefaultConfigPath } from './config/loader'
import { startRepl } from './cli/repl'
import { Orchestrator } from './orchestrator/orchestrator'
import { runInstall } from './cli/install'
import { runSetup, loadEnvFile } from './cli/setup'
import { runBenchmark, resolvePrompts } from './cli/benchmark'
import path from 'path'
import pkgJson from '../package.json'
const { version } = pkgJson

loadEnvFile()

const program = new Command()

program
  .name('locode')
  .description('Local-first AI coding CLI')
  .version(version)

program
  .command('chat', { isDefault: true })
  .description('Start interactive REPL session')
  .option('-c, --config <path>', 'path to locode.yaml', getDefaultConfigPath())
  .option('--claude-only', 'route all tasks to Claude')
  .option('--local-only', 'route all tasks to local LLM')
  .action(async (opts) => {
    const config = loadConfig(path.resolve(opts.config))
    await startRepl(config, { claudeOnly: opts.claudeOnly, localOnly: opts.localOnly })
  })

program
  .command('run <prompt>')
  .description('Single-shot task execution')
  .option('-c, --config <path>', 'path to locode.yaml', getDefaultConfigPath())
  .option('--claude-only', 'route all tasks to Claude')
  .option('--local-only', 'route all tasks to local LLM')
  .action(async (prompt, opts) => {
    const config = loadConfig(path.resolve(opts.config))
    const orch = new Orchestrator(config, undefined, undefined, { claudeOnly: opts.claudeOnly, localOnly: opts.localOnly })
    if (orch.isLocalOnly()) console.error('[local-only mode] Using local LLM')
    if (orch.isClaudeOnly()) console.error('[claude-only mode] Using Claude')
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

program
  .command('benchmark')
  .description('Benchmark token cost across hybrid, claude-only, and local-only modes')
  .option('-p, --prompt <prompt>', 'prompt to benchmark (repeatable)', (val: string, acc: string[]) => [...acc, val], [] as string[])
  .option('-t, --task <file>', 'path to a markdown task file to use as the prompt')
  .option('-o, --output <path>', 'path to save the HTML report', 'locode-benchmark-report.html')
  .option('--no-open', 'do not auto-open the report in browser')
  .option('-c, --config <path>', 'path to locode.yaml', getDefaultConfigPath())
  .action(async (opts) => {
    const config = loadConfig(path.resolve(opts.config))
    const prompts = resolvePrompts({ prompt: opts.prompt, task: opts.task })
    await runBenchmark(config, {
      prompts,
      output: path.resolve(opts.output),
      open: opts.open,
    })
  })

program.parse()
