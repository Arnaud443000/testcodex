import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'

export function PlaceholderPage({ title, subtitle, step }: { title: string; subtitle: string; step: number }) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} subtitle={subtitle} />
      <section className="glass-card">
        <EmptyState title="Coming soon">
          This screen is planned for step {step} of the roadmap. The layout, navigation and data storage it will use are already in place.
        </EmptyState>
      </section>
    </div>
  )
}
