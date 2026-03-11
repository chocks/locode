import fs from 'fs'
import path from 'path'

const PROJECT_ROOT = process.cwd()

export async function writeFileTool({ path: filePath, content }: { path: string; content: string }): Promise<string> {
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(PROJECT_ROOT)) {
    return `[blocked] Write to "${resolved}" is outside the project root.`
  }
  try {
    const dir = path.dirname(resolved)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(resolved, content, 'utf8')
    return `Written ${content.length} bytes to ${resolved}`
  } catch (err) {
    return `Error writing file: ${(err as Error).message}`
  }
}
