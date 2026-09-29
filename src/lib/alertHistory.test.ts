import { describe, expect, it } from 'vitest'
import type { Alert, AlertRecord } from '../types/alerts'
import { filterHistory } from './alertHistory'

const rec = (id: string, kind: AlertRecord['kind'], firstSeenAt: number): AlertRecord => ({
  alertId: id,
  accountId: 1,
  kind,
  severity: 'warning',
  tradeId: null,
  firstSeenAt,
  dismissedAt: null,
  alert: { id } as Alert,
})
const list = [rec('a', 'revenge', 100), rec('b', 'noStopLoss', 200), rec('c', 'revenge', 300)]

describe('filterHistory', () => {
  it('sans filtre, garde tout', () => {
    expect(filterHistory(list, { from: null, to: null, kind: null })).toHaveLength(3)
  })
  it('période [from, to) : début inclus, fin exclue', () => {
    expect(filterHistory(list, { from: 200, to: 300, kind: null }).map((r) => r.alertId)).toEqual(['b'])
    expect(filterHistory(list, { from: 200, to: null, kind: null }).map((r) => r.alertId)).toEqual(['b', 'c'])
  })
  it('type', () => {
    expect(filterHistory(list, { from: null, to: null, kind: 'revenge' }).map((r) => r.alertId)).toEqual(['a', 'c'])
    expect(filterHistory(list, { from: null, to: null, kind: 'dailyLoss' })).toEqual([])
  })
  it('cumule période et type', () => {
    expect(filterHistory(list, { from: 150, to: null, kind: 'revenge' }).map((r) => r.alertId)).toEqual(['c'])
  })
})
