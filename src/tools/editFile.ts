import fs from 'fs'

export async function editFileTool({ path: filePath, old_string, new_string }: { path: string; old_string: string; new_string: string }): Promise<string> {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    return `Error reading file: ${(err as Error).message}`
  }

  const occurrences = content.split(old_string).length - 1
  if (occurrences === 0) {
    return `old_string not found in ${filePath}`
  }
  if (occurrences > 1) {
    return `old_string matches multiple times (${occurrences}) in ${filePath}. Provide more context to make it unique.`
  }

  const updated = content.replace(old_string, new_string)
  try {
    fs.writeFileSync(filePath, updated, 'utf8')
    return `Applied edit to ${filePath}`
  } catch (err) {
    return `Error writing file: ${(err as Error).message}`
  }
}
