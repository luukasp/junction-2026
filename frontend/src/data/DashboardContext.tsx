import { createContext, useContext, type ReactNode } from 'react'
import type { RegionData } from './regions'

export type Dashboard = { regions: RegionData[]; period: string; observationWindow: string; sourceUrl: string; data_loaded: boolean }
const Context = createContext<Dashboard | null>(null)
export function DashboardProvider({ data, children }: { data: Dashboard; children: ReactNode }) {
  return <Context.Provider value={data}>{children}</Context.Provider>
}
// Shared provider and hook intentionally live together.
// oxlint-disable-next-line react/only-export-components
export function useDashboard() {
  const data = useContext(Context)
  if (!data) throw new Error('Dashboard data is not loaded')
  const reportingRegions = data.regions.filter((r): r is RegionData & { patients: number; missing: number; share: number } => r.patients !== null && r.patients > 0 && r.missing !== null && r.share !== null)
  const totalPatients = reportingRegions.reduce((sum, r) => sum + r.patients, 0)
  const totalMissing = reportingRegions.reduce((sum, r) => sum + r.missing, 0)
  return { ...data, reportingRegions, totalPatients, totalMissing, pooledShare: totalPatients ? 100 * totalMissing / totalPatients : 0, regionsById: new Map(data.regions.map(r => [r.regionId, r])) }
}
