import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'

const MAX_BYTES = 15 * 1024 * 1024

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('read error'))
    r.readAsDataURL(file)
  })
}

/** Zone de dépôt de screenshot (charte 5.9) : glisser-déposer, coller, ou choisir un fichier. */
export function ScreenshotDrop({ path, onChange }: { path: string | null; onChange: (path: string | null) => void }) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setUrl(null)
    if (path) {
      api
        .readScreenshot(path)
        .then((u) => live && setUrl(u))
        .catch((e) => live && setError(t.form.screenshot.error(String(e))))
    }
    return () => {
      live = false
    }
  }, [path, t])

  const accept = async (file: File | undefined | null) => {
    if (!file) return
    setError(null)
    if (!file.type.startsWith('image/')) return setError(t.form.screenshot.notImage)
    if (file.size > MAX_BYTES) return setError(t.form.screenshot.tooBig)
    try {
      onChange(await api.saveScreenshot(await readAsDataUrl(file)))
    } catch (e) {
      setError(t.form.screenshot.error(String(e).replace(/^Error: /, '')))
    }
  }

  // Coller depuis le presse-papiers (hors champs de texte).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        void accept(file)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section aria-label={t.form.screenshot.title} className="flex flex-col gap-2">
      {path && url && (
        <div className="overflow-hidden rounded-inner border" style={{ borderColor: 'var(--hairline)' }}>
          <img src={url} alt={t.form.screenshot.alt} className="block max-h-[220px] w-full object-contain" />
        </div>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void accept(e.dataTransfer.files[0])
        }}
        className={`flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-inner border-[1.5px] border-dashed px-4 py-3 text-center text-sm text-tx3 transition ${
          over ? 'border-violet bg-violet/10' : 'border-white/[.22]'
        }`}
      >
        {path ? (
          <div className="flex gap-4">
            <button type="button" className="btn-link" onClick={() => input.current?.click()}>{t.form.screenshot.replace}</button>
            <button type="button" className="btn-link" onClick={() => onChange(null)}>{t.form.screenshot.remove}</button>
          </div>
        ) : (
          <>
            <span>{t.form.screenshot.drop}</span>
            <span className="text-xs">
              {t.form.screenshot.or}{' '}
              <button type="button" className="btn-link !text-xs" onClick={() => input.current?.click()}>{t.form.screenshot.choose}</button>
            </span>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            void accept(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {error && <p role="alert" className="text-xs text-[#F5A198]">{error}</p>}
    </section>
  )
}
