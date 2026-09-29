import type { CardModel, CardOutcome } from '../types/tradeCard'
import { CARD_SIZES } from './tradeCard'

/**
 * Dessin de la carte de trade (lot 24). Choix : canvas 2D dans l'interface, pas de SVG.
 * Un SVG rasterisé (image) ne peut pas utiliser la police Inter embarquée dans la page, alors
 * qu'un canvas la lit une fois chargée (`ensureCardFonts`). Le PNG sort de `canvas.toBlob`.
 * Deux étapes : `planCard` (mise en page pure, testée sans canvas) puis `paintCard` (peinture).
 */

/** Tokens de la charte v2.0 (recopiés ici car un canvas ne lit pas les classes Tailwind ; `tradeCardRender.test.ts` les compare à tailwind.config.js et à index.css). */
export const CARD_TOKENS = {
  bgDeep: '#080B20',
  bg: '#0B0E27',
  blue: '#4A5FD9',
  violet: '#8B7FE8',
  tx: '#F5F2EC',
  tx2: '#9AA0C0',
  tx3: '#6B7290',
  txAccent: '#A79DF2',
  gain: '#5FCB9E',
  gainBg: '#16302A',
  loss: '#F0776B',
  lossBg: '#3A211E',
  neutral: '#B9BECF',
  neutralBg: '#20233A',
  hairline: 'rgba(255,255,255,.08)',
  glassBorder: 'rgba(255,255,255,.10)',
  glass: 'rgba(255,255,255,.055)',
} as const

/** Rayons de la charte (24 / 16 px) doublés : la carte fait 1080 px de large, pas 540. */
const U = 2
const R_INNER = 16 * U
const FONT_STACK = 'Inter, system-ui, "Segoe UI", sans-serif'

export type Measure = (text: string, font: string) => number

export const cardFont = (weight: number, size: number) => `${weight} ${Math.round(size)}px ${FONT_STACK}`

// ---------- texte : ajustement, coupe, chiffres tabulaires ----------

export function ellipsize(measure: Measure, text: string, font: string, maxWidth: number): string {
  if (measure(text, font) <= maxWidth) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(`${text.slice(0, mid).trimEnd()}…`, font) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return `${text.slice(0, lo).trimEnd()}…`
}

/** Plus grande taille (entre `min` et `max`) qui tient dans `maxWidth` ; le texte est coupé par « … » si même `min` ne tient pas. */
export function fitText(measure: Measure, text: string, weight: number, max: number, min: number, maxWidth: number): { text: string; size: number } {
  for (let size = max; size >= min; size -= 2) {
    if (measure(text, cardFont(weight, size)) <= maxWidth) return { text, size }
  }
  return { text: ellipsize(measure, text, cardFont(weight, min), maxWidth), size: min }
}

/** Retour à la ligne par mots (les sauts de ligne de la saisie sont respectés), au plus `maxLines` lignes ; la dernière est coupée par « … ». */
export function wrapText(measure: Measure, text: string, font: string, maxWidth: number, maxLines: number): { lines: string[]; truncated: boolean } {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (measure(next, font) <= maxWidth) {
        line = next
        continue
      }
      if (line) lines.push(line)
      // un mot plus long qu'une ligne (URL, texte sans espace) est coupé par caractères
      let rest = word
      while (measure(rest, font) > maxWidth) {
        let n = rest.length
        while (n > 1 && measure(rest.slice(0, n), font) > maxWidth) n--
        lines.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      line = rest
    }
    lines.push(line)
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length <= maxLines) return { lines, truncated: false }
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = ellipsize(measure, `${kept[maxLines - 1]} …`.replace(/ …$/, '…'), font, maxWidth)
  return { lines: kept, truncated: true }
}

/** Largeur d'une case de chiffre : celle du plus large (chiffres tabulaires, charte 3). */
function digitCell(measure: Measure, font: string): number {
  let w = 0
  for (let d = 0; d <= 9; d++) w = Math.max(w, measure(String(d), font))
  return w
}

export function tabularWidth(measure: Measure, text: string, font: string): number {
  const cell = digitCell(measure, font)
  let w = 0
  for (const ch of text) w += /\d/.test(ch) ? cell : measure(ch, font)
  return w
}

/** Le canvas n'a pas de `font-variant-numeric` : chaque chiffre est centré dans une case de largeur fixe. */
function drawTabular(ctx: CanvasRenderingContext2D, text: string, x: number, baseline: number) {
  const measure: Measure = (t, f) => (ctx.font = f, ctx.measureText(t).width)
  const font = ctx.font
  const cell = digitCell(measure, font)
  ctx.font = font
  ctx.textAlign = 'left'
  let cx = x
  for (const ch of text) {
    if (/\d/.test(ch)) {
      const w = ctx.measureText(ch).width
      ctx.fillText(ch, cx + (cell - w) / 2, baseline)
      cx += cell
    } else {
      ctx.fillText(ch, cx, baseline)
      cx += ctx.measureText(ch).width
    }
  }
}

// ---------- mise en page (pure) ----------

export interface Box { x: number; y: number; w: number; h: number }
export interface TextLine { text: string; size: number; weight: number; /** Aligné à droite du panneau (R et % sur la même ligne). */ right?: boolean }

export interface CardPlan {
  width: number
  height: number
  margin: number
  date?: { text: string; y: number }
  symbol?: TextLine & { y: number }
  direction?: { box: Box; label: string; side: 'long' | 'short' }
  result?: {
    panel: Box
    badge: { box: Box; label: string; outcome: CardOutcome }
    r?: TextLine & { baseline: number }
    pct?: TextLine & { baseline: number }
    pnl?: TextLine & { baseline: number; caption: string; captionBaseline: number }
    outcome: CardOutcome
  }
  setup?: { box: Box; caption: string; name: TextLine; baseline: number }
  screenshot?: Box
  texts: { box: Box; title: string; lines: string[]; lineHeight: number; size: number; titleOffset: number; bodyOffset: number }[]
  brand: { text: string; baseline: number }
  /** Un texte long a été raccourci. */
  truncated: boolean
  /** La capture est cochée mais n'a pas la place de s'afficher avec ces textes. */
  screenshotNoRoom: boolean
  /** Même en mise en page serrée, un texte coché n'a pas de place : il est retiré de l'image (signalé). */
  textsDropped: boolean
}

export interface PlanLabels { setup: string; thesis: string; postMortem: string; pnlCaption: string }

/** Hauteur minimale au-dessous de laquelle une capture n'est plus lisible : elle est alors omise (et signalée). */
const MIN_SCREENSHOT_H = 200

export function planCard(measure: Measure, m: CardModel, labels: PlanLabels, tight = false): CardPlan {
  const { width, height } = CARD_SIZES[m.format]
  const margin = 72
  const inner = width - 2 * margin
  // Mise en page « dense » dès que la carte doit contenir plus que le résultat : capture, textes, ou format carré.
  const dense = m.format === 'square' || !!m.screenshot || !!m.thesis || !!m.postMortem
  const gap = tight ? 14 : dense ? 20 : 32
  const plan: CardPlan = { width, height, margin, texts: [], brand: { text: m.brand, baseline: height - margin }, truncated: false, screenshotNoRoom: false, textsDropped: false }

  // Ligne d'en-tête : la date à gauche, le sens (libellé + triangle) à droite.
  let y = margin
  let dirBox: Box | null = null
  if (m.direction) {
    const label = m.direction.label.toUpperCase()
    const w = Math.min(inner, measure(label, cardFont(600, 30)) + 2 * 28 + 44 + 12)
    dirBox = { x: m.date ? margin + inner - w : margin, y, w, h: 64 }
    plan.direction = { box: dirBox, label, side: m.direction.side }
  }
  if (m.date) {
    const room = inner - (dirBox ? dirBox.w + 24 : 0)
    plan.date = { text: ellipsize(measure, m.date.toUpperCase(), cardFont(600, 28), room), y: y + 64 / 2 + 10 }
  }
  if (m.date || m.direction) y += 64 + gap
  if (m.symbol) {
    const fit = fitText(measure, m.symbol, 600, tight ? 96 : dense ? 120 : 150, 56, inner)
    plan.symbol = { text: fit.text, size: fit.size, weight: 600, y: y + fit.size * 0.8 }
    y += fit.size * 1.05 + gap
  }
  const headerBottom = y

  const footer = margin + 40 // le nom « Pulse » et son air
  const bottomLimit = height - footer - gap

  if (m.result) {
    const res = m.result
    const textW = inner - 2 * 48
    const both = res.r !== undefined && res.pct !== undefined
    const rSize = both ? (tight ? 110 : dense ? 130 : 190) : tight ? 120 : dense ? 150 : 210
    const pctSize = both ? (tight ? 60 : dense ? 72 : 96) : rSize
    const padY = tight ? 24 : dense ? 32 : 40
    const badgeW = measure(res.label, cardFont(600, 30)) + 2 * 28 + 32
    let py = padY
    const badge = { box: { x: 0, y: py, w: badgeW, h: 56 }, label: res.label, outcome: res.outcome }
    py += 56 + (tight ? 14 : dense ? 20 : 28)
    let r: (TextLine & { baseline: number }) | undefined
    let pct: (TextLine & { baseline: number }) | undefined
    if (res.r !== undefined) {
      const fit = fitText(measure, res.r, 700, res.r === '—' ? Math.min(rSize, 120) : rSize, 64, textW)
      r = { text: fit.text, size: fit.size, weight: 700, baseline: py + fit.size * 0.78 }
    }
    if (res.pct !== undefined) {
      const fit = fitText(measure, res.pct, both ? 600 : 700, res.pct === '—' ? Math.min(pctSize, 72) : pctSize, 56, textW)
      pct = { text: fit.text, size: fit.size, weight: both ? 600 : 700, baseline: 0 }
    }
    // Carte dense : R et % sur la même ligne si les deux tiennent (sinon l'un sous l'autre).
    const sideBySide = dense && r && pct && tabularWidth(measure, r.text, cardFont(700, r.size)) + tabularWidth(measure, pct.text, cardFont(600, pct.size)) + 48 <= textW
    if (r) py += r.size * 0.98
    if (pct) {
      if (sideBySide && r) {
        pct.baseline = r.baseline
        pct.right = true
      } else {
        if (r) py += 10
        pct.baseline = py + pct.size * 0.78
        py += pct.size * 0.98
      }
    }
    let pnl: NonNullable<CardPlan['result']>['pnl']
    if (m.pnlMoney) {
      py += 24
      const captionBaseline = py + 22
      const fit = fitText(measure, m.pnlMoney.text, 600, 64, 36, textW)
      pnl = { text: fit.text, size: fit.size, weight: 600, caption: labels.pnlCaption, captionBaseline, baseline: captionBaseline + 20 + fit.size * 0.8 }
      py = pnl.baseline + fit.size * 0.2
    }
    py += padY
    plan.result = { panel: { x: margin, y, w: inner, h: py }, badge, r, pct, pnl, outcome: res.outcome }
    y += py + gap
  }

  if (m.setup) {
    const setupH = tight ? 64 : 76
    const capFont = cardFont(600, 24)
    const cap = labels.setup.toUpperCase()
    const capW = measure(cap, capFont) + 20
    const fit = fitText(measure, m.setup, 500, 36, 26, inner - 2 * 32 - capW)
    const w = Math.min(inner, 2 * 32 + capW + measure(fit.text, cardFont(500, fit.size)))
    plan.setup = { box: { x: margin, y, w, h: setupH }, caption: cap, name: { text: fit.text, size: fit.size, weight: 500 }, baseline: y + setupH / 2 + fit.size * 0.34 }
    y += setupH + gap
  }

  // Textes libres (seulement cochés). Le nombre de lignes s'adapte : la capture garde au moins MIN_SCREENSHOT_H,
  // sinon elle est omise et signalée (jamais écrasée) ; un texte trop long est coupé par « … » et signalé.
  const blocks = [
    m.thesis ? { title: labels.thesis, text: m.thesis } : null,
    m.postMortem ? { title: labels.postMortem, text: m.postMortem } : null,
  ].filter((b): b is { title: string; text: string } => b !== null)
  const lineSize = 30
  const lineHeight = tight ? 38 : 42
  const pad = tight ? 14 : 20
  const titleH = tight ? 22 : 24
  const chrome = 2 * pad + titleH + 6
  const blockFont = cardFont(400, lineSize)
  const available = bottomLimit - y
  const total = (count: number, lines: number) => count * (chrome + lines * lineHeight + gap)
  const capLines = blocks.length === 2 ? 5 : 8
  const pickLines = (count: number, reserve: number) => {
    for (let l = capLines; l >= 1; l--) if (total(count, l) <= available - reserve) return l
    return 0
  }
  let showShot = !!m.screenshot
  let count = blocks.length
  const shotReserve = MIN_SCREENSHOT_H + gap
  let lines = count ? pickLines(count, showShot ? shotReserve : 0) : 0
  if (showShot && (count ? lines === 0 : available < MIN_SCREENSHOT_H)) {
    if (!tight) return planCard(measure, m, labels, true) // on essaie d'abord la mise en page serrée
    showShot = false
    plan.screenshotNoRoom = true
    lines = count ? pickLines(count, 0) : 0
  }
  while (count && lines === 0) {
    if (!tight) return planCard(measure, m, labels, true)
    count--
    plan.textsDropped = true
    lines = count ? pickLines(count, 0) : 0
  }

  const wrapped = blocks.slice(0, count).map((b) => wrapText(measure, b.text, blockFont, inner - 2 * 32, lines))
  if (wrapped.some((w) => w.truncated)) plan.truncated = true
  if (showShot) {
    const room = available - total(count, lines)
    plan.screenshot = { x: margin, y, w: inner, h: room }
    y += room + gap
  }
  wrapped.forEach((w, i) => {
    const h = chrome + w.lines.length * lineHeight
    plan.texts.push({ box: { x: margin, y, w: inner, h }, title: blocks[i].title, lines: w.lines, lineHeight, size: lineSize, titleOffset: pad + 22, bodyOffset: pad + titleH + 6 })
    y += h + gap
  })

  // Sans capture : le bloc central est centré dans l'espace libre au lieu de rester collé en haut.
  if (!plan.screenshot) {
    const free = bottomLimit + gap - y
    const shift = Math.max(0, Math.min(free / 2, 220))
    if (shift > 0) shiftPlan(plan, shift, headerBottom - 1)
  }
  return plan
}

/** Descend tout ce qui est sous l'en-tête (`from`) de `dy`. */
function shiftPlan(p: CardPlan, dy: number, from: number) {
  const move = (b: Box) => { if (b.y >= from) b.y += dy }
  if (p.result) {
    if (p.result.panel.y >= from) p.result.panel.y += dy
  }
  if (p.setup && p.setup.box.y >= from) { p.setup.box.y += dy; p.setup.baseline += dy }
  p.texts.forEach((t) => move(t.box))
}

// ---------- peinture ----------

const OUTCOME_COLORS: Record<CardOutcome, { fg: string; bg: string }> = {
  win: { fg: CARD_TOKENS.gain, bg: CARD_TOKENS.gainBg },
  loss: { fg: CARD_TOKENS.loss, bg: CARD_TOKENS.lossBg },
  breakeven: { fg: CARD_TOKENS.neutral, bg: CARD_TOKENS.neutralBg },
  open: { fg: CARD_TOKENS.neutral, bg: CARD_TOKENS.neutralBg },
}

function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.beginPath()
  ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(r, b.h / 2, b.w / 2))
}

function aurora(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = CARD_TOKENS.bgDeep
  ctx.fillRect(0, 0, w, h)
  // Les quatre lueurs de la charte 2.5, mises à l'échelle de la carte (positions en % identiques).
  const glows: [number, number, number, string][] = [
    [0.08, 0.06, 0.95, 'rgba(74,95,217,.42)'],
    [0.95, 0.1, 0.85, 'rgba(139,127,232,.30)'],
    [0.65, 1.08, 0.95, 'rgba(74,95,217,.30)'],
    [0.03, 0.96, 0.65, 'rgba(95,203,158,.10)'],
  ]
  for (const [fx, fy, fr, color] of glows) {
    const r = fr * Math.max(w, h)
    const g = ctx.createRadialGradient(fx * w, fy * h, 0, fx * w, fy * h, r)
    g.addColorStop(0, color)
    g.addColorStop(0.6, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`
}

/** Dessine le plan. `image` : la capture déjà décodée (redimensionnée sans déformation, jamais rognée). */
export function paintCard(ctx: CanvasRenderingContext2D, plan: CardPlan, image: CanvasImageSource | null, imageSize: { w: number; h: number } | null) {
  const T = CARD_TOKENS
  aurora(ctx, plan.width, plan.height)
  ctx.textBaseline = 'alphabetic'

  if (plan.date) {
    ctx.font = cardFont(600, 28)
    ctx.fillStyle = T.tx2
    ctx.textAlign = 'left'
    setSpacing(ctx, 2)
    ctx.fillText(plan.date.text.toUpperCase(), plan.margin, plan.date.y)
    setSpacing(ctx, 0)
  }
  if (plan.symbol) {
    ctx.font = cardFont(plan.symbol.weight, plan.symbol.size)
    ctx.fillStyle = T.tx
    ctx.textAlign = 'left'
    ctx.fillText(plan.symbol.text, plan.margin, plan.symbol.y)
  }
  if (plan.direction) {
    const { box, label, side } = plan.direction
    roundRect(ctx, box, 999)
    ctx.fillStyle = 'rgba(139,127,232,.16)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(139,127,232,.5)'
    ctx.lineWidth = 2
    ctx.stroke()
    // Forme du sens : triangle vers le haut (achat) ou vers le bas (vente), en plus du libellé.
    const cx = box.x + 28 + 11
    const cy = box.y + box.h / 2
    ctx.beginPath()
    if (side === 'long') { ctx.moveTo(cx, cy - 12); ctx.lineTo(cx + 12, cy + 10); ctx.lineTo(cx - 12, cy + 10) }
    else { ctx.moveTo(cx, cy + 12); ctx.lineTo(cx + 12, cy - 10); ctx.lineTo(cx - 12, cy - 10) }
    ctx.closePath()
    ctx.fillStyle = T.txAccent
    ctx.fill()
    ctx.font = cardFont(600, 30)
    setSpacing(ctx, 1.5)
    ctx.textAlign = 'left'
    ctx.fillText(label, box.x + 28 + 44, cy + 10)
    setSpacing(ctx, 0)
  }

  if (plan.result) {
    const { panel, badge, r, pct, pnl, outcome } = plan.result
    const col = OUTCOME_COLORS[outcome]
    roundRect(ctx, panel, 24 * U)
    ctx.fillStyle = T.glass
    ctx.fill()
    ctx.strokeStyle = T.glassBorder
    ctx.lineWidth = 2
    ctx.stroke()
    const px = panel.x + 48
    const bb = { ...badge.box, x: px, y: panel.y + badge.box.y }
    roundRect(ctx, bb, 999)
    ctx.fillStyle = col.bg
    ctx.fill()
    ctx.beginPath()
    ctx.arc(bb.x + 28, bb.y + bb.h / 2, 7, 0, Math.PI * 2)
    ctx.fillStyle = col.fg
    ctx.fill()
    ctx.font = cardFont(600, 30)
    ctx.textAlign = 'left'
    ctx.fillText(badge.label, bb.x + 28 + 22, bb.y + bb.h / 2 + 10)
    for (const line of [r, pct]) {
      if (!line) continue
      ctx.font = cardFont(line.weight, line.size)
      ctx.fillStyle = col.fg
      const x = line.right ? panel.x + panel.w - 48 - tabularWidth(canvasMeasure(ctx), line.text, ctx.font) : px
      drawTabular(ctx, line.text, x, panel.y + line.baseline)
    }
    if (pnl) {
      ctx.font = cardFont(600, 24)
      ctx.fillStyle = T.tx2
      setSpacing(ctx, 1.5)
      ctx.textAlign = 'left'
      ctx.fillText(pnl.caption.toUpperCase(), px, panel.y + pnl.captionBaseline)
      setSpacing(ctx, 0)
      ctx.font = cardFont(pnl.weight, pnl.size)
      ctx.fillStyle = col.fg
      drawTabular(ctx, pnl.text, px, panel.y + pnl.baseline)
    }
  }

  if (plan.setup) {
    const { box, caption, name, baseline } = plan.setup
    roundRect(ctx, box, 999)
    ctx.fillStyle = T.glass
    ctx.fill()
    ctx.strokeStyle = T.glassBorder
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = cardFont(600, 24)
    ctx.fillStyle = T.tx3
    setSpacing(ctx, 1.5)
    ctx.fillText(caption, box.x + 32, box.y + box.h / 2 + 8)
    setSpacing(ctx, 0)
    const capW = ctx.measureText(caption).width + 20 + 1.5 * caption.length
    ctx.font = cardFont(name.weight, name.size)
    ctx.fillStyle = T.tx
    ctx.fillText(name.text, box.x + 32 + capW, baseline)
  }

  if (plan.screenshot && image && imageSize) {
    const b = plan.screenshot
    ctx.save()
    roundRect(ctx, b, R_INNER)
    ctx.fillStyle = T.bg
    ctx.fill()
    ctx.clip()
    // « contain » : toute la capture est visible, à son rapport largeur / hauteur d'origine.
    const scale = Math.min(b.w / imageSize.w, b.h / imageSize.h)
    const dw = imageSize.w * scale
    const dh = imageSize.h * scale
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, b.x + (b.w - dw) / 2, b.y + (b.h - dh) / 2, dw, dh)
    ctx.restore()
    roundRect(ctx, b, R_INNER)
    ctx.strokeStyle = T.glassBorder
    ctx.lineWidth = 2
    ctx.stroke()
  }

  for (const t of plan.texts) {
    roundRect(ctx, t.box, R_INNER)
    ctx.fillStyle = T.glass
    ctx.fill()
    ctx.strokeStyle = T.hairline
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.font = cardFont(600, 24)
    ctx.fillStyle = T.tx3
    setSpacing(ctx, 1.5)
    ctx.fillText(t.title.toUpperCase(), t.box.x + 32, t.box.y + t.titleOffset)
    setSpacing(ctx, 0)
    ctx.font = cardFont(400, t.size)
    ctx.fillStyle = T.tx2
    t.lines.forEach((line, i) => ctx.fillText(line, t.box.x + 32, t.box.y + t.bodyOffset + (i + 1) * t.lineHeight - 10))
  }

  // Marque discrète.
  ctx.textAlign = 'left'
  ctx.font = cardFont(300, 40)
  ctx.fillStyle = T.tx3
  ctx.fillText(plan.brand.text, plan.margin, plan.brand.baseline)
}

// ---------- navigateur : police, image, PNG ----------

/** Charge Inter (les graisses utilisées) AVANT de dessiner : sinon le canvas se rabat sur une police système et l'image est fausse. */
export async function ensureCardFonts(): Promise<void> {
  const weights = [300, 400, 500, 600, 700]
  await Promise.all(weights.map((w) => document.fonts.load(`${w} 40px Inter`)))
  await document.fonts.ready
  if (!weights.every((w) => document.fonts.check(`${w} 40px Inter`))) throw new Error('font')
}

export function canvasMeasure(ctx: CanvasRenderingContext2D): Measure {
  return (text, font) => {
    ctx.font = font
    return ctx.measureText(text).width
  }
}

export function loadCardImage(src: string): Promise<{ image: HTMLImageElement; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ image, w: image.naturalWidth, h: image.naturalHeight })
    image.onerror = () => reject(new Error('image'))
    image.src = src
  })
}

export interface CardRender { plan: CardPlan }

/** Dessine la carte complète sur `canvas` (à la taille du format). */
export function renderCard(
  canvas: HTMLCanvasElement,
  model: CardModel,
  labels: PlanLabels,
  shot: { image: CanvasImageSource; w: number; h: number } | null,
): CardRender {
  const { width, height } = CARD_SIZES[model.format]
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  const plan = planCard(canvasMeasure(ctx), model, labels)
  paintCard(ctx, plan, shot?.image ?? null, shot ? { w: shot.w, h: shot.h } : null)
  return { plan }
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))
}

/** Contenu d'un Blob en base64 (le format attendu par `save_trade_card_image`). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
