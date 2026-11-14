import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '../lib/useTheme'

export function ThemeSwitcher() {
  const [theme, selectTheme] = useTheme()

  return <fieldset>
    <legend className="mb-2 text-xs text-muted">Appearance</legend>
    <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-page p-1">
      {([{ id: 'system', label: 'System', icon: Monitor }, { id: 'light', label: 'Light', icon: Sun }, { id: 'dark', label: 'Dark', icon: Moon }] as const).map(option => <label key={option.id} className="relative min-w-0 cursor-pointer">
        <input type="radio" name="theme" value={option.id} checked={theme === option.id} onChange={() => selectTheme(option.id)} className="peer sr-only" />
        <span className="flex min-h-10 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-xs text-secondary transition-colors duration-150 ease-out hover:bg-raised peer-checked:bg-raised peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent motion-reduce:transition-none">
          <option.icon size={16} strokeWidth={1.5} aria-hidden />{option.label}
        </span>
      </label>)}
    </div>
  </fieldset>
}
