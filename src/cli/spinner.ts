const FRAMES = ['\u280B','\u2819','\u2839','\u2838','\u283C','\u2834','\u2826','\u2827','\u2807','\u280F']
const INTERVAL = 80

export interface SpinnerOptions {
  write?: (data: string) => void
  isTTY?: boolean
}

export interface Spinner {
  start(): void
  stop(): void
}

export function createSpinner(message: string, opts?: SpinnerOptions): Spinner {
  const write = opts?.write ?? ((data: string) => process.stderr.write(data))
  const isTTY = opts?.isTTY ?? (process.stderr.isTTY ?? false)

  let timer: ReturnType<typeof setInterval> | null = null
  let frameIndex = 0

  return {
    start() {
      if (!isTTY) {
        write(`  ${message}\n`)
        return
      }
      write('\x1b[?25l')
      timer = setInterval(() => {
        const frame = FRAMES[frameIndex % FRAMES.length]
        write(`\r\x1b[2K  \x1b[36m${frame}\x1b[0m ${message}`)
        frameIndex++
      }, INTERVAL)
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      if (isTTY) {
        write('\r\x1b[2K\x1b[?25h')
      }
    },
  }
}
