import { Loader2 } from 'lucide-react'
import { useGenerationActivity } from '../data/AIGenerationContext'
import { useDashboard } from '../data/DashboardContext'
import type { EquitySelection } from '../data/equity'

export function GenerationActivity({ onOpenCounty, onOpenEquity }: { onOpenCounty: (areaCode: string) => void; onOpenEquity: (selection: EquitySelection) => void }) {
  const activity = useGenerationActivity()
  const { regionsById } = useDashboard()
  if (!activity.length) return null
  return <section aria-label="AI generation activity" className="border-b border-line bg-panel">
    <ul className="mx-auto grid max-w-7xl gap-3 px-4 py-3 sm:px-8">
      {activity.map(item => {
        const name = item.kind === 'equity' ? 'Equity Analysis: ' + item.label : regionsById.get(item.areaCode)?.regionName ?? item.areaCode
        const kind = item.kind === 'review' ? 'review' : item.kind === 'equity' ? 'briefing' : 'answer'
        return <li key={item.kind === 'equity' ? item.key : item.areaCode + ':' + item.kind} className="flex items-center gap-3">
          <Loader2 size={16} strokeWidth={1.5} aria-hidden className="shrink-0 animate-spin text-muted motion-reduce:animate-none" />
          <div role="status" className="min-w-0 flex-1">
            <p className="text-sm text-secondary">{name} · Generating {kind}</p>
            <p className="mt-1 text-xs text-muted">{item.message}</p>
          </div>
          <button type="button" onClick={() => item.kind === 'equity' ? onOpenEquity(item.selection) : onOpenCounty(item.areaCode)} aria-label={'View ' + kind + ' progress for ' + name}
            className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs text-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">View progress</button>
        </li>
      })}
    </ul>
  </section>
}
