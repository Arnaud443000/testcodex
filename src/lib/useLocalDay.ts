import { useEffect, useState } from 'react'
import { dayOfInstant } from './analysisView'
import { localTzOffsetMin } from './period'

/** Le jour local du PC (et son décalage), remis à jour chaque minute et au retour sur la fenêtre (passage de minuit compris). */
export function useLocalDay(): { day: string; tz: number } {
  const read = () => {
    const tz = localTzOffsetMin()
    return { day: dayOfInstant(Date.now(), tz), tz }
  }
  const [value, setValue] = useState(read)
  useEffect(() => {
    const update = () => setValue((v) => {
      const next = read()
      return next.day === v.day && next.tz === v.tz ? v : next
    })
    const timer = setInterval(update, 60_000)
    window.addEventListener('focus', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [])
  return value
}
