import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AIGenerationStore } from '../lib/aiGeneration'

const Context = createContext<AIGenerationStore | null>(null)
export function AIGenerationProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new AIGenerationStore())
  return <Context.Provider value={store}>{children}</Context.Provider>
}
function useStore() {
  const store = useContext(Context)
  if (!store) throw new Error('AI generation provider is not loaded')
  return store
}
// Shared provider and hooks intentionally live together.
// oxlint-disable-next-line react/only-export-components
export function useCountyAI(areaCode: string) {
  const session = useStore().forCounty(areaCode)
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => { session.initialize() }, [session])
  return { ...state, session }
}
// oxlint-disable-next-line react/only-export-components
export function useGenerationActivity() {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
