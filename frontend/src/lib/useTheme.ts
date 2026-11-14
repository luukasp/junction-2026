import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'
const storageKey = 'equal-care-theme'

function parseTheme(value: string | null): Theme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function savedTheme(): Theme {
  try { return parseTheme(window.localStorage.getItem(storageKey)) } catch { return 'system' }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(savedTheme)

  useEffect(() => {
    const system = window.matchMedia?.('(prefers-color-scheme: dark)')
    function applyTheme() {
      const dark = theme === 'dark' || (theme === 'system' && Boolean(system?.matches))
      document.documentElement.classList.toggle('dark', dark)
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#161819' : '#f5f6f4')
    }
    applyTheme()
    system?.addEventListener('change', applyTheme)
    return () => system?.removeEventListener('change', applyTheme)
  }, [theme])

  useEffect(() => {
    function syncTheme(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) setTheme(savedTheme())
    }
    window.addEventListener('storage', syncTheme)
    return () => window.removeEventListener('storage', syncTheme)
  }, [])

  function selectTheme(next: Theme) {
    setTheme(next)
    try { window.localStorage.setItem(storageKey, next) } catch { /* Keep the control usable when storage is blocked. */ }
  }

  return [theme, selectTheme] as const
}
