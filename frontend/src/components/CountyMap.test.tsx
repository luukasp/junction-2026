// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DashboardProvider } from '../data/DashboardContext'
import snapshot from '../data/countyLungTreatment.json'
import rawGeography from '../../public/finland.geojson?raw'
import { CountyMap } from './CountyMap'
import { getCountyCareCenters } from '../data/countyCareCenters'

const geography = JSON.parse(rawGeography)
function Harness() {
  const [selected, setSelected] = useState('HVA05')
  const county = snapshot.regions.find(region => region.regionId === selected)!
  return <DashboardProvider data={{ ...snapshot, data_loaded: true }}>
    <CountyMap countyId={selected} countyName={county.regionName} onCountyChange={setSelected} />
  </DashboardProvider>
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => geography })) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('county review map', () => {
  it('highlights and fits the selected county, and updates the review with keyboard selection', async () => {
    render(<Harness />)
    const map = await screen.findByRole('group', { name: 'County map of Southwest Finland' })
    const southwest = within(map).getByRole('button', { name: 'Southwest Finland' })
    expect(southwest.getAttribute('aria-pressed')).toBe('true')
    const originalPath = southwest.getAttribute('d')
    const centers = getCountyCareCenters('HVA05')
    expect(within(map).getAllByRole('img')).toHaveLength(centers.length)
    for (const center of centers) {
      const marker = within(map).getByRole('img', { name: center.name })
      expect(marker.querySelector('text')?.textContent?.replaceAll(' ', '')).toBe(center.name.replaceAll(' ', ''))
    }
    expect(within(screen.getByRole('list', { name: 'County care centers' })).getAllByRole('link').length).toBeGreaterThan(0)
    fireEvent.keyDown(within(map).getByRole('button', { name: 'Kymenlaakso' }), { key: 'Enter' })
    const nextMap = screen.getByRole('group', { name: 'County map of Kymenlaakso' })
    expect(within(nextMap).getByRole('button', { name: 'Kymenlaakso' }).getAttribute('aria-pressed')).toBe('true')
    expect(southwest.getAttribute('aria-pressed')).toBe('false')
    expect(southwest.getAttribute('d')).not.toBe(originalPath)
    expect(within(nextMap).getAllByRole('img')).toHaveLength(getCountyCareCenters('HVA10').length)
    for (const center of centers) expect(within(nextMap).queryByRole('img', { name: center.name })).toBeNull()
  })

  it('offers a retry when boundaries fail to load', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<Harness />)
    expect(await screen.findByText('The county map could not be loaded')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Retry map' }))
    expect(await screen.findByRole('group', { name: 'County map of Southwest Finland' })).toBeDefined()
  })
})
