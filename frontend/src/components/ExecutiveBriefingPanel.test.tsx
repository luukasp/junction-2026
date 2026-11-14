// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { DashboardProvider } from '../data/DashboardContext'
import lung from '../data/countyLungTreatment.json'
import { fixture } from '../test/pathwayFixture'
import { ExecutiveBriefingPanel } from './ExecutiveBriefingPanel'

function Briefing() {
  const [open, setOpen] = useState(false)
  return <DashboardProvider data={{ ...lung, data_loaded: true }} pathway={fixture}>
    <button type="button" onClick={() => setOpen(true)}>Open briefing</button>
    <ExecutiveBriefingPanel regionData={open ? lung.regions.find(region => region.regionId === 'HVA05')! : null} onClose={() => setOpen(false)} />
  </DashboardProvider>
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ proposal: null }) })))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.style.overflow = '' })

describe('Executive briefing full screen', () => {
  it('preserves expanded actions and a draft question when entering and leaving full screen', async () => {
    render(<Briefing />)
    fireEvent.click(screen.getByRole('button', { name: 'Open briefing' }))
    const panel = screen.getByRole('complementary', { name: 'Executive briefing' })
    const action = within(panel).getByRole('button', { name: /Close lung treatment-record gaps/ })
    fireEvent.click(action)
    const question = await within(panel).findByRole('textbox', { name: 'Your question' })
    fireEvent.change(question, { target: { value: 'Which gap should we review first?' } })

    fireEvent.click(within(panel).getByRole('button', { name: 'Enter full screen' }))
    const restore = within(panel).getByRole('button', { name: 'Exit full screen' })
    expect(restore.getAttribute('aria-pressed')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
    expect(action.getAttribute('aria-expanded')).toBe('true')
    expect((question as HTMLTextAreaElement).value).toBe('Which gap should we review first?')

    fireEvent.click(restore)
    expect(within(panel).getByRole('button', { name: 'Enter full screen' }).getAttribute('aria-pressed')).toBe('false')
    expect(document.body.style.overflow).toBe('')
    expect(action.getAttribute('aria-expanded')).toBe('true')
    expect((question as HTMLTextAreaElement).value).toBe('Which gap should we review first?')
  })

  it('uses Escape to restore the panel before closing and returns focus to the opener', () => {
    render(<Briefing />)
    const opener = screen.getByRole('button', { name: 'Open briefing' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Enter full screen' }))
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Enter full screen' }))
    expect(document.body.style.overflow).toBe('')
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('reopens in the side-panel layout and restores page scrolling on close or unmount', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(<Briefing />)
    fireEvent.click(screen.getByRole('button', { name: 'Open briefing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enter full screen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close briefing' }))
    expect(document.body.style.overflow).toBe('auto')
    fireEvent.click(screen.getByRole('button', { name: 'Open briefing' }))
    expect(screen.getByRole('button', { name: 'Enter full screen' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Enter full screen' }))
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })
})
