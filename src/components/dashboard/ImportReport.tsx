import { Modal } from './Modal'
import { useT } from '../../i18n'
import type { ImportWarning } from '../../types/dashboardLayout'

/** Texte d'un avertissement d'import (les titres des widgets viennent du catalogue de textes). */
export function useWarningText(): (w: ImportWarning) => string {
  const b = useT().dashboardBuilder
  const title = (kind: string) => b.widgets[kind]?.title ?? kind
  return (w) => {
    switch (w.code) {
      case 'unknownWidget':
        return b.transfer.warning.unknownWidget(w.kind)
      case 'unknownAccount':
        return b.transfer.warning.unknownAccount(w.name, title(w.widgetKind))
      case 'unknownScopeAccount':
        return b.transfer.warning.unknownScopeAccount(w.name)
      case 'renamed':
        return b.transfer.warning.renamed(w.from, w.to)
    }
  }
}

/** Ce que l'import a adapté ou ignoré : affiché seulement s'il y a des remarques. */
export function ImportReport({ name, warnings, onClose }: { name: string; warnings: ImportWarning[]; onClose: () => void }) {
  const t = useT().dashboardBuilder.transfer
  const text = useWarningText()
  return (
    <Modal title={t.reportTitle} onClose={onClose}>
      <p className="mb-3 text-sm text-tx2">{t.reportIntro(name)}</p>
      <ul className="mb-5 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed" data-testid="import-warnings">
        {warnings.map((w, i) => (
          <li key={i}>{text(w)}</li>
        ))}
      </ul>
      <div className="flex justify-end">
        <button type="button" className="btn btn-primary" data-close onClick={onClose}>{t.reportClose}</button>
      </div>
    </Modal>
  )
}
