// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Sidebar } from './Sidebar'

let system: MediaQueryList
let listeners: Set<() => void>

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
  document.head.innerHTML = '<meta name="theme-color" content="#f5f6f4">'
  listeners = new Set()
  system = {
    matches: false,
    addEventListener: vi.fn((_event, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event, listener: () => void) => listeners.delete(listener)),
  } as unknown as MediaQueryList
  vi.stubGlobal('matchMedia', vi.fn(() => system))
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderSidebar() {
  return render(<Sidebar open onClose={() => {}} view="national" onNavigate={() => {}} />)
}

function setSystemDark(matches: boolean) {
  act(() => {
    Object.defineProperty(system, 'matches', { value: matches, configurable: true })
    listeners.forEach(listener => listener())
  })
}

describe('navigation appearance', () => {
  it('defaults to System and follows live system changes', () => {
    renderSidebar()
    const navigation = screen.getByRole('navigation', { name: 'Dashboard navigation' })
    const appearance = within(navigation).getByRole('group', { name: 'Appearance' })
    expect(within(appearance).getAllByRole('radio').map(input => (input as HTMLInputElement).value)).toEqual(['system', 'light', 'dark'])
    expect((within(appearance).getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    setSystemDark(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#161819')
    setSystemDark(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f5f6f4')
  })

  it('persists explicit choices and ignores system changes until System is selected again', () => {
    const view = renderSidebar()
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(window.localStorage.getItem('equal-care-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    setSystemDark(true)
    setSystemDark(false)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    view.unmount()
    renderSidebar()
    expect((screen.getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    setSystemDark(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem('equal-care-theme')).toBe('light')
    fireEvent.click(screen.getByRole('radio', { name: 'System' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('equal-care-theme')).toBe('system')
  })

  it('uses the dark system preference for an invalid saved choice and cleans up listeners', () => {
    window.localStorage.setItem('equal-care-theme', 'invalid')
    Object.defineProperty(system, 'matches', { value: true })
    const view = renderSidebar()
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(listeners.size).toBe(0)
  })

  it('syncs saved choices and storage resets from other tabs', () => {
    renderSidebar()
    act(() => {
      window.localStorage.setItem('equal-care-theme', 'dark')
      window.dispatchEvent(new StorageEvent('storage', { key: 'equal-care-theme', newValue: 'dark' }))
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect((screen.getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true)
    act(() => {
      window.localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true)
  })

  it('still switches themes when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
    renderSidebar()
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
