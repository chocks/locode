import fs from 'fs'

export async function readFileTool({ path }: { path: string }): Promise<string> {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch (err) {
    return `Error reading file: ${(err as Error).message}`
  }
}
