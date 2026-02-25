import { execFileSync } from 'node:child_process'

const FFPROBE_PATHS = [
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/usr/bin/ffprobe',
  'ffprobe',
]

function findFfprobe(): string {
  for (const p of FFPROBE_PATHS) {
    try {
      execFileSync(p, ['-version'], { stdio: 'ignore' })
      return p
    } catch {
      // not found at this path, try next
    }
  }
  throw new Error('ffprobe not found in any of the expected paths')
}

export function hasAudioStream(filePath: string): boolean {
  const ffprobe = findFfprobe()
  const output = execFileSync(
    ffprobe,
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath],
    { encoding: 'utf-8' },
  )
  const data = JSON.parse(output)
  return data.streams?.some((s: any) => s.codec_type === 'audio') ?? false
}
