import { useState } from 'react'
import { Tooltip } from '../ui/Tooltip'
import { Icon } from '../Icon'
import { Select } from '../ui/Select'
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
  const iconBtn = 'btn-icon disabled:opacity-60'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        className="!h-9 !w-auto min-w-[200px] max-w-[280px] !text-[13.5px]"
        ariaLabel={t.switcherLabel}
        value={current.key}
        onChange={onSelect}
        options={[
          ...builtin.map((s) => ({ value: s.key, label: label(s), group: t.builtinGroup })),
          ...custom.map((s) => ({ value: s.key, label: label(s), group: t.customGroup })),
        ]}
      />
      <Tooltip content={current.isDefault ? t.isDefault : t.makeDefault}>
        <button type="button" className={iconBtn} aria-pressed={current.isDefault} disabled={current.isDefault} aria-label={current.isDefault ? t.isDefault : t.makeDefault} onClick={onSetDefault}>
          <span className={current.isDefault ? 'text-violet' : ''}><Icon name="star" size={17} /></span>
        </button>
      </Tooltip>
      {!current.builtin && (
        <>
          <Tooltip content={t.rename}>
            <button type="button" className={iconBtn} aria-label={t.rename} onClick={onRename}><Icon name="edit" size={17} /></button>
          </Tooltip>
          <Tooltip content={t.delete}>
            <button type="button" className={iconBtn} aria-label={t.delete} onClick={() => setConfirmDelete(true)}><Icon name="cross" size={17} /></button>
          </Tooltip>
        </>
      )}
      <Tooltip content={t.newDashboard}>
        <button type="button" className={iconBtn} aria-label={t.newDashboard} onClick={onNew}><Icon name="plus" size={17} /></button>
      </Tooltip>
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
