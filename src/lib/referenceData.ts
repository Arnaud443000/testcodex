import { useCallback, useEffect, useState } from 'react'
import type { ChecklistItem, Instrument, NewInstrument, Rule, Tag, TagKind } from '../types/trade'
import { api } from './api'

export interface ReferenceData {
  instruments: Instrument[]
  /** Tags actifs de tous les genres. */
  tags: Tag[]
  /** Règles et éléments de checklist actifs. */
  rules: Rule[]
  checklist: ChecklistItem[]
  /** Tags, règles et éléments archivés inclus : pour relire d'anciens trades. */
  allTags: Tag[]
  allRules: Rule[]
  loading: boolean
  error: string | null
  addInstrument: (i: NewInstrument) => Promise<Instrument>
  addTag: (kind: TagKind, name: string) => Promise<Tag>
  addRule: (text: string) => Promise<Rule>
  addChecklistItem: (label: string) => Promise<ChecklistItem>
}

/** Listes de référence (actifs, tags, règles, checklist), chargées une fois par écran. */
export function useReferenceData(): ReferenceData {
  const [instruments, setInstruments] = useState<Instrument[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [allRules, setAllRules] = useState<Rule[]>([])
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([api.listInstruments(), api.listTags(undefined, true), api.listRules(true), api.listChecklist(false)])
      .then(([i, t, r, c]) => {
        if (!live) return
        setInstruments(i)
        setAllTags(t)
        setAllRules(r)
        setChecklist(c)
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [])

  const addInstrument = useCallback(async (n: NewInstrument) => {
    const i = await api.createInstrument(n)
    setInstruments((prev) => [...prev, i].sort((a, b) => a.symbol.localeCompare(b.symbol)))
    return i
  }, [])
  const addTag = useCallback(async (kind: TagKind, name: string) => {
    const t = await api.createTag(kind, name)
    setAllTags((prev) => [...prev, t])
    return t
  }, [])
  const addRule = useCallback(async (text: string) => {
    const r = await api.createRule(text)
    setAllRules((prev) => [...prev, r])
    return r
  }, [])
  const addChecklistItem = useCallback(async (label: string) => {
    const c = await api.createChecklistItem(label)
    setChecklist((prev) => [...prev, c])
    return c
  }, [])

  return {
    instruments,
    tags: allTags.filter((t) => !t.archived),
    rules: allRules.filter((r) => !r.archived),
    checklist,
    allTags,
    allRules,
    loading,
    error,
    addInstrument,
    addTag,
    addRule,
    addChecklistItem,
  }
}
