/**
 * Bande-son du film, synthétisée en code (Remotion ne capture pas Web Audio) et écrite en
 * WAV 48 kHz stéréo 16 bits dans public/audio/pulse.wav. Tous les instants viennent de
 * src/timeline.ts (repères CUES et nappe PAD) : la vidéo et le son partagent le même rythme.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { BEAT, CUES, DURATION_SEC, PAD, beatToSec, type Cue } from '../src/timeline'

const SR = 48000
const N = Math.round(DURATION_SEC * SR)
const L = new Float32Array(N)
const R = new Float32Array(N)
const sendL = new Float32Array(N) // départ réverbération
const sendR = new Float32Array(N)

// ------------------------------------------------------------------ outils

let seed = 0x9e3779b9
const rand = () => {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return ((seed >>> 0) / 4294967296) * 2 - 1
}
const idx = (sec: number) => Math.round(sec * SR)
/** Panoramique à puissance constante, p ∈ [-1, 1]. */
const panGains = (p: number) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)]

function put(i: number, v: number, pan = 0, send = 0) {
  if (i < 0 || i >= N) return
  const [gl, gr] = panGains(pan)
  L[i] += v * gl
  R[i] += v * gr
  sendL[i] += v * gl * send
  sendR[i] += v * gr * send
}

/** Filtre passe-bande d'état variable (Chamberlin), réglable échantillon par échantillon. */
function svf() {
  let low = 0
  let band = 0
  return (x: number, fc: number, q: number) => {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR)
    low += f * band
    const high = x - low - q * band
    band += f * high
    return { low, band, high }
  }
}

// ------------------------------------------------------------------ voix

/** Battement « lub-dub » : sinus sub-grave à hauteur descendante, transitoire et 2e harmonique saturée (audible sur petits haut-parleurs). */
function heart(t0: number, gain = 1) {
  const hit = (start: number, f0: number, f1: number, amp: number, dec: number) => {
    const i0 = idx(start)
    let ph = 0
    const len = Math.round(SR * dec * 7)
    for (let k = 0; k < len; k++) {
      const t = k / SR
      const f = f1 + (f0 - f1) * Math.exp(-t / 0.04)
      ph += (2 * Math.PI * f) / SR
      const env = Math.min(1, t / 0.004) * Math.exp(-t / dec)
      const body = Math.sin(ph) + 0.35 * Math.tanh(2.5 * Math.sin(2 * ph))
      const click = t < 0.006 ? rand() * (1 - t / 0.006) * 0.25 : 0
      put(i0 + k, (body * env + click) * amp * gain, 0, 0.12)
    }
  }
  hit(t0, 70, 44, 0.9, 0.085)
  hit(t0 + 0.22 * BEAT, 82, 52, 0.62, 0.065)
}

function riser(t0: number, len: number, gain = 1) {
  const i0 = idx(t0)
  const n = Math.round(len * SR)
  const fl = svf()
  const fr = svf()
  let ph = 0
  for (let k = 0; k < n; k++) {
    const p = k / n
    const fc = 300 * Math.pow(20, p)
    const env = p * p * (k > n - 240 ? (n - k) / 240 : 1)
    const a = fl(rand(), fc, 0.35).band
    const b = fr(rand(), fc * 1.07, 0.35).band
    ph += (2 * Math.PI * (110 * Math.pow(8, p))) / SR
    const tone = Math.sin(ph) * 0.18
    const v = gain * env * 0.55
    if (i0 + k < N) {
      L[i0 + k] += (a + tone) * v
      R[i0 + k] += (b + tone) * v
      sendL[i0 + k] += a * v * 0.3
      sendR[i0 + k] += b * v * 0.3
    }
  }
}

function whoosh(t0: number, gain = 1, pan = 0) {
  const i0 = idx(t0 - 0.12) // le souffle culmine sur la coupe
  const n = Math.round(0.55 * SR)
  const f = svf()
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const fc = 4200 * Math.exp(-t * 4.5) + 350
    const env = t < 0.12 ? (t / 0.12) ** 2 : Math.exp(-(t - 0.12) / 0.12)
    const v = f(rand(), fc, 0.6).band * env * gain * 0.9
    put(i0 + k, v, pan * (1 - 2 * Math.min(1, t / 0.4)), 0.25)
  }
}

function click(t0: number, gain = 1, pitch = 1) {
  const i0 = idx(t0)
  const n = Math.round(0.05 * SR)
  let ph = 0
  for (let k = 0; k < n; k++) {
    const t = k / SR
    ph += (2 * Math.PI * 2300 * pitch) / SR
    const v = (Math.sin(ph) * Math.exp(-t / 0.012) + (t < 0.002 ? rand() * 0.6 : 0)) * gain * 0.32
    put(i0 + k, v, 0.15 * Math.sin(pitch * 9), 0.15)
  }
}

function hat(t0: number, gain = 1) {
  const i0 = idx(t0)
  const n = Math.round(0.05 * SR)
  const f = svf()
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const v = f(rand(), 9000, 0.4).high * Math.exp(-t / 0.014) * gain * 0.35
    put(i0 + k, v, 0.25, 0.05)
  }
}

function glitch(t0: number, s: number, gain = 1) {
  const i0 = idx(t0)
  const n = Math.round((0.035 + ((s * 37) % 5) * 0.008) * SR)
  const freq = 180 + ((s * 97) % 11) * 90
  let hold = 0
  for (let k = 0; k < n; k++) {
    const t = k / SR
    if (k % (6 + (s % 5) * 3) === 0) hold = rand() // décimation
    const sq = Math.sign(Math.sin(2 * Math.PI * freq * t))
    const v = (hold * 0.6 + sq * 0.35) * Math.exp(-t / 0.03) * gain * 0.55
    put(i0 + k, v, ((s % 3) - 1) * 0.5, 0.08)
  }
}

function impact(t0: number, gain = 1) {
  const i0 = idx(t0)
  const n = Math.round(2.4 * SR)
  const f = svf()
  let ph = 0
  for (let k = 0; k < n; k++) {
    const t = k / SR
    ph += (2 * Math.PI * (30 + 50 * Math.exp(-t / 0.08))) / SR
    const sub = Math.sin(ph) * Math.exp(-t / 0.7) * Math.min(1, t / 0.003)
    const nz = f(rand(), 900 + 3000 * Math.exp(-t / 0.05), 0.7).low * Math.exp(-t / 0.35)
    put(i0 + k, (sub * 1.1 + nz * 0.8) * gain, 0, 0.55)
  }
}

function lock(t0: number) {
  const i0 = idx(t0)
  const n = Math.round(0.5 * SR)
  let a = 0
  let b = 0
  let c = 0
  for (let k = 0; k < n; k++) {
    const t = k / SR
    a += (2 * Math.PI * 3150) / SR
    b += (2 * Math.PI * 5230) / SR
    c += (2 * Math.PI * (95 * Math.exp(-t / 0.05) + 45)) / SR
    const metal = (Math.sin(a) * 0.6 + Math.sin(b) * 0.4) * Math.exp(-t / 0.035)
    const thump = Math.sin(c) * Math.exp(-t / 0.16)
    const tick = t < 0.003 ? rand() : 0
    put(i0 + k, (metal * 0.45 + thump * 0.9 + tick * 0.5) * 0.9, 0, 0.4)
  }
}

function bell(t0: number, f: number, gain: number, dec = 1.8) {
  const i0 = idx(t0)
  const n = Math.round(dec * 4 * SR)
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2.76, 0.45, 0.6],
    [5.4, 0.25, 0.35],
    [8.93, 0.12, 0.2],
  ]
  for (let k = 0; k < n; k++) {
    const t = k / SR
    let v = 0
    for (const [m, a, d] of partials) v += Math.sin(2 * Math.PI * f * m * t) * a * Math.exp(-t / (dec * d))
    put(i0 + k, v * gain * 0.16 * Math.min(1, t / 0.002), 0.2, 0.6)
  }
}

function chime(t0: number, gain = 1) {
  bell(t0, 587.33, gain) // ré
  bell(t0 + 0.06, 880, gain * 0.7) // la
  bell(t0 + 0.12, 1174.66, gain * 0.45) // ré aigu
}

function shimmer(t0: number, len: number) {
  const i0 = idx(t0)
  const n = Math.round(len * SR)
  const freqs = [1174.66, 1760, 2349.32, 2637.02]
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const env = Math.min(1, t / 1.2) * Math.min(1, (len - t) / 0.8)
    let v = 0
    freqs.forEach((f, j) => (v += Math.sin(2 * Math.PI * f * t + j) * (0.5 + 0.5 * Math.sin(2 * Math.PI * (0.7 + j * 0.31) * t))))
    put(i0 + k, v * env * 0.018, Math.sin(t * 0.9) * 0.6, 0.7)
  }
}

/** Nappe : 3 scies désaccordées par note, passe-bas qui respire. */
function pad(t0: number, len: number, root: number, chord: number[], gain: number) {
  const i0 = idx(t0)
  const n = Math.round((len + 1.4) * SR)
  const voices = chord.flatMap((st) => [-7, 0, 7].map((cents) => root * Math.pow(2, st / 12 + cents / 1200)))
  const phases = voices.map((_, j) => (j * 0.137) % 1)
  let lpL = 0
  let lpR = 0
  for (let k = 0; k < n; k++) {
    const t = k / SR
    const env = Math.min(1, t / 0.9) * (t > len ? Math.exp(-(t - len) / 0.45) : 1)
    let l = 0
    let r = 0
    voices.forEach((f, j) => {
      phases[j] = (phases[j] + f / SR) % 1
      const saw = 2 * phases[j] - 1
      if (j % 3 === 0) l += saw
      else if (j % 3 === 2) r += saw
      else {
        l += saw * 0.5
        r += saw * 0.5
      }
    })
    const fc = 700 + 450 * Math.sin(2 * Math.PI * 0.15 * (t0 + t))
    const a = 1 - Math.exp((-2 * Math.PI * fc) / SR)
    lpL += a * (l - lpL)
    lpR += a * (r - lpR)
    const v = (env * gain * 0.06) / Math.sqrt(voices.length)
    if (i0 + k < N) {
      L[i0 + k] += lpL * v
      R[i0 + k] += lpR * v
      sendL[i0 + k] += lpL * v * 0.5
      sendR[i0 + k] += lpR * v * 0.5
    }
  }
}

// ------------------------------------------------------------------ partition

const silences: [number, number][] = []
for (const c of CUES as Cue[]) {
  const t = beatToSec(c.beat)
  switch (c.type) {
    case 'heart':
      heart(t, c.gain)
      break
    case 'riser':
      riser(t, beatToSec(c.length), c.gain)
      break
    case 'whoosh':
      whoosh(t, c.gain, c.pan)
      break
    case 'click':
      click(t, c.gain, c.pitch)
      break
    case 'hat':
      hat(t, c.gain)
      break
    case 'glitch':
      glitch(t, c.seed, c.gain)
      break
    case 'impact':
      impact(t, c.gain)
      break
    case 'lock':
      lock(t)
      break
    case 'chime':
      chime(t, c.gain)
      break
    case 'shimmer':
      shimmer(t, beatToSec(c.length))
      break
    case 'silence':
      silences.push([t, beatToSec(c.length)])
      break
  }
}
for (const p of PAD) pad(beatToSec(p.beat), beatToSec(p.length), p.root, p.chord, p.gain)

// ------------------------------------------------------------------ réverbération (Schroeder)

function reverb(input: Float32Array, spread: number) {
  const out = new Float32Array(N)
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => Math.round(((d + spread) * SR) / 44100))
  for (const d of combs) {
    const buf = new Float32Array(d)
    let p = 0
    let damp = 0
    for (let i = 0; i < N; i++) {
      const y = buf[p]
      damp = y * 0.6 + damp * 0.4
      buf[p] = input[i] + damp * 0.84
      out[i] += y / combs.length
      p = (p + 1) % d
    }
  }
  for (const d of [556, 441, 341, 225].map((x) => Math.round(((x + spread) * SR) / 44100))) {
    const buf = new Float32Array(d)
    let p = 0
    for (let i = 0; i < N; i++) {
      const bufOut = buf[p]
      const y = -out[i] + bufOut
      buf[p] = out[i] + bufOut * 0.5
      out[i] = y
      p = (p + 1) % d
    }
  }
  return out
}
const wetL = reverb(sendL, 0)
const wetR = reverb(sendR, 23)

// ------------------------------------------------------------------ mixage, silences, limiteur

const mixL = new Float32Array(N)
const mixR = new Float32Array(N)
for (let i = 0; i < N; i++) {
  mixL[i] = L[i] + wetL[i] * 0.55
  mixR[i] = R[i] + wetR[i] * 0.55
}
// Coupe sèche au noir : silence total (queues de réverbération comprises), fondus de 3 ms.
for (const [t, len] of silences) {
  const a = idx(t)
  const b = idx(t + len)
  const f = Math.round(0.003 * SR)
  for (let i = a - f; i < b + f && i < N; i++) {
    if (i < 0) continue
    const g = i < a ? (a - i) / f : i >= b ? (i - b) / f : 0
    mixL[i] *= g
    mixR[i] *= g
  }
}
// Fondu final (dernier écho).
const fadeStart = idx(DURATION_SEC - 0.5)
for (let i = fadeStart; i < N; i++) {
  const g = Math.cos(((i - fadeStart) / (N - fadeStart)) * (Math.PI / 2))
  mixL[i] *= g
  mixR[i] *= g
}
// Saturation douce puis normalisation à −1 dBFS.
const drive = 1.4
let peak = 0
for (let i = 0; i < N; i++) {
  mixL[i] = Math.tanh(mixL[i] * drive) / Math.tanh(drive)
  mixR[i] = Math.tanh(mixR[i] * drive) / Math.tanh(drive)
  peak = Math.max(peak, Math.abs(mixL[i]), Math.abs(mixR[i]))
}
const norm = Math.pow(10, -1 / 20) / (peak || 1)

// ------------------------------------------------------------------ WAV

const data = Buffer.alloc(N * 4)
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixL[i] * norm)) * 32767), i * 4)
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixR[i] * norm)) * 32767), i * 4 + 2)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + data.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20) // PCM
header.writeUInt16LE(2, 22) // stéréo
header.writeUInt32LE(SR, 24)
header.writeUInt32LE(SR * 4, 28)
header.writeUInt16LE(4, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(data.length, 40)

const dir = new URL('../public/audio/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL('pulse.wav', dir), Buffer.concat([header, data]))
console.log(`audio : ${DURATION_SEC} s, ${CUES.length} repères, crête avant normalisation ${(20 * Math.log10(peak)).toFixed(1)} dBFS`)
