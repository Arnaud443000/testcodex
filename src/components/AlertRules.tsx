import { useT } from '../i18n'

/** Règles personnelles que le trader a notées non respectées sur le trade d'une alerte ; rien si aucune (3.6.9). */
export function AlertRules({ texts }: { texts: string[] }) {
  const t = useT()
  if (texts.length === 0) return null
  return (
    <div className="mt-2 text-xs leading-relaxed" data-testid="alert-rules">
      <span className="font-semibold text-tx2">{t.alertHistory.brokenRules(texts.length)} : </span>
      <span className="text-tx">{texts.map((x) => `« ${x} »`).join(', ')}</span>
    </div>
  )
}
