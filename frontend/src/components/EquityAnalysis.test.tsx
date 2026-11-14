// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EquityAnalysis } from './EquityAnalysis'
import { AIGenerationProvider } from '../data/AIGenerationContext'
import { defaultEquitySelection } from '../data/equity'
import { equityCatalog, equityRows, savedEquityBriefing } from '../test/equityFixture'
import { openEventStream } from '../test/sse'

const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = '' })
const dashboard = () => render(<AIGenerationProvider><EquityAnalysis /></AIGenerationProvider>)

function mockApi() {
  const saved = new Map<string, typeof savedEquityBriefing>()
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/demographics/filters')) {
      const catalog = structuredClone(equityCatalog)
      if (url.includes('program=breast')) catalog.filters.gender = { available: false, values: [], description: 'Sex is not published' }
      return json(catalog)
    }
    if (url.endsWith('/demographics/briefing/lookup')) return json({ briefing: saved.get(String(options?.body)) ?? null })
    if (url.includes('/demographics/briefing/stream')) {
      saved.set(String(options?.body), savedEquityBriefing)
      const stream = openEventStream()
      stream.push({ type: 'briefing', briefing: savedEquityBriefing })
      stream.finish()
      return stream.response
    }
    if (url.includes('/demographics?')) {
      const query = new URL(url, 'http://localhost').searchParams
      const items = query.has('language') || query.get('program') === 'breast' ? [] : equityRows
      return json({ items, total: items.length, limit: 1000, offset: 0 })
    }
    throw new Error('Unexpected request ' + url)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function openBriefing() {
  const opener = screen.getByRole('button', { name: 'Open AI briefing' })
  await waitFor(() => expect((opener as HTMLButtonElement).disabled).toBe(false))
  opener.focus()
  fireEvent.click(opener)
  const generate = await screen.findByRole('button', { name: 'Generate AI briefing' })
  await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false))
  return generate
}

describe('Equity Analysis', () => {
  it('renders highest and unweighted average KPIs with both charts and exact source evidence', async () => {
    const fetchMock = mockApi()
    dashboard()
    const chart = await screen.findByRole('figure', { name: 'Screening attendance by demographic group' })
    expect(within(chart).getByRole('img', { name: 'Primary education/unknown: 60.0% attendance' })).toBeTruthy()
    expect(screen.getByRole('figure', { name: 'Published downstream screening counts' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Equity evidence summary' })).getByText('20.0')).toBeTruthy()
    expect(within(screen.getByText('Highest observed screening attendance').parentElement!).getByText('80.0%')).toBeTruthy()
    expect(within(screen.getByText('Average screening attendance').parentElement!).getByText('70.0%')).toBeTruthy()
    expect(screen.getByText('Unweighted mean of 2 published groups; excludes totals and missing values.')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'AI briefing' })).toBeNull()
    expect((screen.getByRole('combobox', { name: 'Reporting year' }) as HTMLSelectElement).value).toBe('2024')
    expect(screen.queryByRole('combobox', { name: 'Socioeconomic status' })).toBeNull()
    expect(fetchMock.mock.calls.some(([url]) => url.includes('year=2024') && url.includes('geographic_location=Whole+country'))).toBe(true)
    fireEvent.click(screen.getByText('Source evidence · 11 observations'))
    expect(screen.getByRole('table', { name: 'Exact registry observations used in the charts and briefing' })).toBeTruthy()
  })

  it('limits global filters to programme and year while keeping analytical tool controls', async () => {
    const fetchMock = mockApi()
    dashboard()
    await screen.findByRole('figure', { name: 'Screening attendance by demographic group' })
    const globalFilters = screen.getByRole('region', { name: 'Global demographic filters' })
    expect(within(globalFilters).getAllByRole('combobox')).toHaveLength(2)
    expect(within(globalFilters).getByRole('combobox', { name: 'Screening programme' })).toBeTruthy()
    expect(within(globalFilters).getByRole('combobox', { name: 'Reporting year' })).toBeTruthy()
    expect(within(globalFilters).queryByRole('button')).toBeNull()
    const comparison = within(screen.getByRole('region', { name: 'Participation disparity' })).getByRole('combobox', { name: 'Compare by' })
    expect(within(comparison).getAllByRole('option').map(option => option.textContent)).toEqual(['Education', 'Native language', 'Age group', 'Published sex', 'Geography'])
    expect(within(screen.getByRole('region', { name: 'Downstream impact funnel' })).getByRole('combobox', { name: 'Funnel cohort' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Reporting year' }), { target: { value: '2023' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/demographics?') && url.includes('year=2023'))).toBe(true))
  })

  it('does not apply hidden demographic restrictions from a restored selection', async () => {
    const fetchMock = mockApi()
    const selection = { ...defaultEquitySelection, filters: { ...defaultEquitySelection.filters, language: 'Other/missing', age_group: '60', gender: 'female', education_level: 'Tertiary/higher education', geographic_location: 'Central Finland' } }
    render(<AIGenerationProvider><EquityAnalysis selection={selection} /></AIGenerationProvider>)
    await screen.findByRole('figure', { name: 'Screening attendance by demographic group' })
    const request = fetchMock.mock.calls.find(([url]) => url.includes('/demographics?'))!
    const query = new URL(request[0], 'http://localhost').searchParams
    for (const key of ['language', 'age_group', 'gender', 'education_level']) expect(query.has(key)).toBe(false)
    expect(query.get('geographic_location')).toBe('Whole country')
  })

  it('clears stale charts for unpublished programmes and keeps comparison controls available', async () => {
    mockApi()
    dashboard()
    await screen.findByRole('figure', { name: 'Screening attendance by demographic group' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Screening programme' }), { target: { value: 'breast' } })
    expect(screen.queryByRole('figure', { name: 'Screening attendance by demographic group' })).toBeNull()
    expect(await screen.findByRole('heading', { name: 'No comparable published groups' })).toBeTruthy()
    expect((screen.getByRole('option', { name: 'Published sex' }) as HTMLOptionElement).disabled).toBe(true)
    expect(screen.getByRole('combobox', { name: 'Compare by' })).toBeTruthy()
  })

  it('keeps separate cached briefings when the funnel cohort changes and restores the original', async () => {
    const fetchMock = mockApi()
    dashboard()
    fireEvent.click(await openBriefing())
    expect(await screen.findByText('A cited equity review.')).toBeTruthy()
    const request = fetchMock.mock.calls.find(([url]) => url.includes('/demographics/briefing/stream'))!
    const body = JSON.parse(String(request[1]?.body))
    expect(body.observation_ids).toHaveLength(11)
    expect(body.question).toContain('Primary education/unknown')
    expect(screen.getByRole('link', { name: 'screening:1' }).getAttribute('href')).toBe(equityRows[0].source_url)
    fireEvent.change(screen.getByRole('combobox', { name: 'Funnel cohort' }), { target: { value: 'Tertiary/higher education' } })
    expect(screen.queryByText('A cited equity review.')).toBeNull()
    expect(await screen.findByRole('button', { name: 'Generate AI briefing' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Funnel cohort' }), { target: { value: 'Primary education/unknown' } })
    expect(await screen.findByText('A cited equity review.')).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/demographics/briefing/stream'))).toHaveLength(1)
  })

  it('matches the executive panel close, full-screen, Escape and focus behavior', async () => {
    mockApi()
    dashboard()
    await openBriefing()
    const panel = screen.getByRole('complementary', { name: 'AI briefing' })
    expect(panel.className).toContain('fixed')
    expect(panel.className).toContain('max-w-xl')
    fireEvent.click(within(panel).getByRole('button', { name: 'Enter full screen' }))
    expect(panel.className).toContain('max-w-none')
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(document.activeElement).toBe(within(panel).getByRole('button', { name: 'Enter full screen' }))
    expect(document.body.style.overflow).toBe('')
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'AI briefing' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open AI briefing' }))
  })

  it('keeps deterministic evidence visible when streamed generation fails', async () => {
    const fetchMock = mockApi()
    dashboard()
    const button = await openBriefing()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ detail: 'AI service unavailable' }) } as Response)
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('AI service unavailable'))
    expect(screen.getByRole('figure', { name: 'Screening attendance by demographic group' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Evidence at a glance' })).toBeTruthy()
  })

  it('restores a saved briefing after remount without generating again', async () => {
    const fetchMock = mockApi()
    const rendered = dashboard()
    fireEvent.click(await openBriefing())
    await screen.findByText('A cited equity review.')
    rendered.unmount()
    dashboard()
    const opener = screen.getByRole('button', { name: 'Open AI briefing' })
    await waitFor(() => expect((opener as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(opener)
    expect(await screen.findByText('A cited equity review.')).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/demographics/briefing/stream'))).toHaveLength(1)
  })

  it('offers a retry rather than substituting national data when the API is offline', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network unavailable'))
    vi.stubGlobal('fetch', fetchMock)
    dashboard()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Network unavailable'))
    fetchMock.mockImplementation(async (url: string) => url.includes('/filters') ? json(equityCatalog) : json({ items: equityRows, total: 15 }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry equity data' }))
    expect(await screen.findByRole('figure', { name: 'Screening attendance by demographic group' })).toBeTruthy()
  })
})
