import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { Icon } from './Icon'

const PERIODS = ['1D', '1W', '1M', '3M', '1Y', 'ALL'] as const

export function TopBar() {
  const { accounts, selectedId, select } = useAccounts()
  const t = useT()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('3M')

  return (
    <header
      className="glass-bar flex h-[72px] shrink-0 items-center gap-3.5 border-b px-7"
    >
      <label className="control relative flex items-center gap-3 !rounded-full px-4 py-2 text-tx2">
        <Icon name="wallet" />
        <span className="leading-tight">
          <small className="block text-[11px] text-tx3">{t.topbar.account}</small>
          <select
            aria-label={t.topbar.account}
            className="cursor-pointer appearance-none bg-transparent pr-5 text-sm font-semibold text-tx outline-none"
            value={selectedId ?? ''}
            onChange={(e) => select(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="" className="bg-bg">{t.topbar.allAccounts}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id} className="bg-bg">{a.name}</option>
            ))}
          </select>
        </span>
        <span className="pointer-events-none absolute right-3"><Icon name="chevron" size={16} /></span>
      </label>

      <div className="control flex gap-0.5 !rounded-full p-1" role="group" aria-label={t.topbar.period}>
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={`rounded-full px-3.5 py-[7px] text-[13px] font-semibold transition ${
              period === p ? 'text-white shadow-[0_6px_18px_-6px_rgba(139,127,232,.9)]' : 'text-tx2 hover:text-tx'
            }`}
            style={period === p ? { background: 'var(--grad)' } : undefined}
          >
            {t.topbar.periods[p]}
          </button>
        ))}
      </div>

      <div className="flex-1" />
      <button className="control grid h-11 w-11 place-items-center !rounded-full text-tx2" aria-label={t.topbar.notifications}>
        <Icon name="bell" />
      </button>
      <button className="btn btn-primary" onClick={() => navigate('/trades')}>
        <Icon name="plus" size={18} /> {t.topbar.newTrade}
      </button>
    </header>
  )
}
