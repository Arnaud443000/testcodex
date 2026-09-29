import { NavLink } from 'react-router-dom'
import { useT } from '../../i18n'

/** Bascule entre le calendrier des résultats (/calendar) et le calendrier économique (/calendar/news). */
export function CalendarTabs() {
  const t = useT().news.page
  const cls = ({ isActive }: { isActive: boolean }) =>
    `rounded-[11px] px-4 py-1.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet ${
      isActive ? 'text-white' : 'text-tx2 hover:text-tx'
    }`
  const style = ({ isActive }: { isActive: boolean }) => (isActive ? { background: 'var(--grad)' } : undefined)
  return (
    <nav aria-label={t.tabsLabel} className="control inline-flex gap-0.5 self-start p-[3px]">
      <NavLink to="/calendar" end className={cls} style={style}>
        {t.tabPnl}
      </NavLink>
      <NavLink to="/calendar/news" className={cls} style={style}>
        {t.tabNews}
      </NavLink>
    </nav>
  )
}
