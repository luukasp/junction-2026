import type { LucideIcon } from 'lucide-react'

type Props = {
  title: string
  value: string
  detail: string
  icon: LucideIcon
}

export function KPICard({ title, value, detail, icon: Icon }: Props) {
  return (
    <article className="flex items-start justify-between gap-3 p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-medium text-secondary">{title}</h2>
        <p className="mt-2 font-mono text-3xl leading-none tabular-nums text-ink">{value}</p>
        <p className="mt-2 text-xs text-muted">{detail}</p>
      </div>
      <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-muted" aria-hidden />
    </article>
  )
}
