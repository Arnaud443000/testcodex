/**
 * Écrit les tuiles de grain (bruit gaussien en niveaux de gris, PNG 256×256) dans public/grain.
 * Une texture précalculée coûte bien moins cher au rendu qu'un feTurbulence par image.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const SIZE = 256
const TILES = 6
const out = new URL('../public/grain/', import.meta.url)
mkdirSync(out, { recursive: true })

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

let seed = 1234567
const rand = () => {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return ((seed >>> 0) % 1_000_000) / 1_000_000
}
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand())

for (let t = 0; t < TILES; t++) {
  const raw = Buffer.alloc((SIZE + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE + 1)] = 0 // filtre « none »
    for (let x = 0; x < SIZE; x++) raw[y * (SIZE + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(128 + gauss() * 42)))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // profondeur
  ihdr[9] = 0 // niveaux de gris
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(new URL(`grain-${t}.png`, out), png)
}
console.log(`grain : ${TILES} tuiles écrites`)
