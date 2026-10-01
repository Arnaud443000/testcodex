import { Link, useNavigate } from 'react-router-dom'
import { Tooltip } from './ui/Tooltip'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { PERIOD_KEYS, usePeriod } from '../lib/period'
import { Icon } from './Icon'
import { Select } from './ui/Select'
import { PauseControl } from './pause/PauseControl'

export function TopBar() {
  const { accounts, allAccounts, selectedId, select } = useAccounts()
  const viewedArchived = allAccounts.find((a) => a.id === selectedId && a.archived)
  const t = useT()
  const navigate = useNavigate()
  const { period, setPeriod } = usePeriod()

  return (
    <header
      className="glass-bar flex min-h-[72px] shrink-0 flex-wrap items-center gap-x-3.5 gap-y-2 border-b px-7 py-2"
    >
      <label className="control relative flex items-center gap-3 !rounded-full px-4 py-2 text-tx2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-violet">
        <Icon name="wallet" />
        <span className="leading-tight">
          <small className="block text-[11px] text-tx3">{t.topbar.account}</small>
          <Select
            variant="inline"
            ariaLabel={t.topbar.account}
            value={selectedId === null ? '' : String(selectedId)}
            onChange={(v) => select(v === '' ? null : Number(v))}
            options={[
              { value: '', label: t.topbar.allAccounts },
              ...accounts.map((a) => ({ value: String(a.id), label: a.name })),
              ...(viewedArchived ? [{ value: String(viewedArchived.id), label: t.accountAdmin.archivedOption(viewedArchived.name) }] : []),
            ]}
          />
        </span>
      </label>

      <div className="control flex gap-0.5 !rounded-full p-1" role="group" aria-label={t.topbar.period}>
        {PERIOD_KEYS.map((p) => (
          <button
            key={p}
            type="button"
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

      {/* Lot 35 : la grappe de droite passe entière sur une seconde ligne quand la puce de pause ne tient pas (jamais de défilement horizontal). */}
      <div className="ml-auto flex items-center gap-3.5">
      <PauseControl />
      {/* La cloche ouvre l'historique des alertes (avant le lot 26 : bouton sans action). */}
      <Tooltip content={t.topbar.notifications}>
        <Link to="/alerts" className="btn-icon !h-11 !w-11" aria-label={t.topbar.notifications}>
          <Icon name="bell" />
        </Link>
      </Tooltip>
      <button type="button" className="btn btn-primary" onClick={() => navigate('/trades/new')}>
        <Icon name="plus" size={18} /> {t.topbar.newTrade}
      </button>
      </div>
    </header>
  )
}
