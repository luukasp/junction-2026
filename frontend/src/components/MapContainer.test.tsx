// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DashboardProvider } from '../data/DashboardContext'
import snapshot from '../data/countyLungTreatment.json'
import rawGeography from '../../public/finland.geojson?raw'
import { MapContainer } from './MapContainer'

const geography = JSON.parse(rawGeography)
const onOpenBriefing = vi.fn()
function Harness() {
  const [selected, setSelected] = useState<string | null>(null)
  return <DashboardProvider data={{ ...snapshot, data_loaded: true }}>
    <MapContainer selectedRegionId={selected} onRegionSelect={setSelected} onOpenBriefing={onOpenBriefing} />
  </DashboardProvider>
}
function map() { return screen.getByRole('group', { name: 'Map of Finnish wellbeing services counties' }) }
function transform() { return document.querySelector('.rsm-zoomable-group')?.getAttribute('transform') }
async function ready() { await screen.findByRole('button', { name: /^Lapland,/ }) }
function mouse(target: Element | Window, type: string, options: MouseEventInit) {
  const event = new MouseEvent(type, { bubbles: true, ...options })
  // Vitest's window proxy does not pass jsdom 31's constructor brand check.
  Object.defineProperty(event, 'view', { value: window })
  fireEvent(target, event)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => geography }))
  onOpenBriefing.mockClear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('interactive county map', () => {
  it('supports zoom controls, keyboard panning and resetting to the national overview', async () => {
    render(<Harness />)
    await ready()
    const initial = transform()
    expect(document.querySelectorAll('.rsm-marker')).toHaveLength(26)
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByLabelText('Zoom level').textContent).toBe('1.5×')
    expect(transform()).not.toBe(initial)
    fireEvent.keyDown(map(), { key: 'ArrowRight' })
    const panned = transform()
    fireEvent.keyDown(map(), { key: 'ArrowUp' })
    expect(transform()).not.toBe(panned)
    fireEvent.keyDown(map(), { key: '+' })
    expect(screen.getByLabelText('Zoom level').textContent).toBe('2.3×')
    fireEvent.keyDown(map(), { key: 'Home' })
    expect(transform()).toBe(initial)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show all Finland' }))
    expect(transform()).toBe(initial)
  })

  it('zooms with a wheel and accepts trackpad pinch events with Ctrl pressed', async () => {
    render(<Harness />)
    await ready()
    const start = transform()
    fireEvent.wheel(map().querySelector('rect')!, { deltaY: -120, clientX: 200, clientY: 280, ctrlKey: true })
    await waitFor(() => expect(transform()).not.toBe(start))
    await waitFor(() => expect(Number.parseFloat(screen.getByLabelText('Zoom level').textContent!)).toBeGreaterThan(1))
    expect(screen.getByRole('button', { name: /^Lapland,/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('pans by dragging without selecting a county at the end of the gesture', async () => {
    render(<Harness />)
    await ready()
    const start = transform()
    const county = screen.getByRole('button', { name: /^Lapland,/ })
    mouse(county, 'mousedown', { button: 0, clientX: 150, clientY: 150 })
    mouse(window, 'mousemove', { buttons: 1, clientX: 190, clientY: 180 })
    mouse(window, 'mouseup', { button: 0, clientX: 190, clientY: 180 })
    expect(transform()).not.toBe(start)
    fireEvent.click(county)
    expect(county.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('list', { name: 'County care centers' })).toBeNull()
  })

  it('supports one-finger panning and two-finger pinch zoom on touchscreens', async () => {
    vi.stubGlobal('navigator', { maxTouchPoints: 2 })
    render(<Harness />)
    await ready()
    const background = map().querySelector('rect')!
    const touch = (identifier: number, clientX: number, clientY: number) => ({ identifier, clientX, clientY, target: background })
    const initial = transform()
    fireEvent.touchStart(background, { touches: [touch(1, 100, 200)], changedTouches: [touch(1, 100, 200)] })
    fireEvent.touchMove(background, { touches: [touch(1, 130, 220)], changedTouches: [touch(1, 130, 220)] })
    fireEvent.touchEnd(background, { touches: [], changedTouches: [touch(1, 130, 220)] })
    expect(transform()).not.toBe(initial)
    fireEvent.touchStart(background, { touches: [touch(2, 100, 250), touch(3, 200, 250)], changedTouches: [touch(2, 100, 250), touch(3, 200, 250)] })
    fireEvent.touchMove(background, { touches: [touch(2, 50, 250), touch(3, 250, 250)], changedTouches: [touch(2, 50, 250), touch(3, 250, 250)] })
    fireEvent.touchEnd(background, { touches: [], changedTouches: [touch(2, 50, 250), touch(3, 250, 250)] })
    expect(Number.parseFloat(screen.getByLabelText('Zoom level').textContent!)).toBeGreaterThan(1)
    expect(screen.queryByRole('list', { name: 'County care centers' })).toBeNull()
  })

  it('focuses a clicked county, lists its centers, and opens briefings only on request', async () => {
    render(<Harness />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /^Lapland,/ }))
    expect(screen.getByRole('button', { name: /^Lapland,/ }).getAttribute('aria-pressed')).toBe('true')
    expect(Number.parseFloat(screen.getByLabelText('Zoom level').textContent!)).toBeGreaterThan(1)
    const list = screen.getByRole('list', { name: 'County care centers' })
    expect(within(list).getAllByRole('button')).toHaveLength(2)
    expect(within(list).getByText('Rovaniemi')).toBeDefined()
    expect(within(list).getByText('Kemi')).toBeDefined()
    expect(onOpenBriefing).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open briefing' }))
    expect(onOpenBriefing).toHaveBeenCalledOnce()
    fireEvent.keyDown(screen.getByRole('button', { name: /^City of Helsinki,/ }), { key: 'Enter' })
    expect(screen.getByRole('button', { name: /^City of Helsinki,/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens center details from city markers and list entries without triggering the county behind them', async () => {
    render(<Harness />)
    await ready()
    const marker = screen.getByRole('button', { name: 'Espoo: Jorvi Hospital' })
    expect(within(marker).getByText('Espoo')).toBeDefined()
    fireEvent.click(marker)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('HVA03')
    expect(screen.getByRole('heading', { name: 'Jorvi Hospital' })).toBeDefined()
    expect(screen.getByText(/Karvasmäentie 8/)).toBeDefined()
    expect(screen.getByRole('link', { name: /Hospital information/ }).getAttribute('href')).toContain('/jorvi-hospital')
    expect(onOpenBriefing).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('list', { name: 'County care centers' })).getByRole('button', { name: /Lohja/ }))
    expect(screen.getByRole('heading', { name: 'Lohja Hospital' })).toBeDefined()
    expect(screen.queryByText(/Karvasmäentie 8/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close care-center details' }))
    expect(screen.queryByRole('heading', { name: 'Lohja Hospital' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'HVA91' } })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mariehamn: Åland Central Hospital' }), { key: ' ' })
    expect(screen.getByRole('heading', { name: 'Åland Central Hospital' })).toBeDefined()
    expect(screen.getByText(/Doktorsvägen 1/)).toBeDefined()
  })

  it('refocuses externally selected counties and clears details when switching counties', async () => {
    const select = vi.fn()
    const view = (id: string) => <DashboardProvider data={{ ...snapshot, data_loaded: true }}>
      <MapContainer selectedRegionId={id} onRegionSelect={select} onOpenBriefing={onOpenBriefing} />
    </DashboardProvider>
    const { rerender } = render(view('HVA21'))
    await ready()
    const fitted = transform()
    fireEvent.keyDown(map(), { key: 'ArrowRight' })
    expect(transform()).not.toBe(fitted)
    fireEvent.click(within(screen.getByRole('list', { name: 'County care centers' })).getByRole('button', { name: /Rovaniemi/ }))
    expect(screen.getByRole('heading', { name: 'Lapland Central Hospital' })).toBeDefined()
    rerender(view('HVA90'))
    expect(screen.queryByRole('heading', { name: 'Lapland Central Hospital' })).toBeNull()
    rerender(view('HVA21'))
    expect(transform()).toBe(fitted)
    expect(screen.queryByRole('heading', { name: 'Lapland Central Hospital' })).toBeNull()
  })

  it('shows a retry action when map boundaries fail to load', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response)
    render(<Harness />)
    expect(await screen.findByText('The map could not be loaded')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Retry map' }))
    await ready()
    expect(screen.queryByText('The map could not be loaded')).toBeNull()
  })
})
