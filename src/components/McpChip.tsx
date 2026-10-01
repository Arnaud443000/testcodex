import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { McpStatus } from '../types/mcp'
import { Tooltip } from './ui/Tooltip'

/**
 * Lot 37 : repère discret dans la barre du haut tant que l'accès MCP est actif (lien vers le réglage). Dans le
 * flux de la barre, jamais un élément fixe par-dessus le contenu. Relu à l'ouverture, toutes les 30 s, et quand
 * l'accès change (panneau, échéance, verrouillage).
 */
export function McpChip() {
  const t = useT().mcp
  const [status, setStatus] = useState<McpStatus | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = () =>
      api
        .getMcpStatus()
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus(null))
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    const off = api.onMcpChanged(() => void refresh())
    return () => {
      alive = false
      window.clearInterval(timer)
      void off.then((f) => f())
    }
  }, [])
  if (!status?.active) return null
  const until = status.expiresAt !== null ? t.until(formatDateTime(status.expiresAt)) : t.untilClose
  return (
    <Tooltip content={t.chipTooltip(until)}>
      <Link to="/settings#mcp" className="chip chip-on gap-2 whitespace-nowrap" data-testid="mcp-chip">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gain" />
        {t.chip}
      </Link>
    </Tooltip>
  )
}
