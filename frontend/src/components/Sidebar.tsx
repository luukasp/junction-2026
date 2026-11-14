import { Activity, ChartNoAxesCombined, Map, MapPin } from 'lucide-react'

type View = 'analytics' | 'national' | 'county'
type Props = { view: View; onNavigate: (view: View) => void }

export function Sidebar({ view, onNavigate }: Props) {
  return <nav aria-label="Dashboard navigation" className="border-b border-line bg-panel px-4 py-4 md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-r md:border-b-0 md:p-5">
    <div className="mb-6 hidden items-center gap-2 text-sm font-medium text-secondary md:flex">
      <Activity size={16} strokeWidth={1.5} aria-hidden />Equal Care Finland
    </div>
    <p className="mb-2 text-xs text-muted">Dashboards</p>
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-1">
      {([{ id: 'analytics', label: 'Analytics', icon: ChartNoAxesCombined }, { id: 'national', label: 'National Overview', icon: Map }, { id: 'county', label: 'County Review', icon: MapPin }] as const).map(item => <button key={item.id} type="button" onClick={() => onNavigate(item.id)} aria-current={view === item.id ? 'page' : undefined}
        className={`flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none ${view === item.id ? 'bg-raised text-accent' : 'text-secondary hover:bg-raised hover:text-ink'}`}>
        <item.icon size={16} strokeWidth={1.5} className="shrink-0" aria-hidden />{item.label}
      </button>)}
    </div>
    <p className="mt-auto hidden border-t border-line pt-4 text-xs leading-relaxed text-muted md:block">Cancer care across Finland’s wellbeing services counties</p>
  </nav>
}
