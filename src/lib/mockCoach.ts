// Lot 21 : coach IA dans le navigateur. SIMULATION : aucun appel réseau, aucune IA. Le faux coach choisit
// quelques outils du faux backend selon des mots-clés de la question, remplit le même journal « données
// envoyées » que pulse-ai et passe par le même contrôle des chiffres que pulse-core (`coach/numbers.rs`,
// porté ici et testé sur les mêmes cas). Mêmes règles : IA éteinte par défaut, consentement propre au coach,
// rien ne part sans « Envoyer », limites de longueur et de conversation.
import type { AiStatus } from '../types/ai'
import type { AskCoachRequest, CoachStatus, CoachToolCall, CoachTurn, Conversation, ConversationSummary } from '../types/coach'

export const MOCK_COACH_LIMITS = { maxQuestionChars: 2000, maxToolCalls: 8, maxRequests: 6, maxTurns: 20 }
/** Même valeur que `pulse_core::coach::TOOLS_VERSION`. */
export const MOCK_TOOLS_VERSION = 1

export interface CoachScope {
  accountIds: number[]
  nowMs: number
  tzOffsetMin: number
}

export interface CoachToolOutput {
  content: unknown
  isError: boolean
}

export interface CoachMockDeps {
  aiStatus: () => Promise<AiStatus>
  /** Comptes de la portée : ceux demandés, sinon les comptes actifs. */
  scope: (accountIds: number[]) => number[]
  runTool: (scope: CoachScope, name: string, input: Record<string, unknown>) => CoachToolOutput
  tools: () => { name: string; description: string }[]
  now: () => number
}

const aiError = (code: string) => new Error(`ai:${code}`)

// --- Contrôle des chiffres (port de pulse-core `coach/numbers.rs`) ---

const MONTHS = ['janvier', 'février', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'aout', 'septembre', 'octobre', 'novembre', 'décembre', 'decembre', 'janv', 'févr', 'fevr', 'avr', 'juil', 'sept', 'oct', 'nov', 'déc']
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const isLetter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c)
const isSign = (c: string) => c === '-' || c === '+' || c === '−' || c === '–'
const isGroupSpace = (c: string | undefined) => c === ' ' || c === ' ' || c === ' '

interface NumberToken {
  raw: string
  value: number
  decimals: number
  percent: boolean
  exempt: boolean
}

function parseNumber(body: string): [number, number] {
  const cleaned = [...body].filter((c) => !isGroupSpace(c)).join('')
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let decimalAt: number | null = null
  if (lastComma >= 0 && lastDot >= 0) decimalAt = Math.max(lastComma, lastDot)
  else if (lastComma >= 0 || lastDot >= 0) {
    const p = Math.max(lastComma, lastDot)
    const parts = cleaned.split(cleaned[p])
    const grouped = parts.length > 2 && parts.slice(1).every((g) => g.length === 3)
    if (!grouped) decimalAt = p
  }
  const intPart = decimalAt === null ? cleaned : cleaned.slice(0, decimalAt)
  const frac = decimalAt === null ? '' : cleaned.slice(decimalAt + 1)
  const digits = [...intPart].filter(isDigit).join('')
  return [Number(frac ? `${digits}.${frac}` : digits) || 0, frac.length]
}

function numberTokens(text: string): NumberToken[] {
  const chars = [...text]
  const out: NumberToken[] = []
  let i = 0
  while (i < chars.length) {
    const c = chars[i]
    const prev = chars[i - 1]
    const signed = isSign(c) && isDigit(chars[i + 1]) && !(prev !== undefined && /[\p{L}\p{N}]/u.test(prev))
    if (!(isDigit(c) || signed) || isDigit(prev)) {
      i++
      continue
    }
    const start = i
    const negative = signed && c !== '+'
    if (signed) i++
    let body = ''
    while (i < chars.length) {
      const ch = chars[i]
      if (isDigit(ch)) {
        body += ch
        i++
      } else if ((ch === ',' || ch === '.' || isGroupSpace(ch)) && isDigit(chars[i + 1])) {
        if (isGroupSpace(ch) && !(isDigit(chars[i + 1]) && isDigit(chars[i + 2]) && isDigit(chars[i + 3]) && !isDigit(chars[i + 4]))) break
        body += ch
        i++
      } else break
    }
    const before = chars[start - 1]
    const next = chars[i]
    let exempt =
      (before !== undefined && (isLetter(before) || '/:-_'.includes(before))) ||
      (next !== undefined && '/:-_'.includes(next) && isDigit(chars[i + 1]))
    let percent = false
    let unitLen = 0
    let j = i
    while (isGroupSpace(chars[j])) j++
    if (chars[j] === '%') {
      percent = true
      unitLen = j + 1 - i
    } else if (chars[j] === 'R' && !isLetter(chars[j + 1])) unitLen = j + 1 - i
    else if (isLetter(chars[j]) && j === i) exempt = true
    const [value, decimals] = parseNumber(body)
    let k = i
    while (isGroupSpace(chars[k])) k++
    let after = ''
    while (isLetter(chars[k])) after += chars[k++]
    let e = start
    while (e > 0 && isGroupSpace(chars[e - 1])) e--
    let b = e
    while (b > 0 && isLetter(chars[b - 1])) b--
    const wordBefore = chars.slice(b, e).join('').toLowerCase()
    if (decimals === 0 && !percent) {
      if (value >= 1900 && value <= 2100 && /^\d+$/.test(body)) exempt = true
      if (MONTHS.includes(after.toLowerCase()) || WEEKDAYS.includes(wordBefore)) exempt = true
    }
    out.push({ raw: chars.slice(start, i + unitLen).join('').trim(), value: negative ? -value : value, decimals, percent, exempt })
    i += unitLen
  }
  return out
}

/** Tous les nombres fournis à l'IA dans la conversation (jamais ceux de ses propres réponses). */
export class AllowedNumbers {
  values: number[] = []
  addJson(v: unknown): void {
    if (typeof v === 'number') this.values.push(v)
    else if (typeof v === 'string') this.addText(v)
    else if (Array.isArray(v)) v.forEach((x) => this.addJson(x))
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => this.addJson(x))
  }
  addText(text: string): void {
    for (const t of numberTokens(text)) this.values.push(t.value)
    for (const run of text.match(/\d+/g) ?? []) this.values.push(Number(run))
  }
  matches(t: NumberToken): boolean {
    const written = Math.abs(t.value)
    const tolerance = 0.5 * 10 ** -t.decimals + 1e-9
    return this.values.some((a) => [Math.abs(a), Math.abs(a * 100)].some((c) => Math.abs(c - written) <= tolerance))
  }
}

/** Les chiffres de la réponse introuvables dans ce que Pulse a fourni (au plus 20, sans doublon). */
export function unverifiedNumbers(answer: string, allowed: AllowedNumbers): string[] {
  const out: string[] = []
  for (const t of numberTokens(answer)) {
    if (t.exempt || (!t.percent && t.decimals === 0 && Math.abs(t.value) <= 10) || allowed.matches(t)) continue
    if (!out.includes(t.raw) && out.length < 20) out.push(t.raw)
  }
  return out
}

// --- Contexte, choix des outils et réponse simulée ---

const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

/** Même ligne que `pulse_core::coach::context_line`. */
export function contextLine(nowMs: number, tzOffsetMin: number, accountIds: number[]): string {
  const local = new Date(nowMs + tzOffsetMin * 60_000)
  const iso = (local.getUTCDay() + 6) % 7
  const off = Math.abs(tzOffsetMin)
  const pad = (n: number) => String(n).padStart(2, '0')
  const ids = accountIds.length ? accountIds.join(', ') : 'aucun'
  return `[Contexte ajouté par Pulse] Aujourd'hui : ${WEEKDAY_NAMES[iso]} ${local.toISOString().slice(0, 10)} (heure locale, UTC${tzOffsetMin < 0 ? '-' : '+'}${pad(Math.floor(off / 60))}:${pad(off % 60)}). Comptes de la portée : ${ids}.`
}

/** Outils que le faux coach appelle, selon des mots-clés (l'IA réelle choisit elle-même). */
export function simulatedToolPlan(question: string): { name: string; input: Record<string, unknown> }[] {
  const q = question.toLowerCase()
  const plan: { name: string; input: Record<string, unknown> }[] = []
  if (/semaine/.test(q)) plan.push({ name: 'period_summary', input: { period: '1S', comparePrevious: true } })
  if (/mois/.test(q)) plan.push({ name: 'period_summary', input: { period: '1M', comparePrevious: true } })
  if (/lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|jours? de la semaine/.test(q)) plan.push({ name: 'segments', input: { by: 'weekday', period: '3M' } })
  if (/erreur|coûte|coute/.test(q)) plan.push({ name: 'recurring_mistakes', input: { period: '3M' } })
  if (/discipline/.test(q)) plan.push({ name: 'discipline', input: { period: '1M' } })
  if (!plan.length) plan.push({ name: 'period_summary', input: { period: '1M' } })
  return plan
}

const pct = (v: unknown) => (typeof v === 'number' ? `${(v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : 'non disponible')
const money = (v: unknown, cur: unknown) => (typeof v === 'string' ? `${v.replace('-', '−').replace('.', ',')} ${cur ?? ''}`.trim() : 'non disponible')
const r = (v: unknown) => (typeof v === 'number' ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} R` : 'non disponible')

/** Réponse fictive, clairement marquée, construite seulement à partir des résultats d'outils. */
export function simulatedAnswer(calls: CoachToolCall[]): string {
  const lines = ['[Simulation] Réponse fictive produite dans le navigateur, sans IA ni appel réseau, à partir des résultats des outils ci-dessous.']
  for (const c of calls) {
    const o = c.output as Record<string, any>
    if (c.isError) {
      lines.push(`- L'outil ${c.name} n'a pas pu répondre.`)
      continue
    }
    if (c.name === 'period_summary') {
      const s = o.summary ?? {}
      lines.push(`## Période ${o.window?.label ?? ''}`)
      lines.push(`- ${s.tradeCount ?? 0} trades clôturés, PnL net ${money(s.netPnl, o.currency)}, win rate ${pct(s.winRate)}, expectancy ${r(s.expectancyR)}.`)
    } else if (c.name === 'segments') {
      lines.push('## Par jour de la semaine')
      for (const seg of (o.segments ?? []) as Record<string, any>[]) {
        lines.push(`- ${WEEKDAY_NAMES[Number(seg.key) - 1] ?? seg.label} : ${seg.tradeCount} trades, PnL net ${money(seg.netPnl, o.currency)}, win rate ${pct(seg.winRate)}.`)
      }
    } else if (c.name === 'recurring_mistakes') {
      lines.push('## Erreurs les plus coûteuses')
      for (const m of ((o.byCost ?? []) as Record<string, any>[]).slice(0, 3)) lines.push(`- ${m.label} : ${m.tradeCount} trades, coût ${money(m.cost, o.currency)}.`)
    } else if (c.name === 'discipline') {
      lines.push('## Discipline')
      lines.push(`- Score : ${typeof o.score === 'number' ? Math.round(o.score) : 'non disponible (échantillon trop petit)'}.`)
    }
  }
  lines.push('## Démonstration')
  lines.push('- Exemple de chiffre inventé, pour montrer l’avertissement : 42 %.')
  lines.push('Ces constats décrivent ce qui s’est passé en même temps ; ce n’est pas un conseil financier.')
  return lines.join('\n')
}

const titleFrom = (q: string) => {
  const flat = q.split(/\s+/).filter(Boolean).join(' ')
  return [...flat].length <= 60 ? flat : `${[...flat].slice(0, 59).join('').trimEnd()}…`
}

export function createCoachMock(deps: CoachMockDeps) {
  let consentAt: number | null = null
  let nextConversation = 1
  let nextTurn = 1
  const conversations: (Omit<ConversationSummary, 'turnCount' | 'readOnly' | 'full'> & { toolsVersion: number })[] = []
  const turns: CoachTurn[] = []

  const summaryOf = (c: (typeof conversations)[number]): ConversationSummary => {
    const own = turns.filter((t) => t.conversationId === c.id)
    return {
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      turnCount: own.length,
      readOnly: c.toolsVersion !== MOCK_TOOLS_VERSION,
      full: own.length >= MOCK_COACH_LIMITS.maxTurns,
    }
  }
  const find = (id: number) => {
    const c = conversations.find((x) => x.id === id)
    if (!c) throw new Error(`not found: conversation ${id}`)
    return c
  }
  const status = async (): Promise<CoachStatus> => {
    const ai = await deps.aiStatus()
    if (!ai.settings.enabled) consentAt = null // éteindre l'IA oublie aussi ce consentement
    return {
      enabled: ai.settings.enabled,
      vaultAvailable: ai.vaultAvailable,
      keyStored: ai.keyStored,
      consentAt,
      model: ai.settings.model,
      provider: 'simulation',
      providerHost: ai.providerHost,
      limits: { ...MOCK_COACH_LIMITS },
      tools: deps.tools(),
    }
  }

  return {
    getCoachStatus: status,
    recordCoachConsent: async (): Promise<CoachStatus> => {
      if (!(await status()).enabled) throw new Error('invalid input: the AI option is turned off')
      consentAt = deps.now()
      return status()
    },
    askCoach: async (req: AskCoachRequest): Promise<CoachTurn> => {
      const s = await status()
      if (!s.enabled) throw aiError('disabled')
      if (s.consentAt == null || !req.confirmed) throw aiError('consentRequired')
      const question = req.question.trim()
      if (!question || [...question].length > MOCK_COACH_LIMITS.maxQuestionChars) throw aiError('questionInvalid')
      let conversation = req.conversationId == null ? null : find(req.conversationId)
      if (conversation) {
        const sum = summaryOf(conversation)
        if (sum.readOnly || sum.full) throw aiError('conversationClosed')
      }
      if (!s.keyStored) throw aiError('noKey')
      const now = deps.now()
      const scope: CoachScope = { accountIds: deps.scope(req.accountIds), nowMs: now, tzOffsetMin: req.tzOffsetMin }
      const context = contextLine(now, req.tzOffsetMin, scope.accountIds)
      const history = conversation ? turns.filter((t) => t.conversationId === conversation!.id && t.status === 'answered') : []
      const allowed = new AllowedNumbers()
      for (const t of history) {
        allowed.addText(t.sent.question)
        allowed.addText(t.sent.context)
        t.sent.toolCalls.forEach((c) => allowed.addJson(c.output))
      }
      allowed.addText(context)
      allowed.addText(question)
      const toolCalls: CoachToolCall[] = simulatedToolPlan(question)
        .slice(0, MOCK_COACH_LIMITS.maxToolCalls)
        .map(({ name, input }) => {
          const out = deps.runTool(scope, name, input)
          allowed.addJson(out.content)
          return { name, input, output: out.content, isError: out.isError }
        })
      await new Promise((res) => setTimeout(res, 500))
      const answer = simulatedAnswer(toolCalls)
      if (!conversation) {
        conversation = { id: nextConversation++, title: titleFrom(question), createdAt: now, updatedAt: now, toolsVersion: MOCK_TOOLS_VERSION }
        conversations.push(conversation)
      }
      conversation.updatedAt = now
      const turn: CoachTurn = {
        id: nextTurn++,
        conversationId: conversation.id,
        seq: turns.filter((t) => t.conversationId === conversation!.id).length + 1,
        createdAt: now,
        question,
        status: 'answered',
        errorCode: null,
        answer,
        provider: 'simulation',
        model: s.model,
        sent: {
          provider: 'simulation',
          model: s.model,
          question,
          context,
          historyTurns: summaryOf(conversation).turnCount,
          historyMessages: history.length * 2,
          requests: toolCalls.length ? 2 : 1,
          toolCalls,
          limitReached: false,
        },
        unverified: unverifiedNumbers(answer, allowed),
        usage: { inputTokens: 0, outputTokens: 0, requests: toolCalls.length ? 2 : 1 },
      }
      turns.push(turn)
      return turn
    },
    listCoachConversations: async (): Promise<ConversationSummary[]> =>
      conversations.map(summaryOf).sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id),
    getCoachConversation: async (id: number): Promise<Conversation> => ({
      ...summaryOf(find(id)),
      turns: turns.filter((t) => t.conversationId === id).sort((a, b) => a.seq - b.seq),
    }),
    renameCoachConversation: async (id: number, title: string): Promise<ConversationSummary> => {
      const clean = title.split(/\s+/).filter(Boolean).join(' ')
      if (!clean || [...clean].length > 120) throw new Error('invalid input: the title must have 1 to 120 characters')
      const c = find(id)
      c.title = clean
      return summaryOf(c)
    },
    deleteCoachConversation: async (id: number): Promise<void> => {
      find(id)
      conversations.splice(conversations.findIndex((c) => c.id === id), 1)
      for (let i = turns.length - 1; i >= 0; i--) if (turns[i].conversationId === id) turns.splice(i, 1)
    },
    deleteAllCoachConversations: async (): Promise<number> => {
      const n = conversations.length
      conversations.length = 0
      turns.length = 0
      return n
    },
  }
}
