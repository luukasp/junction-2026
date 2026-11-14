import { api } from '../lib/api'
import type { Dashboard } from './DashboardContext'
import type { PathwaySnapshot } from './pathway'

export type LoadedData = { data: Dashboard; pathway: PathwaySnapshot; offline: boolean; notice: string }

const isPathway = (value: unknown): value is PathwaySnapshot => {
  const v = value as PathwaySnapshot | null
  return !!v && Array.isArray(v.stages) && Array.isArray(v.indicators) && Array.isArray(v.counties) && typeof v.national === 'object'
}

async function cachedDashboard(): Promise<Dashboard> {
  const { default: snapshot } = await import('./countyLungTreatment.json')
  return { regions: snapshot.regions, period: snapshot.period, observationWindow: snapshot.observationWindow, sourceUrl: snapshot.sourceUrl, data_loaded: true }
}
async function cachedPathway(): Promise<PathwaySnapshot> {
  const { default: snapshot } = await import('./pathway_snapshot.json')
  return snapshot as unknown as PathwaySnapshot
}

/** Loads live data and falls back to the bundled snapshots when the backend is unreachable or empty. */
export async function loadData(signal?: AbortSignal): Promise<LoadedData> {
  const [dashboard, pathway] = await Promise.allSettled([api<Dashboard>('/dashboard', { signal }), api<PathwaySnapshot>('/pathway', { signal })])
  signal?.throwIfAborted()
  const liveDashboard = dashboard.status === 'fulfilled' && dashboard.value?.data_loaded && Array.isArray(dashboard.value.regions) ? dashboard.value : null
  const livePathway = pathway.status === 'fulfilled' && isPathway(pathway.value) ? pathway.value : null
  const unreachable = dashboard.status === 'rejected' && pathway.status === 'rejected'
  const offline = !liveDashboard || !livePathway
  return {
    data: liveDashboard ?? await cachedDashboard(),
    pathway: livePathway ?? await cachedPathway(),
    offline,
    notice: !offline ? '' : unreachable ? 'Backend offline — showing cached snapshot' : 'Some live data is unavailable — showing cached snapshot',
  }
}
