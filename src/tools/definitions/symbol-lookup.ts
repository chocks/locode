import type { ToolDefinition } from '../registry'
import type { CodebaseIndexer } from '../../index/indexer'

export function createSymbolLookupTool(indexer: CodebaseIndexer): ToolDefinition {
  return {
    name: 'symbol_lookup',
    description: 'Find function, class, or variable definitions by name in the codebase index. Returns symbol name, type, file, and line number.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name to search for (partial match, case-insensitive)' },
        type: { type: 'string', description: 'Filter by symbol type: function, class, method, variable, type, interface, enum' },
      },
      required: ['name'],
    },
    category: 'search',
    requiresConfirmation: false,
    async handler(args) {
      const name = String(args.name)
      const type = args.type as string | undefined

      if (!indexer.isIndexed()) {
        return {
          success: false,
          output: '',
          error: 'Codebase index not built. Run `locode index` first.',
        }
      }

      const results = indexer.symbols.search(name, type ? { type: type as never } : undefined)
      const limited = results.slice(0, 10)

      return {
        success: true,
        output: JSON.stringify(limited.map(s => ({
          name: s.name,
          type: s.type,
          file: s.file,
          line: s.lineStart,
          signature: s.signature,
          exported: s.exported,
        }))),
      }
    },
  }
}
