import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useT } from '../i18n'

export function PlaceholderPage({ title, subtitle, step }: { title: string; subtitle: string; step: number }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} subtitle={subtitle} />
      <section className="glass-card">
        <EmptyState title={t.placeholder.title}>{t.placeholder.text(step)}</EmptyState>
      </section>
    </div>
  )
}
