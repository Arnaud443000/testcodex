import { NavLink } from 'react-router-dom'
import { useT, type Messages } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { Icon, type IconName } from './Icon'
import { Logo } from './Logo'

export const NAV: { to: string; key: keyof Messages['nav']; icon: IconName }[] = [
  { to: '/', key: 'dashboard', icon: 'dashboard' },
  { to: '/trades', key: 'trades', icon: 'trades' },
  { to: '/calendar', key: 'calendar', icon: 'calendar' },
  { to: '/analytics', key: 'analytics', icon: 'analytics' },
  { to: '/behavior', key: 'behavior', icon: 'behavior' },
  { to: '/journal', key: 'journal', icon: 'journal' },
  { to: '/goals', key: 'goals', icon: 'goals' },
  { to: '/settings', key: 'settings', icon: 'settings' },
]

export function Sidebar() {
  const { accounts } = useAccounts()
  const t = useT()
  return (
    <aside className="glass-bar flex w-[248px] shrink-0 flex-col border-r px-4 py-[26px]">
      <div className="flex items-center gap-3 px-2.5 pb-[30px]">
        <Logo />
        <span className="text-[26px] font-light leading-none tracking-tight">Pulse</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map(({ to, key, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3.5 rounded-md px-4 py-3 text-[15px] font-medium transition ${
                isActive
                  ? 'bg-gradient-to-br from-blue/30 to-violet/20 text-white shadow-[0_8px_24px_-10px_rgba(139,127,232,.7),inset_0_1px_0_rgba(255,255,255,.12)]'
                  : 'text-tx2 hover:bg-white/5 hover:text-tx'
              }`
            }
          >
            <Icon name={icon} />
            <span>{t.nav[key]}</span>
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center gap-3 border-t px-2.5 pt-4" style={{ borderColor: 'var(--hairline)' }}>
        <div
          className="grid h-[38px] w-[38px] place-items-center rounded-full font-semibold text-white"
          style={{ background: 'var(--grad)' }}
        >
          {t.sidebar.user.charAt(0)}
        </div>
        <div className="leading-tight">
          <b className="block text-sm">{t.sidebar.user}</b>
          <span className="text-xs text-tx3">
            {t.sidebar.local} · {t.sidebar.accounts(accounts.length)}
          </span>
        </div>
      </div>
    </aside>
  )
}
