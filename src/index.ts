#!/usr/bin/env node
import { Command } from 'commander'
import { loadConfig, getDefaultConfigPath } from './config/loader'
import { startRepl } from './cli/repl'
import { Orchestrator } from './orchestrator/orchestrator'
import path from 'path'

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
    const result = await orch.process(prompt)
    console.log(result.content)
    process.exit(0)
  })

program.parse()
