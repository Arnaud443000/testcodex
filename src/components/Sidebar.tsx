import { Link, useLocation } from 'react-router-dom'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { useInsights } from '../lib/insights'
import { api } from '../lib/api'
import { useLock } from '../lib/lock'
import { isNavActive, NAV_GROUPS, SETTINGS_ITEM, type NavItem } from '../lib/navigation'
import { Icon } from './Icon'
import { Logo } from './Logo'

/** Une entrée de navigation : icône + libellé toujours écrits ; l'état actif est marqué par le fond ET `aria-current`. */
function NavEntry({ item, active, children }: { item: NavItem; active: boolean; children?: React.ReactNode }) {
  const t = useT()
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3.5 rounded-md px-4 py-2.5 text-[15px] font-medium transition short:py-1.5 ${
        active
          ? 'bg-gradient-to-br from-blue/30 to-violet/20 text-white shadow-[0_8px_24px_-10px_rgba(139,127,232,.7),inset_0_1px_0_rgba(255,255,255,.12)]'
          : 'text-tx2 hover:bg-white/5 hover:text-tx'
      }`}
    >
      <Icon name={item.icon} />
      <span className="min-w-0 flex-1 truncate" title={t.nav[item.key]}>{t.nav[item.key]}</span>
      {children}
    </Link>
  )
}

export function Sidebar() {
  const { accounts } = useAccounts()
  const t = useT()
  const { pathname } = useLocation()
  const { unseen } = useInsights()
  const { status, setStatus } = useLock()
  return (
    <aside className="glass-bar flex w-[248px] shrink-0 flex-col border-r px-4 py-5 short:py-3">
      <div className="flex items-center gap-3 px-2.5 pb-5 short:pb-3">
        <Logo />
        <span className="text-[26px] font-light leading-none tracking-tight">Pulse</span>
      </div>
      {/* La liste défile toute seule quand la fenêtre est basse : « Paramètres » et le profil restent visibles en bas. */}
      <nav aria-label={t.nav.label} className="nav-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.key ?? 'top'} role="group" aria-label={group.key ? t.nav.groups[group.key] : undefined} className="flex flex-col gap-0.5 tiny:mt-1 tiny:first:mt-0">
            {group.key && (
              <div className="caption px-4 pb-1 pt-3 short:pt-2 tiny:hidden" aria-hidden="true">
                {t.nav.groups[group.key]}
              </div>
            )}
            {group.items.map((item) => (
              <NavEntry key={item.to} item={item} active={isNavActive(item, pathname)}>
                {item.to === '/insights' && unseen > 0 && (
                  <span className="badge badge-gain !px-2" data-testid="insights-unseen" aria-label={t.insights.sidebarUnseen(unseen)}>
                    {unseen > 9 ? '9+' : unseen}
                  </span>
                )}
              </NavEntry>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t pt-2" style={{ borderColor: 'var(--hairline)' }}>
        <NavEntry item={SETTINGS_ITEM} active={isNavActive(SETTINGS_ITEM, pathname)} />
      </div>
      <div className="flex items-center gap-3 px-2.5 pt-2">
        <div
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full font-semibold text-white"
          style={{ background: 'var(--grad)' }}
          aria-hidden="true"
        >
          {t.sidebar.user.charAt(0)}
        </div>
        <div className="min-w-0 leading-tight">
          <b className="block text-sm">{t.sidebar.user}</b>
          <span className="text-xs text-tx3">
            {t.sidebar.local} · {t.sidebar.accounts(accounts.length)}
          </span>
        </div>
        {status?.enabled && (
          <button
            type="button"
            className="btn-icon ml-auto"
            aria-label={t.lock.sidebar.lockHint}
            title={t.lock.sidebar.lockHint}
            data-testid="sidebar-lock"
            onClick={() => void api.lockNow().then(setStatus).catch(() => {})}
          >
            <Icon name="lock" size={17} />
          </button>
        )}
      </div>
    </aside>
  )
}
