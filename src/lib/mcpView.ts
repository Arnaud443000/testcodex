// Lot 37 : logique d'affichage pure de l'accès MCP (testée : mcpView.test.ts). Aucun calcul de donnée de trading.
import type { McpSettings, McpSettingsUpdate, McpStatus } from '../types/mcp'

interface McpErrorTexts {
  errors: Record<string, string>
  unknownError: (d: string) => string
}

/** Le code d'une erreur (`invalid input: mcp:noAccount` → `noAccount`) ; `lock:locked` → `locked` ; sinon `null`. */
export function mcpErrorCode(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error)
  return /\bmcp:([A-Za-z]+)\b/.exec(text)?.[1] ?? (/\block:locked\b/.test(text) ? 'locked' : null)
}

export function mcpErrorMessage(error: unknown, t: McpErrorTexts, lockedText?: string): string {
  const code = mcpErrorCode(error)
  if (code === 'locked' && lockedText) return lockedText
  if (code && t.errors[code]) return t.errors[code]
  const raw = error instanceof Error ? error.message : String(error)
  return t.unknownError(raw.replace(/^Error: /, '').replace(/^invalid input: /, ''))
}

/** Coche / décoche un compte ; liste triée, sans doublon (comme pulse-core). */
export function toggleAccount(ids: number[], id: number, checked: boolean): number[] {
  const next = new Set(ids)
  if (checked) next.add(id)
  else next.delete(id)
  return [...next].sort((a, b) => a - b)
}

/** Le formulaire des réglages depuis l'état enregistré (comptes archivés ou supprimés retirés). */
export function formFromSettings(s: McpSettings, activeIds: number[]): McpSettingsUpdate {
  return { accountIds: s.accountIds.filter((id) => activeIds.includes(id)), duration: s.duration, autostart: s.autostart }
}

export function formChanged(saved: McpSettings, form: McpSettingsUpdate): boolean {
  const a = [...saved.accountIds].sort((x, y) => x - y)
  return a.join(',') !== form.accountIds.join(',') || saved.duration !== form.duration || saved.autostart !== form.autostart
}

/** Peut-on activer maintenant ? `consentTicked` = la case du formulaire (le consentement n'est pas encore enregistré). */
export function enableBlocker(status: McpStatus, consentTicked: boolean, form: McpSettingsUpdate): 'consentRequired' | 'noAccount' | null {
  if (status.settings.consentAt === null && !consentTicked) return 'consentRequired'
  if (form.accountIds.length === 0) return 'noAccount'
  return null
}

/** Paramètres d'un appel pour une ligne du journal : `{}` = aucun, sinon le texte (coupé à `max` caractères). */
export function paramsSummary(params: string, noParams: string, max = 80): string {
  const text = params.trim()
  if (text === '' || text === '{}' || text === 'null') return noParams
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Les devises des comptes cochés : plus d'une = les outils demanderont un compte précis. */
export function mixedCurrencies(accounts: { id: number; currency: string }[], ids: number[]): boolean {
  return new Set(accounts.filter((a) => ids.includes(a.id)).map((a) => a.currency)).size > 1
}
