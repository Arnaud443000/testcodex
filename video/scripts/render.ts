/**
 * Rendu parallèle : sous Linux sans GPU, Chromium fait tout son compositing dans UN processus
 * GPU logiciel, quel que soit --concurrency. On lance donc plusieurs navigateurs indépendants,
 * chacun sur une tranche d'images, puis on assemble les segments (copie du flux, sans
 * réencodage) et on ajoute la bande-son.
 *
 *   npx tsx scripts/render.ts Pulse out/pulse-1080p30.mp4 [--workers=4] [--scale=2] [--fps=60] [--frames=0-299]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'

const args = process.argv.slice(2)
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const [id = 'Pulse', out = 'out/pulse-1080p30.mp4'] = args.filter((a) => !a.startsWith('--'))
const workers = Number(opt('workers', String(Math.max(1, os.cpus().length))))
const scale = Number(opt('scale', '1'))
const fps = Number(opt('fps', '30'))
const root = path.resolve(import.meta.dirname, '..')
const tmp = path.join(root, 'out', `.segments-${id}`)
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

const HEADLESS = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
const browserExecutable = existsSync(HEADLESS) ? HEADLESS : null
const inputProps = { fps }
const serveUrl = await bundle({ entryPoint: path.join(root, 'src', 'index.ts'), publicDir: path.join(root, 'public') })
const composition = await selectComposition({ serveUrl, id, inputProps, browserExecutable })
const [first, last] = opt('frames', `0-${composition.durationInFrames - 1}`).split('-').map(Number)
const total = last - first + 1
const size = Math.ceil(total / workers)
const t0 = Date.now()
const done = new Array(workers).fill(0)
const segments: string[] = []
let lastLog = 0

await Promise.all(
  Array.from({ length: workers }, async (_, w) => {
    const from = first + w * size
    const to = Math.min(last, from + size - 1)
    if (from > to) return
    const file = path.join(tmp, `seg-${String(w).padStart(2, '0')}.mp4`)
    segments[w] = file
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: 'h264',
      crf: 16,
      pixelFormat: 'yuv420p',
      imageFormat: 'jpeg',
      jpegQuality: 95,
      scale,
      muted: true,
      frameRange: [from, to],
      concurrency: 1,
      browserExecutable,
      outputLocation: file,
      onProgress: ({ renderedFrames }) => {
        done[w] = renderedFrames
        const sum = done.reduce((a, b) => a + b, 0)
        const el = (Date.now() - t0) / 1000
        if (el - lastLog > 30) {
          lastLog = el
          console.log(`${sum}/${total} images · ${el.toFixed(0)} s · reste ≈ ${((el / Math.max(1, sum)) * (total - sum)).toFixed(0)} s`)
        }
      },
    })
  }),
)

// Assemblage sans réencodage, puis ajout de la bande-son (AAC), calée sur la première image rendue.
const list = path.join(tmp, 'list.txt')
writeFileSync(list, segments.filter(Boolean).map((s) => `file '${s}'`).join('\n'))
const video = path.join(tmp, 'video.mp4')
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video])
const audio = path.join(root, 'public', 'audio', 'pulse.wav')
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-i', video,
  '-ss', String(first / composition.fps), '-i', audio,
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart',
  path.resolve(root, out),
])
rmSync(tmp, { recursive: true, force: true })
console.log(`${out} : ${total} images en ${((Date.now() - t0) / 1000).toFixed(0)} s`)
