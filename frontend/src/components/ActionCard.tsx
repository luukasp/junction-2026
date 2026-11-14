import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import type { PathwayAction } from '../data/pathway'
import { VerdictBadge } from './VerdictBadge'

type Props = { action: PathwayAction; number: number; stage: string; verdict: unknown }
const link = 'text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent'

export function ActionCard({ action, number, stage, verdict }: Props) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()

  return <li className="overflow-hidden rounded-xl border border-line bg-panel">
    <h4>
      <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}
        className="flex w-full items-start gap-3 p-4 text-left transition-colors duration-150 ease-out hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none">
        <span className="min-w-0 flex-1 text-sm font-medium leading-relaxed">{action.title}</span>
        <span className="mt-1 shrink-0"><VerdictBadge verdict={action.verdict ?? verdict} /></span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden className={`mt-1 shrink-0 text-muted transition-transform duration-150 ease-out motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
      </button>
    </h4>
    <div id={contentId} hidden={!expanded} className="border-t border-line p-4">
      <p className="text-xs text-muted">Action {number} · {stage}</p>
      {action.reason && <p className="mt-3 text-sm leading-relaxed text-secondary">{action.reason}</p>}
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted">Baseline</dt><dd className="mt-1 text-secondary">{action.baseline}</dd></div>
        <div><dt className="text-xs text-muted">Target</dt><dd className="mt-1 text-secondary">{action.target}</dd></div>
        <div><dt className="text-xs text-muted">Annual volume</dt><dd className="mt-1 text-secondary">{action.annual_volume}</dd></div>
        <div><dt className="text-xs text-muted">Owner</dt><dd className="mt-1 text-secondary">{action.owner}</dd></div>
      </dl>
      {action.first_90_days.length > 0 && <div className="mt-4">
        <p className="text-xs text-muted">First 90 days{action.timeline ? ` · ${action.timeline}` : ''}</p>
        <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm leading-relaxed text-secondary">{action.first_90_days.map((step, i) => <li key={i}>{step}</li>)}</ol>
      </div>}
      {action.concrete_steps.length > 0 && <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-xs text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">Further steps · {action.concrete_steps.length}</summary>
        <ul className="mt-2 grid list-disc gap-1 pl-5 leading-relaxed text-secondary">{action.concrete_steps.map((step, i) => <li key={i}>{step}</li>)}</ul>
      </details>}
      {action.escalation && <p className="mt-4 border-t border-line pt-4 text-sm leading-relaxed text-secondary"><span className="text-xs text-muted">Escalate if no change · </span>{action.escalation}</p>}
      {action.citations.length > 0 && <ul className="mt-4 grid gap-2 text-xs" aria-label="Sources">
        {action.citations.map((citation, i) => <li key={i}>{citation.url ? <a href={citation.url} target="_blank" rel="noreferrer" className={link}>{citation.label}</a> : <span className="text-muted">{citation.label}</span>}</li>)}
      </ul>}
    </div>
  </li>
}
