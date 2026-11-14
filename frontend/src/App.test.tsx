// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import bundled from './data/pathway_snapshot.json'
import lung from './data/countyLungTreatment.json'
import type { PathwaySnapshot } from './data/pathway'
import { fixture } from './test/pathwayFixture'
import { openEventStream } from './test/sse'
import { equityCatalog, equityRows, savedEquityBriefing } from './test/equityFixture'

const snapshot = bundled as unknown as PathwaySnapshot
const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:plan'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Equal Care Finland', () => {
  it('keeps equity generation running across dashboards and reopens its exact scope from activity', async () => {
    const stream = openEventStream()
    let signal: AbortSignal | null | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dashboard')) return json({ ...lung, data_loaded: true })
      if (url.endsWith('/pathway')) return json(fixture)
      if (url.includes('/demographics/filters')) return json(equityCatalog)
      if (url.includes('/demographics?')) return json({ items: equityRows, total: equityRows.length })
      if (url.endsWith('/demographics/briefing/lookup')) return json({ briefing: null })
      if (url.includes('/demographics/briefing/stream')) { signal = init?.signal; return stream.response }
      return json({ proposal: null })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await screen.findByText(fixture.national_headline)
    fireEvent.click(screen.getByRole('button', { name: 'Equity Analysis' }))
    const opener = screen.getByRole('button', { name: 'Open AI briefing' })
    await waitFor(() => expect((opener as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(opener)
    const generate = await screen.findByRole('button', { name: 'Generate AI briefing' })
    await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(generate)
    await waitFor(() => expect(signal).toBeTruthy())
    await act(async () => {
      stream.push({ type: 'status', stage: 'drafting', message: 'Drafting equity findings' })
      stream.push({ type: 'delta', text: 'An equity draft in progress' })
    })
    expect(await screen.findByText('An equity draft in progress')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close briefing' }))
    expect(signal?.aborted).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'National Overview' }))
    await act(async () => { stream.push({ type: 'status', stage: 'checking', message: 'Checking equity citations' }) })
    const activity = screen.getByRole('region', { name: 'AI generation activity' })
    expect(within(activity).getByText('Checking equity citations')).toBeTruthy()
    expect(signal?.aborted).toBe(false)
    fireEvent.click(within(activity).getByRole('button', { name: /View briefing progress for Equity Analysis/ }))
    expect(await screen.findByText('An equity draft in progress')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Reporting year' }) as HTMLSelectElement).value).toBe('2024')
    expect((screen.getByRole('combobox', { name: 'Funnel cohort' }) as HTMLSelectElement).value).toBe('Primary education/unknown')
    await act(async () => { stream.push({ type: 'briefing', briefing: savedEquityBriefing }); stream.finish() })
    expect(await screen.findByText('A cited equity review.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'AI generation activity' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'National Overview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Equity Analysis' }))
    const reopen = screen.getByRole('button', { name: 'Open AI briefing' })
    await waitFor(() => expect((reopen as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(reopen)
    expect(await screen.findByText('A cited equity review.')).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/demographics/briefing/stream'))).toHaveLength(1)
  })

  it.each(['review', 'chat'] as const)('shows %s progress across dashboards and reopens the ongoing attempt', async kind => {
    const stream = openEventStream()
    let signal: AbortSignal | null | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dashboard')) return json({ ...lung, data_loaded: true })
      if (url.endsWith('/pathway')) return json(fixture)
      if (url.endsWith('/conversations')) return json({ id: 'ongoing-chat', version: 0, turns: [] })
      if (url.endsWith('/stream')) { signal = init?.signal; return stream.response }
      return json({ proposal: null })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await screen.findByText(fixture.national_headline)
    expect(screen.queryByRole('region', { name: 'AI generation activity' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'County Review' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'County' }), { target: { value: 'HVA05' } })
    const generate = await screen.findByRole('button', { name: 'Generate review' })
    await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(kind === 'review' ? generate : screen.getByRole('button', { name: 'How does our screening uptake compare?' }))
    await waitFor(() => expect(signal).toBeTruthy())
    await act(async () => {
      stream.push({ type: 'status', stage: 'drafting', message: 'Drafting from county evidence' })
      stream.push({ type: 'delta', text: 'Draft before switching' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Equity Analysis' }))
    const activity = screen.getByRole('region', { name: 'AI generation activity' })
    const countyName = lung.regions.find(region => region.regionId === 'HVA05')!.regionName
    expect(within(activity).getByText(`${countyName} · Generating ${kind === 'review' ? 'review' : 'answer'}`)).toBeTruthy()
    expect(signal?.aborted).toBe(false)
    await act(async () => {
      stream.push({ type: 'status', stage: 'checking', message: 'Checking citations' })
      stream.push({ type: 'delta', text: 'Draft continued in another view' })
    })
    expect(within(activity).getByText('Checking citations')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'County Review' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'County' }), { target: { value: 'HVA10' } })
    expect(screen.queryByText('Draft continued in another view')).toBeNull()
    fireEvent.click(within(activity).getByRole('button', { name: `View ${kind === 'review' ? 'review' : 'answer'} progress for ${countyName}` }))
    const panel = screen.getByRole('complementary', { name: 'Executive briefing' })
    expect(await within(panel).findByText('Draft continued in another view')).toBeTruthy()
    expect(within(panel).getByText('Checking citations…')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Close briefing' }))
    const response = {
      answer: { reply: 'Completed while away', summary: 'County review', findings: [], proposals: [], limitations: ['Review locally'] },
      evidence: [], quality: { imported_at: '2026-11-14T12:00:00', screening_mainland_coverage: true, coverage: [], limitations: [] },
      model: 'test', provider: 'test', conversation_id: 'ongoing-chat', version: 1,
    }
    await act(async () => {
      stream.push(kind === 'review'
        ? { type: 'proposal', proposal: { ...response, id: 1, area_code: 'HVA05', created_at: '2026-11-14T12:00:00', stale: false } }
        : { type: 'done', response })
      stream.finish()
    })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'AI generation activity' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'County Review' }))
    const tools = screen.getByRole('complementary', { name: 'Review tools and county questions' })
    expect(await within(tools).findByText('Completed while away')).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/stream'))).toHaveLength(1)
  })

  it('closes and reopens navigation with keyboard focus and the current dashboard preserved', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/dashboard')) return json({ ...lung, data_loaded: true })
      if (url.endsWith('/pathway')) return json(fixture)
      return { ok: false } as Response
    }))
    render(<App />)
    await screen.findByText(fixture.national_headline)

    for (const dashboard of ['Equity Analysis', 'National Overview', 'County Review']) {
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

  it('defaults to National Overview and puts Equity Analysis last in navigation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/dashboard')) return json({ ...lung, data_loaded: true })
      if (url.endsWith('/pathway')) return json(fixture)
      return { ok: false } as Response
    }))
    render(<App />)
    await screen.findByText(fixture.national_headline)
    const navigation = screen.getByRole('navigation', { name: 'Dashboard navigation' })
    expect(screen.getByRole('heading', { name: 'National Overview' })).toBeDefined()
    expect(within(navigation).getByRole('button', { name: 'National Overview' }).getAttribute('aria-current')).toBe('page')
    expect(within(within(navigation).getByRole('group', { name: 'Dashboards' })).getAllByRole('button').map(button => button.textContent)).toEqual(['National Overview', 'County Review', 'Equity Analysis'])
    fireEvent.click(within(navigation).getByRole('button', { name: 'Equity Analysis' }))
    expect(screen.getByRole('heading', { name: 'Equity Analysis' })).toBeDefined()
    fireEvent.click(within(navigation).getByRole('button', { name: 'National Overview' }))
    expect(screen.getByRole('heading', { name: 'National Overview' })).toBeDefined()
  })
})
