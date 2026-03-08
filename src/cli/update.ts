import { execFileSync } from 'child_process'

export async function runUpdate(): Promise<void> {
  console.log('Updating locode...')
  try {
    execFileSync('npm', ['update', '-g', '@chocks-dev/locode'], { stdio: 'inherit' })
    console.log('✓ locode updated successfully')
  } catch (err) {
    console.error(`Update failed: ${(err as Error).message}`)
    console.error('Try running manually: npm update -g @chocks-dev/locode')
  }
}
