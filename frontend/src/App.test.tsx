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
  it('closes and reopens navigation with keyboard focus and the current dashboard preserved', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/dashboard')) return json({ ...lung, data_loaded: true })
      if (url.endsWith('/pathway')) return json(fixture)
      return { ok: false } as Response
    }))
    render(<App />)
    await screen.findByText(fixture.national_headline)

    for (const dashboard of ['Analytics', 'National Overview', 'County Review']) {
      const navigation = screen.getByRole('navigation', { name: 'Dashboard navigation' })
      fireEvent.click(within(navigation).getByRole('button', { name: dashboard }))
      fireEvent.click(within(navigation).getByRole('button', { name: 'Close navigation panel' }))

      expect(screen.queryByRole('navigation', { name: 'Dashboard navigation' })).toBeNull()
      expect(screen.queryByRole('radio', { name: 'System' })).toBeNull()
      expect(screen.getByRole('heading', { name: dashboard })).toBeDefined()
      const reopen = screen.getByRole('button', { name: 'Open navigation panel' })
      expect(reopen.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(reopen)

      fireEvent.click(reopen)
      const restored = screen.getByRole('navigation', { name: 'Dashboard navigation' })
      expect(within(restored).getByRole('button', { name: dashboard }).getAttribute('aria-current')).toBe('page')
      expect(screen.getByRole('heading', { name: dashboard })).toBeDefined()
      expect(within(restored).getByRole('group', { name: 'Appearance' })).toBeDefined()
      expect(document.activeElement).toBe(within(restored).getByRole('button', { name: 'Close navigation panel' }))
      expect(screen.queryByRole('button', { name: 'Open navigation panel' })).toBeNull()
    }
  })

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
    const action = within(briefing).getByRole('button', { name: new RegExp(county.actions[0].title) })
    const actionDetails = document.getElementById(action.getAttribute('aria-controls')!)!
    expect(action.getAttribute('aria-expanded')).toBe('false')
    expect(actionDetails.hidden).toBe(true)
    fireEvent.click(action)
    expect(action.getAttribute('aria-expanded')).toBe('true')
    expect(actionDetails.hidden).toBe(false)
    expect(within(actionDetails).getByText(county.actions[0].owner)).toBeDefined()
    fireEvent.click(action)
    expect(actionDetails.hidden).toBe(true)
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

  it('carries the selected county between dashboards and resets expanded county content when switching counties', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/dashboard')) return json({ ...lung, data_loaded: true })
      if (url.endsWith('/pathway')) return json(fixture)
      if (url.endsWith('/proposal')) return json({ proposal: null })
      return { ok: false } as Response
    }))
    render(<App />)
    await screen.findByText(fixture.national_headline)
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Southwest Finland' }))
    expect(screen.getByRole('complementary')).toBeDefined()
    const navigation = screen.getByRole('navigation', { name: 'Dashboard navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'County Review' }))

    expect(screen.getByRole('heading', { name: 'County Review' })).toBeDefined()
    expect(within(navigation).getByRole('button', { name: 'County Review' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('complementary', { name: 'Executive briefing' })).toBeNull()
    const tools = screen.getByRole('complementary', { name: 'Review tools and county questions' })
    expect(within(tools).getByRole('heading', { name: 'Review tools and county questions' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Review tools and county questions' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    const selector = screen.getByRole('combobox', { name: 'County' }) as HTMLSelectElement
    expect(selector.value).toBe('HVA05')
    const action = screen.getByRole('button', { name: /Close lung treatment-record gaps/ })
    expect(action.getAttribute('aria-expanded')).toBe('false')
    expect(within(action).getByText('Act')).toBeDefined()
    fireEvent.click(action)
    expect(await within(tools).findByRole('button', { name: 'Generate review' })).toBeDefined()
    fireEvent.change(within(tools).getByRole('textbox', { name: 'Your question' }), { target: { value: 'Check our current county' } })

    fireEvent.change(selector, { target: { value: 'HVA10' } })
    expect(screen.getByRole('heading', { name: 'Kymenlaakso' })).toBeDefined()
    expect(screen.getByText(/No action is triggered for this county/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Close lung treatment-record gaps/ })).toBeNull()
    const nextTools = screen.getByRole('complementary', { name: 'Review tools and county questions' })
    expect(await within(nextTools).findByRole('button', { name: 'Generate review' })).toBeDefined()
    expect((within(nextTools).getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement).value).toBe('')

    fireEvent.change(selector, { target: { value: 'HVA05' } })
    expect(screen.getByRole('button', { name: /Close lung treatment-record gaps/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(within(navigation).getByRole('button', { name: 'National Overview' }))
    expect(screen.getByRole('heading', { name: 'National Overview' })).toBeDefined()
    expect((screen.getByRole('combobox', { name: 'County' }) as HTMLSelectElement).value).toBe('HVA05')
  })

  it('shows county evidence on demand and labels the rest-of-Finland comparator accurately offline', async () => {
    const pathway = structuredClone(fixture)
    pathway.counties[0].values.lung_noinfo.comparator_kind = 'leave_one_out'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/pathway')) return json(pathway)
      throw new TypeError('Failed to fetch')
    }))
    render(<App />)
    await screen.findByText(/showing cached snapshot/)
    fireEvent.click(screen.getByRole('button', { name: 'County Review' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'County' }), { target: { value: 'HVA05' } })
    const indicators = screen.getByText('Inspect indicators · 2').closest('details')!
    expect(indicators.open).toBe(false)
    fireEvent.click(within(indicators).getByText('Inspect indicators · 2'))
    expect(indicators.open).toBe(true)
    const signal = within(indicators).getByText('Lung cancer patients without a treatment record').closest('details')!
    fireEvent.click(within(signal).getByText('Lung cancer patients without a treatment record'))
    expect(signal.open).toBe(true)
    expect(within(signal).getByText(/Rest of Finland:/)).toBeDefined()
    expect(within(signal).getByRole('link', { name: 'Source report' }).getAttribute('href')).toBe('https://example.org/lung')
    expect(screen.getByText(/AI review and chat need the backend/)).toBeDefined()
  })

  it('puts Analytics first in navigation and switches national outcome charts using published values', async () => {
    const pathway = structuredClone(fixture)
    pathway.indicators.push(
      { ...fixture.indicators[0], id: 'surv_lung_male', label: 'Five-year lung survival in men', short: 'Lung (men) survival', stage: 'outcome', period: '2020-2024' },
      { ...fixture.indicators[0], id: 'mort_lung_male', label: 'Lung mortality in men', short: 'Lung (men) mortality', stage: 'outcome', unit: '/100k', period: '2020-2024' },
    )
    pathway.national.surv_lung_male = { v: 16.7 }
    pathway.national.mort_lung_male = { v: 50.1 }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/dashboard')) return json({ ...lung, data_loaded: true })
      if (url.endsWith('/pathway')) return json(pathway)
      return { ok: false } as Response
    }))
    render(<App />)
    await screen.findByText(fixture.national_headline)
    const navigation = screen.getByRole('navigation', { name: 'Dashboard navigation' })
    expect(within(within(navigation).getByRole('group', { name: 'Dashboards' })).getAllByRole('button')[0].textContent).toBe('Analytics')
    fireEvent.click(within(navigation).getByRole('button', { name: 'Analytics' }))
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeDefined()
    expect(within(screen.getByRole('region', { name: 'Overall national status' })).getByText(/1 of 2 counties/)).toBeDefined()
    expect(screen.getByRole('img', { name: 'Bowel screening attendance: 70%, 2024' })).toBeDefined()
    expect(screen.getByRole('figure', { name: 'National five-year relative survival' })).toBeDefined()
    fireEvent.click(screen.getByRole('radio', { name: 'Mortality' }))
    expect(screen.queryByRole('figure', { name: 'National five-year relative survival' })).toBeNull()
    expect(screen.getByRole('img', { name: 'Lung mortality in men: 50.1 /100k, 2020-2024' })).toBeDefined()
    expect(screen.getByRole('img', { name: /Referral: 0 Act, 0 Verify data, 0 Monitor, 0 In line, 2 No data/ })).toBeDefined()
    fireEvent.click(within(navigation).getByRole('button', { name: 'National Overview' }))
    expect(screen.getByRole('heading', { name: 'National Overview' })).toBeDefined()
  })
})
