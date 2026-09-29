import { useState } from 'react'
import { useT } from '../i18n'
import type { Tag, TagKind } from '../types/trade'
import { ChipButton } from './ui'

/** Tags réutilisables d'un genre, avec création à la volée (« + Nouveau »). */
export function TagChips({
  kind,
  tags,
  isOn,
  onToggle,
  onCreate,
  bad = false,
  label,
}: {
  kind: TagKind
  tags: Tag[]
  isOn: (tagId: number) => boolean
  onToggle: (tagId: number) => void
  onCreate: (kind: TagKind, name: string) => Promise<Tag>
  bad?: boolean
  label: string
}) {
  const t = useT()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const list = tags.filter((g) => g.kind === kind)

  const submit = async () => {
    if (!name.trim()) return
    try {
      const tag = await onCreate(kind, name)
      setName('')
      setAdding(false)
      setError(null)
      onToggle(tag.id)
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''))
    }
  }

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {list.map((g) => (
          <ChipButton key={g.id} on={isOn(g.id)} onClick={() => onToggle(g.id)} bad={bad}>
            {g.name}
          </ChipButton>
        ))}
        {!adding && (
          <button type="button" className="chip" onClick={() => setAdding(true)}>
            {t.form.addTag}
          </button>
        )}
      </div>
      {adding && (
        <div className="flex gap-2">
          <input
            autoFocus
            className="input !h-[36px] max-w-[220px]"
            aria-label={`${label} — ${t.form.placeholders.newTag}`}
            placeholder={t.form.placeholders.newTag}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void submit()}>
            {t.form.create}
          </button>
          <button type="button" className="btn-link" onClick={() => setAdding(false)}>
            {t.common.cancel}
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-[#F5A198]">{error}</p>}
    </div>
  )
}
