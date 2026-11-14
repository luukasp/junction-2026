import { Check, Loader2 } from 'lucide-react'
import type { Step } from '../lib/aiGeneration'

export function GenerationSteps({ steps, active }: { steps: Step[]; active: boolean }) {
  const visible = steps.length ? steps : active ? [{ stage: 'starting', message: 'Starting' }] : []
  return visible.length ? <ol className="grid gap-1" aria-label="Progress">{visible.map((step, index) => {
    const working = active && index === visible.length - 1
    return <li key={index} className="flex list-none items-center gap-2 text-xs text-muted">
      {working ? <Loader2 size={12} strokeWidth={2} aria-hidden className="animate-spin text-accent motion-reduce:animate-none" /> : <Check size={12} strokeWidth={2} aria-hidden />}
      <span className={working ? 'text-secondary' : ''}>{step.message}{working ? '…' : ''}</span>
    </li>
  })}</ol> : null
}
