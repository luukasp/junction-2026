import { createContext, useContext, type ReactNode } from 'react'
import type { RegionData } from './regions'
import type { PathwaySnapshot } from './pathway'

export type Dashboard = { regions: RegionData[]; period: string; observationWindow: string; sourceUrl: string; data_loaded: boolean }
type Value = { data: Dashboard; pathway: PathwaySnapshot | null; offline: boolean }
const Context = createContext<Value | null>(null)
export function DashboardProvider({ data, pathway = null, offline = false, children }: { data: Dashboard; pathway?: PathwaySnapshot | null; offline?: boolean; children: ReactNode }) {
  return <Context.Provider value={{ data, pathway, offline }}>{children}</Context.Provider>
}
// Shared provider and hook intentionally live together.
// oxlint-disable-next-line react/only-export-components
export function useDashboard() {
  const value = useContext(Context)
  if (!value) throw new Error('Dashboard data is not loaded')
  const { data, pathway, offline } = value
  const reportingRegions = data.regions.filter((r): r is RegionData & { patients: number; missing: number; share: number } => r.patients !== null && r.patients > 0 && r.missing !== null && r.share !== null)
  const totalPatients = reportingRegions.reduce((sum, r) => sum + r.patients, 0)
  const totalMissing = reportingRegions.reduce((sum, r) => sum + r.missing, 0)
  return {
    ...data, pathway, offline, reportingRegions, totalPatients, totalMissing,
    pooledShare: totalPatients ? 100 * totalMissing / totalPatients : 0,
    regionsById: new Map(data.regions.map(r => [r.regionId, r])),
    countiesById: new Map((pathway?.counties ?? []).map(c => [c.code, c])),
  }
}
