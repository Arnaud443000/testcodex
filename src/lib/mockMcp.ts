// Lot 37 : accès MCP local dans le navigateur. SIMULATION : aucune écoute, aucun port, aucun fichier, aucun
// jeton. Mêmes règles que pulse-core (`mcp/settings.rs`, `mcp/runtime.rs`, `mcp/log.rs`) : désactivé par défaut,
// consentement obligatoire, aucun compte coché par défaut, comptes actifs seulement, durées, journal de
// 500 appels. « Simuler un appel » (navigateur seulement) remplit le journal avec un outil du faux coach.
import type { McpCall, McpDuration, McpInstallCommand, McpSettings, McpSettingsUpdate, McpStatus, McpStopReason } from '../types/mcp'

export const MOCK_MCP_MAX_CALLS = 500
export const MOCK_MCP_CALLS_PER_MINUTE = 60

export interface McpToolOutput {
  content: unknown
  isError: boolean
}

export interface McpMockDeps {
  activeAccountIds: () => number[]
  /** Un outil du faux coach sur ces comptes. */
  runTool: (accountIds: number[], name: string, input: Record<string, unknown>) => McpToolOutput
  now: () => number
  tzOffsetMin: () => number
}

const mcpError = (code: string) => new Error(`invalid input: mcp:${code}`)

/** Même règle que `McpDuration::expires_at`. */
export function mockExpiresAt(duration: McpDuration, now: number): number | null {
  return duration === '1h' ? now + 3_600_000 : duration === '4h' ? now + 4 * 3_600_000 : null
}

/** L'instant de fin lui-même est hors de l'activation (comme `mcp::expired`). */
export function mockExpired(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && now >= expiresAt
}

/** Même format que `pulse_core::mcp::install_command`. */
export function mockInstallCommand(exePath: string, exeFound: boolean, dataDir: string, defaultDataDir: string | null): McpInstallCommand {
  const quote = (p: string) => `"${p.replace(/"/g, '\\"')}"`
  const withDataDir = defaultDataDir !== dataDir
  const add = `claude mcp add --scope user pulse -- ${quote(exePath)}${withDataDir ? ` --data-dir ${quote(dataDir)}` : ''}`
  return { exePath, exeFound, add, list: 'claude mcp list', remove: 'claude mcp remove --scope user pulse', withDataDir }
}

export function createMcpMock(deps: McpMockDeps) {
  let settings: McpSettings = { consentAt: null, accountIds: [], duration: 'untilClose', autostart: false }
  let active = false
  let startedAt: number | null = null
  let expiresAt: number | null = null
  let calls = 0
  let refused = 0
  let lastCallAt: number | null = null
  let lastStop: { reason: McpStopReason; at: number } | null = null
  let log: McpCall[] = []
  let nextId = 1
  let recent: number[] = []

  const exposed = () => settings.accountIds.filter((id) => deps.activeAccountIds().includes(id))
  const stop = (reason: McpStopReason) => {
    if (!active) return false
    active = false
    startedAt = null
    expiresAt = null
    calls = 0
    refused = 0
    lastCallAt = null
    lastStop = { reason, at: deps.now() }
    return true
  }
  const tick = () => {
    if (active && mockExpired(expiresAt, deps.now())) stop('expired')
  }
  const status = (): McpStatus => {
    tick()
    const cannotEnable = settings.consentAt === null ? 'consentRequired' : exposed().length === 0 ? 'noAccount' : null
    return {
      settings: { ...settings, accountIds: [...settings.accountIds] },
      active,
      startedAt,
      expiresAt,
      calls,
      refused,
      lastCallAt,
      lastStopReason: lastStop?.reason ?? null,
      lastStopAt: lastStop?.at ?? null,
      cannotEnable,
      logCount: log.length,
    }
  }
  const record = (call: Omit<McpCall, 'id' | 'size'>) => {
    log = [{ ...call, id: nextId++, size: new TextEncoder().encode(call.result).length }, ...log].slice(0, MOCK_MCP_MAX_CALLS)
  }

  return {
    getStatus: async (): Promise<McpStatus> => status(),
    setSettings: async (update: McpSettingsUpdate): Promise<McpStatus> => {
      const ids = [...new Set(update.accountIds)].sort((a, b) => a - b)
      if (ids.some((id) => !deps.activeAccountIds().includes(id))) throw mcpError('invalidAccount')
      settings = { ...settings, accountIds: ids, duration: update.duration, autostart: update.autostart }
      if (exposed().length === 0) stop('settings')
      return status()
    },
    enable: async (confirmed: boolean): Promise<McpStatus> => {
      if (settings.consentAt === null) {
        if (!confirmed) throw mcpError('consentRequired')
        settings = { ...settings, consentAt: deps.now() }
      }
      if (exposed().length === 0) throw mcpError('noAccount')
      // Une nouvelle activation = un nouveau jeton (simulé) et des compteurs à zéro.
      stop('manual')
      const now = deps.now()
      active = true
      startedAt = now
      expiresAt = mockExpiresAt(settings.duration, now)
      lastStop = null
      return status()
    },
    disable: async (withdrawConsent: boolean): Promise<McpStatus> => {
      stop(withdrawConsent ? 'settings' : 'manual')
      if (withdrawConsent) settings = { ...settings, consentAt: null, autostart: false }
      return status()
    },
    /** Verrouillage de Pulse (simulé) : l'accès s'éteint. */
    lock: () => stop('locked'),
    listCalls: async (limit?: number): Promise<McpCall[]> => log.slice(0, Math.min(Math.max(limit ?? MOCK_MCP_MAX_CALLS, 1), MOCK_MCP_MAX_CALLS)),
    clearCalls: async (): Promise<number> => {
      const n = log.length
      log = []
      return n
    },
    installCommand: async (): Promise<McpInstallCommand> =>
      mockInstallCommand('C:\\Program Files\\Pulse\\pulse-mcp.exe', true, 'C:\\Users\\Vous\\AppData\\Roaming\\app.pulse.journal', 'C:\\Users\\Vous\\AppData\\Roaming\\app.pulse.journal'),
    /** Navigateur seulement : ce que ferait un appel de Claude Code (outil du faux coach, journalisé). */
    simulateCall: async (tool: string, input: Record<string, unknown>): Promise<McpCall> => {
      tick()
      if (!active) throw mcpError('notRunning')
      const now = deps.now()
      recent = recent.filter((t) => t > now - 60_000)
      if (recent.length >= MOCK_MCP_CALLS_PER_MINUTE) {
        refused += 1
        throw mcpError('tooManyCalls')
      }
      recent.push(now)
      const ids = exposed()
      const out: McpToolOutput = ids.length
        ? deps.runTool(ids, tool, input)
        : { content: { error: 'Aucun compte n’est ouvert à l’accès MCP.', code: 'mcp:noAccount' }, isError: true }
      calls += 1
      lastCallAt = now
      record({ at: now, tzOffsetMin: deps.tzOffsetMin(), tool, params: JSON.stringify(input), result: JSON.stringify(out.content), isError: out.isError, durationMs: 3 })
      return log[0]
    },
  }
}

export type McpMock = ReturnType<typeof createMcpMock>
