import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cached, clearWidgetCache } from './widgetData'

describe('cache des widgets', () => {
  beforeEach(() => clearWidgetCache())

  it('n’envoie qu’une requête pour une même clé', async () => {
    const load = vi.fn().mockResolvedValue(42)
    const [a, b] = await Promise.all([cached('k', load), cached('k', load)])
    expect([a, b]).toEqual([42, 42])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('distingue les clés', async () => {
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    expect([await cached('a', load), await cached('b', load)]).toEqual([1, 2])
  })

  it('ne mémorise pas une erreur', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    await expect(cached('k', load)).rejects.toThrow('boom')
    await expect(cached('k', load)).resolves.toBe('ok')
  })

  it('clearWidgetCache force un nouveau chargement', async () => {
    const load = vi.fn().mockResolvedValue(1)
    await cached('k', load)
    clearWidgetCache()
    await cached('k', load)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
