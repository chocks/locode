import fs from 'fs'
import yaml from 'js-yaml'
import { ConfigSchema, Config } from './schema'

export function loadConfig(filePath: string): Config {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: config file not found at ${filePath}`)
    console.error('Run `locode setup` to get started.')
    process.exit(1)
  }
  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = yaml.load(raw)
  return ConfigSchema.parse(parsed)
}

export function getDefaultConfigPath(): string {
  return process.env.LOCODE_CONFIG || 'locode.yaml'
}
