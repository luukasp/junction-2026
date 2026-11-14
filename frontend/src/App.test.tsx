// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'
import bundled from './data/pathway_snapshot.json'
import lung from './data/countyLungTreatment.json'
import type { PathwaySnapshot } from './data/pathway'
import { fixture } from './test/pathwayFixture'

const snapshot = bundled as unknown as PathwaySnapshot
const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:plan'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Equal Care Finland', () => {
  it('falls back to the bundled snapshot when the backend is down and exports an action plan', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(<App />)
    expect(await screen.findByText('Backend offline — showing cached snapshot')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Equal Care Finland' })).toBeDefined()
    expect(screen.getByText(snapshot.national_headline)).toBeDefined()
    expect(within(screen.getByRole('list', { name: 'Care pathway stages' })).getAllByRole('button')).toHaveLength(snapshot.stages.length + (snapshot.indicators.some(i => !snapshot.stages.some(s => s.id === i.stage)) ? 1 : 0))

    const county = snapshot.counties.find(c => c.actions.length > 0)!
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: county.name }))
    const briefing = screen.getByRole('complementary')
    expect(within(briefing).getByText(county.headline)).toBeDefined()
    expect(within(briefing).getByText(county.actions[0].title)).toBeDefined()
    expect(within(briefing).getByText(/AI review and chat need the backend/)).toBeDefined()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(within(briefing).getByRole('button', { name: 'Export action plan' }))
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
  })

  it('uses live pathway data, and stage buttons drive the map and the area list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/dashboard')) return json({ ...lung, data_loaded: true })
      if (url.endsWith('/api/v1/pathway')) return json(fixture)
      return { ok: false } as Response
    }))
    render(<App />)
    expect(await screen.findByText(fixture.national_headline)).toBeDefined()
    expect(screen.queryByText(/showing cached snapshot/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Where to act first' })).toBeDefined()
    expect(screen.getByText('43.1%')).toBeDefined()
    const stages = screen.getByRole('list', { name: 'Care pathway stages' })
    expect((within(stages).getByRole('button', { name: /Referral/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(stages).getByRole('button', { name: /Detection/ }))
    expect(within(stages).getByRole('button', { name: /Detection/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('72.5%')).toBeDefined()
    expect(screen.getByText(/Bowel screening attendance · 2024/)).toBeDefined()
  })

  it('reports partial outages and falls back when the database is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/dashboard') ? json({ regions: [], data_loaded: false }) : { ok: false, status: 404, json: async () => ({}) } as Response))
    render(<App />)
    expect(await screen.findByText('Some live data is unavailable — showing cached snapshot')).toBeDefined()
  })
})
