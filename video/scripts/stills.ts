/**
 * Rend des images clés pour relecture : `npm run stills -- 3.2 10 20` (secondes),
 * `--vertical` pour la version 9:16. Sans argument : une image toutes les 10 s + temps forts.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const args = process.argv.slice(2)
const vertical = args.includes('--vertical')
const noBlur = args.includes('--fast')
const secs = args.filter((a) => !a.startsWith('--')).map(Number)
const list = secs.length ? secs : [0, 10, 20, 30, 40, 44.5]
const id = vertical ? 'PulseVertical' : 'Pulse'
const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'out', 'stills')
mkdirSync(outDir, { recursive: true })

const browserExecutable = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
const serveUrl = await bundle({ entryPoint: path.join(root, 'src', 'index.ts'), publicDir: path.join(root, 'public') })
const composition = await selectComposition({ serveUrl, id, inputProps: { fps: 30 }, browserExecutable })
for (const s of list) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(s * composition.fps))
  const output = path.join(outDir, `${vertical ? 'v' : 'h'}-${s.toFixed(2).padStart(5, '0')}s.png`)
  const t = Date.now()
  await renderStill({ serveUrl, composition, frame, output, inputProps: { fps: 30, noBlur }, browserExecutable, imageFormat: 'png' })
  console.log(`${output}  (${Date.now() - t} ms)`)
}
