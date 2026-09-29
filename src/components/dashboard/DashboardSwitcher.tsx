import { useState } from 'react'
import { Icon } from '../Icon'
import { ConfigMenu } from './ConfigMenu'
import { Modal } from './Modal'
import { useT } from '../../i18n'
import type { DashboardLayout, DashboardSummary } from '../../types/dashboardLayout'

/**
 * Choix du dashboard affiché (3.8.5) et gestion des dashboards de l'utilisateur : par défaut au démarrage (3.8.6),
 * renommer, supprimer, nouveau. Les dashboards livrés restent en lecture seule.
 */
export function DashboardSwitcher({
  summaries,
  current,
  onSelect,
  onSetDefault,
  onRename,
  onDelete,
  onNew,
  onDuplicate,
  onExport,
  onImport,
  transferBusy,
}: {
  summaries: DashboardSummary[]
  current: DashboardLayout
  onSelect: (key: string) => void
  onSetDefault: () => void
  onRename: () => void
  onDelete: () => Promise<void>
  onNew: () => void
  onDuplicate: () => void
  onExport: () => void
  onImport: () => void
  transferBusy: boolean
}) {
  const all = useT()
  const t = all.dashboardBuilder.toolbar
  const [confirmDelete, setConfirmDelete] = useState(false)
  const label = (s: DashboardSummary) => (s.isDefault ? `${s.name} ${t.defaultMark}` : s.name)
  const builtin = summaries.filter((s) => s.builtin)
  const custom = summaries.filter((s) => !s.builtin)
  const iconBtn =
    'control grid h-[42px] w-[42px] place-items-center !rounded-full text-tx2 hover:text-tx focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet disabled:opacity-60'
  return (
    <div className="flex items-center gap-2">
      <span className="relative">
        <select className="input min-w-[230px]" aria-label={t.switcherLabel} value={current.key} onChange={(e) => onSelect(e.target.value)}>
          <optgroup label={t.builtinGroup} className="bg-bg">
            {builtin.map((s) => (
              <option key={s.key} value={s.key} className="bg-bg">{label(s)}</option>
            ))}
          </optgroup>
          {custom.length > 0 && (
            <optgroup label={t.customGroup} className="bg-bg">
              {custom.map((s) => (
                <option key={s.key} value={s.key} className="bg-bg">{label(s)}</option>
              ))}
            </optgroup>
          )}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tx3"><Icon name="chevron" size={16} /></span>
      </span>
      <button type="button" className={iconBtn} aria-pressed={current.isDefault} disabled={current.isDefault} title={current.isDefault ? t.isDefault : t.makeDefault} aria-label={current.isDefault ? t.isDefault : t.makeDefault} onClick={onSetDefault}>
        <span className={current.isDefault ? 'text-violet' : ''}><Icon name="star" size={18} /></span>
      </button>
      {!current.builtin && (
        <>
          <button type="button" className={iconBtn} title={t.rename} aria-label={t.rename} onClick={onRename}><Icon name="edit" size={18} /></button>
          <button type="button" className={iconBtn} title={t.delete} aria-label={t.delete} onClick={() => setConfirmDelete(true)}><Icon name="cross" size={18} /></button>
        </>
      )}
      <button type="button" className={iconBtn} title={t.newDashboard} aria-label={t.newDashboard} onClick={onNew}><Icon name="plus" size={18} /></button>
      <ConfigMenu onDuplicate={onDuplicate} onExport={onExport} onImport={onImport} busy={transferBusy} />
      {confirmDelete && (
        <Modal title={t.delete} onClose={() => setConfirmDelete(false)}>
          <p className="mb-5 text-sm text-tx2">{t.deleteConfirm(current.name)}</p>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn btn-secondary" data-close onClick={() => setConfirmDelete(false)}>{all.common.cancel}</button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                void onDelete().finally(() => setConfirmDelete(false))
              }}
            >
              {t.deleteYes}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
