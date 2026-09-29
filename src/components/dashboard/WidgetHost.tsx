import { useMemo } from 'react'
import { EmbeddedCardContext } from '../behavior/parts'
import { useT } from '../../i18n'
import { resolveScope, type ScopeEnv } from '../../lib/widgetScope'
import type { WidgetInstance } from '../../types/dashboardLayout'
import { WIDGET_COMPONENTS } from './widgets'

/** Affiche un widget avec sa période et son compte (les siens, à défaut ceux de la barre du haut). */
export function WidgetHost({ instance, env }: { instance: WidgetInstance; env: ScopeEnv }) {
  const t = useT().dashboardBuilder
  const scope = useMemo(
    () => resolveScope(instance, env),
    // Les seuls réglages qui changent la portée ; `instance` change aussi à chaque déplacement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instance.period, instance.accountId, env],
  )
  const Component = WIDGET_COMPONENTS[instance.kind]
  if (!Component) {
    return (
      <section className="glass-card flex h-full items-center justify-center p-6 text-center text-sm text-tx3" role="status">
        {t.unknownWidget}
      </section>
    )
  }
  const tags = [scope.periodOverridden ? t.ownPeriodTag(t.periods[scope.period]) : null, scope.ownAccountName ? t.ownAccountTag(scope.ownAccountName) : null].filter(
    (x): x is string => x !== null,
  )
  return (
    <div className="relative h-full">
      <EmbeddedCardContext.Provider value={true}>
        <Component scope={scope} instance={instance} />
      </EmbeddedCardContext.Provider>
      {tags.length > 0 && (
        <span className="pointer-events-none absolute bottom-2 right-3 rounded-full px-2 py-0.5 text-[11px] text-tx2" style={{ background: 'rgba(255,255,255,.08)' }}>
          {tags.join(' · ')}
        </span>
      )}
    </div>
  )
}
