import { describe, expect, it } from 'vitest'
import { createMcpMock, mockExpired, mockExpiresAt, mockInstallCommand, MOCK_MCP_MAX_CALLS } from './mockMcp'

/** Miroir des règles de pulse-core (`mcp/tests.rs`, `mcp/install.rs`) : mêmes cas, mêmes codes. */
function setup() {
  let now = 1_000_000
  let active = [1, 2, 3]
  const runs: { ids: number[]; name: string }[] = []
  const mock = createMcpMock({
    activeAccountIds: () => active,
    runTool: (ids, name) => {
      runs.push({ ids, name })
      return { content: { accounts: ids, name }, isError: false }
    },
    now: () => now,
    tzOffsetMin: () => 120,
  })
  return { mock, runs, setNow: (n: number) => (now = n), setActive: (ids: number[]) => (active = ids), now: () => now }
}

describe('faux backend de l’accès MCP (lot 37)', () => {
  it('désactivé par défaut, sans consentement ni compte coché', async () => {
    const { mock } = setup()
    const s = await mock.getStatus()
    expect(s.active).toBe(false)
    expect(s.settings).toEqual({ consentAt: null, accountIds: [], duration: 'untilClose', autostart: false })
    expect(s.cannotEnable).toBe('consentRequired')
    await expect(mock.enable(false)).rejects.toThrow('mcp:consentRequired')
    await expect(mock.enable(true)).rejects.toThrow('mcp:noAccount')
    expect((await mock.getStatus()).settings.consentAt).toBe(1_000_000)
  })

  it('refuse un compte inconnu ou archivé sans rien écrire, trie et dédoublonne', async () => {
    const { mock } = setup()
    await expect(mock.setSettings({ accountIds: [9], duration: '4h', autostart: true })).rejects.toThrow('mcp:invalidAccount')
    expect((await mock.getStatus()).settings.duration).toBe('untilClose')
    const s = await mock.setSettings({ accountIds: [3, 1, 3], duration: '4h', autostart: true })
    expect(s.settings.accountIds).toEqual([1, 3])
  })

  it('durées : fin exacte, et coupure au verrouillage', async () => {
    expect(mockExpiresAt('1h', 10)).toBe(3_600_010)
    expect(mockExpiresAt('4h', 10)).toBe(14_400_010)
    expect(mockExpiresAt('untilClose', 10)).toBeNull()
    expect(mockExpired(1000, 999)).toBe(false)
    expect(mockExpired(1000, 1000)).toBe(true)
    expect(mockExpired(null, Number.MAX_SAFE_INTEGER)).toBe(false)
    const { mock, setNow } = setup()
    await mock.setSettings({ accountIds: [1], duration: '1h', autostart: false })
    const on = await mock.enable(true)
    expect(on.active).toBe(true)
    expect(on.expiresAt).toBe(1_000_000 + 3_600_000)
    setNow(1_000_000 + 3_599_999)
    expect((await mock.getStatus()).active).toBe(true)
    setNow(1_000_000 + 3_600_000)
    const off = await mock.getStatus()
    expect([off.active, off.lastStopReason]).toEqual([false, 'expired'])
    await mock.enable(false)
    mock.lock()
    expect((await mock.getStatus()).lastStopReason).toBe('locked')
  })

  it('plus aucun compte coché, ou compte archivé : l’accès se coupe', async () => {
    const { mock, setActive } = setup()
    await mock.setSettings({ accountIds: [2], duration: 'untilClose', autostart: false })
    await mock.enable(true)
    const s = await mock.setSettings({ accountIds: [], duration: 'untilClose', autostart: false })
    expect([s.active, s.lastStopReason, s.cannotEnable]).toEqual([false, 'settings', 'noAccount'])
    await mock.setSettings({ accountIds: [2], duration: 'untilClose', autostart: false })
    setActive([1])
    await expect(mock.enable(false)).rejects.toThrow('mcp:noAccount')
  })

  it('retirer le consentement coupe l’accès et le démarrage automatique', async () => {
    const { mock } = setup()
    await mock.setSettings({ accountIds: [1], duration: 'untilClose', autostart: true })
    await mock.enable(true)
    const s = await mock.disable(true)
    expect([s.active, s.settings.consentAt, s.settings.autostart, s.lastStopReason]).toEqual([false, null, false, 'settings'])
  })

  it('journal : seuls les comptes cochés, résultat exact, 500 lignes, effacement, 60 appels par minute', async () => {
    const { mock, runs, setNow, now } = setup()
    await expect(mock.simulateCall('risk', {})).rejects.toThrow('mcp:notRunning')
    await mock.setSettings({ accountIds: [1, 3], duration: 'untilClose', autostart: false })
    await mock.enable(true)
    const call = await mock.simulateCall('period_summary', { period: '1S' })
    expect(runs[0]).toEqual({ ids: [1, 3], name: 'period_summary' })
    expect(call).toMatchObject({ tool: 'period_summary', params: '{"period":"1S"}', result: '{"accounts":[1,3],"name":"period_summary"}', isError: false, tzOffsetMin: 120 })
    expect(call.size).toBe(call.result.length)
    for (let i = 1; i < 60; i++) await mock.simulateCall('risk', {})
    await expect(mock.simulateCall('risk', {})).rejects.toThrow('mcp:tooManyCalls')
    expect((await mock.getStatus()).refused).toBe(1)
    for (let i = 0; i < 460; i++) {
      setNow(now() + 60_001)
      await mock.simulateCall('risk', { i })
    }
    const all = await mock.listCalls()
    expect(all.length).toBe(MOCK_MCP_MAX_CALLS)
    expect(all[0].params).toBe('{"i":459}')
    expect((await mock.listCalls(3)).length).toBe(3)
    expect(await mock.clearCalls()).toBe(500)
    expect((await mock.getStatus()).logCount).toBe(0)
  })

  it('commande d’installation : même format que pulse-core', () => {
    const exe = 'C:\\Program Files\\Pulse\\pulse-mcp.exe'
    const dir = 'C:\\Users\\Anne Marie\\AppData\\Roaming\\app.pulse.journal'
    const c = mockInstallCommand(exe, true, dir, dir)
    expect(c.add).toBe('claude mcp add --scope user pulse -- "C:\\Program Files\\Pulse\\pulse-mcp.exe"')
    expect(c.remove).toBe('claude mcp remove --scope user pulse')
    expect(c.list).toBe('claude mcp list')
    const other = mockInstallCommand(exe, false, 'D:\\Pulse data', dir)
    expect(other.add).toBe('claude mcp add --scope user pulse -- "C:\\Program Files\\Pulse\\pulse-mcp.exe" --data-dir "D:\\Pulse data"')
    expect([other.withDataDir, other.exeFound]).toEqual([true, false])
  })
})
