import { asVerdict, verdictColors, verdictLabels } from '../data/pathway'

export function VerdictDot({ verdict }: { verdict: unknown }) {
  return <span aria-hidden className="inline-block size-3 shrink-0 rounded-sm" style={{ backgroundColor: verdictColors[asVerdict(verdict)] }} />
}

export function VerdictBadge({ verdict, title }: { verdict: unknown; title?: string }) {
  const id = asVerdict(verdict)
  return <span title={title} className="inline-flex items-center gap-2 text-xs text-secondary"><VerdictDot verdict={id} />{verdictLabels[id]}</span>
}
