import { ToolRegistry } from '../registry'
import { readFileDefinition } from './read-file'
import { runCommandDefinition } from './run-command'
import { gitQueryDefinition } from './git-query'
import { writeFileDefinition } from './write-file'
import { editFileDefinition } from './edit-file'
import { listFilesDefinition } from './list-files'

export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(readFileDefinition)
  registry.register(runCommandDefinition)
  registry.register(gitQueryDefinition)
  registry.register(writeFileDefinition)
  registry.register(editFileDefinition)
  registry.register(listFilesDefinition)
  return registry
}
