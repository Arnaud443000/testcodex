import { existsSync } from 'node:fs'
import { Config } from '@remotion/cli/config'

// Chromium déjà présent dans l'environnement de développement (évite un téléchargement).
// Ailleurs (poste Windows, Mac), Remotion télécharge son propre navigateur.
const HEADLESS = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
if (existsSync(HEADLESS)) Config.setBrowserExecutable(HEADLESS)

Config.setVideoImageFormat('jpeg')
Config.setJpegQuality(95)
Config.setCodec('h264')
Config.setCrf(16)
Config.setPixelFormat('yuv420p')
Config.setAudioCodec('aac')
Config.setOverwriteOutput(true)
