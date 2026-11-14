import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'

const iconButton = 'grid size-10 shrink-0 place-items-center rounded-lg border border-line text-secondary transition-colors duration-150 ease-out hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none'

export function BriefingDrawer({ id, title, open, onClose, children }: { id: string; title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) { setWasOpen(open); setExpanded(false) }
  const fullscreen = open && expanded
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    closeButton.current?.focus()
    return () => { if (previous instanceof HTMLElement || previous instanceof SVGElement) previous.focus() }
  }, [open])
  useEffect(() => {
    if (!fullscreen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [fullscreen])

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (fullscreen) { setExpanded(false); expandButton.current?.focus() } else onClose()
    }
    if (fullscreen && event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], textarea, input, select, summary, [tabindex="0"]'))
        .filter(element => !element.closest('[hidden], [inert]') && !element.matches(':disabled') && element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }

  return <aside id={id} aria-labelledby={`${id}-title`} aria-hidden={!open} inert={!open} onKeyDown={onKeyDown}
    className={`fixed inset-y-0 right-0 z-30 flex h-dvh w-full flex-col border-l border-line bg-panel transition-transform duration-300 ease-out motion-reduce:transition-none ${fullscreen ? 'max-w-none border-l-0' : 'max-w-xl'} ${open ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}>
    <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4 sm:px-8">
      <h2 id={`${id}-title`} className="text-sm font-medium text-secondary">{title}</h2>
      <div className="flex items-center gap-2">
        <button ref={expandButton} onClick={() => setExpanded(value => !value)} type="button" aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} aria-pressed={fullscreen} className={iconButton}>{fullscreen ? <Minimize2 size={16} strokeWidth={1.5} aria-hidden /> : <Maximize2 size={16} strokeWidth={1.5} aria-hidden />}</button>
        <button ref={closeButton} onClick={onClose} type="button" aria-label="Close briefing" className={iconButton}><X size={16} strokeWidth={1.5} aria-hidden /></button>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
  </aside>
}
