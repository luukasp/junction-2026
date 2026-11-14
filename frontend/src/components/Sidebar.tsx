import { useEffect, useRef } from 'react'
import { Activity, ChartNoAxesCombined, Map, MapPin, PanelLeftClose } from 'lucide-react'
import { ThemeSwitcher } from './ThemeSwitcher'

type View = 'analytics' | 'national' | 'county'
type Props = { view: View; onNavigate: (view: View) => void; open: boolean; onClose: () => void }

export function Sidebar({ view, onNavigate, open, onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const previouslyOpen = useRef(open)

  useEffect(() => {
    if (open && !previouslyOpen.current) closeButton.current?.focus()
    previouslyOpen.current = open
  }, [open])

  return <nav id="dashboard-navigation" aria-label="Dashboard navigation" hidden={!open} className={`${open ? 'md:flex' : 'hidden'} border-b border-line bg-panel px-4 py-4 md:sticky md:top-0 md:h-dvh md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:p-5`}>
    <div className="mb-4 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm font-medium text-secondary">
        <Activity size={16} strokeWidth={1.5} className="shrink-0" aria-hidden />Equal Care Finland
      </div>
      <button ref={closeButton} type="button" onClick={onClose} aria-label="Close navigation panel" title="Close navigation panel" aria-controls="dashboard-navigation" aria-expanded={open}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
        <PanelLeftClose size={16} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
    <p id="dashboard-navigation-heading" className="mb-2 text-xs text-muted">Dashboards</p>
    <div role="group" aria-labelledby="dashboard-navigation-heading" className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-1">
      {([{ id: 'analytics', label: 'Analytics', icon: ChartNoAxesCombined }, { id: 'national', label: 'National Overview', icon: Map }, { id: 'county', label: 'County Review', icon: MapPin }] as const).map(item => <button key={item.id} type="button" onClick={() => onNavigate(item.id)} aria-current={view === item.id ? 'page' : undefined}
        className={`flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none ${view === item.id ? 'bg-raised text-accent' : 'text-secondary hover:bg-raised hover:text-ink'}`}>
        <item.icon size={16} strokeWidth={1.5} className="shrink-0" aria-hidden />{item.label}
      </button>)}
    </div>
    <div className="mt-6 border-t border-line pt-4 md:mt-auto">
      <p className="mb-4 hidden text-xs leading-relaxed text-muted md:block">Cancer care across Finland’s wellbeing services counties</p>
      <ThemeSwitcher />
    </div>
  </nav>
}
