import { create } from "zustand"
import { listHarnesses, getHarnessAdapter } from "../runtime/harnesses"
import type { HarnessId, RuntimeModel } from "../types"

export const HARNESS_MODEL_CACHE_STALE_MS = 30 * 60 * 1000

export interface HarnessModelCacheEntry {
  models: RuntimeModel[]
  error: string | null
  isLoading: boolean
  isRefreshing: boolean
  hasLoaded: boolean
  lastFetchedAt: number | null
}

interface EnsureModelsOptions {
  staleAfterMs?: number
}

interface HarnessModelStoreState {
  entries: Partial<Record<HarnessId, HarnessModelCacheEntry>>
  ensureModels: (
    harnessId: HarnessId,
    options?: EnsureModelsOptions
  ) => Promise<RuntimeModel[]>
  refreshModels: (harnessId: HarnessId) => Promise<RuntimeModel[]>
  prefetchAllModels: () => Promise<void>
}

export const EMPTY_HARNESS_MODEL_ENTRY: HarnessModelCacheEntry = Object.freeze({
  models: [],
  error: null,
  isLoading: false,
  isRefreshing: false,
  hasLoaded: false,
  lastFetchedAt: null,
})

let inFlightModelRequests = new Map<HarnessId, Promise<RuntimeModel[]>>()

function getEntry(
  entries: Partial<Record<HarnessId, HarnessModelCacheEntry>>,
  harnessId: HarnessId
): HarnessModelCacheEntry {
  return entries[harnessId] ?? EMPTY_HARNESS_MODEL_ENTRY
}

function isEntryStale(
  entry: HarnessModelCacheEntry,
  staleAfterMs: number
): boolean {
  if (!entry.hasLoaded || entry.lastFetchedAt == null) {
    return true
  }

  return Date.now() - entry.lastFetchedAt > staleAfterMs
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useHarnessModelStore = create<HarnessModelStoreState>((set, get) => {
  const fetchModels = async (
    harnessId: HarnessId,
    options?: { background?: boolean }
  ): Promise<RuntimeModel[]> => {
    const existingRequest = inFlightModelRequests.get(harnessId)
    if (existingRequest) {
      return existingRequest
    }

    const currentEntry = getEntry(get().entries, harnessId)
    const keepExistingModels = options?.background === true || currentEntry.models.length > 0

    set((state) => ({
      entries: {
        ...state.entries,
        [harnessId]: {
          ...getEntry(state.entries, harnessId),
          error: null,
          isLoading: !keepExistingModels,
          isRefreshing: keepExistingModels,
        },
      },
    }))

    const request = (async () => {
      try {
        const models = await getHarnessAdapter(harnessId).listModels()

        set((state) => ({
          entries: {
            ...state.entries,
            [harnessId]: {
              models,
              error: null,
              isLoading: false,
              isRefreshing: false,
              hasLoaded: true,
              lastFetchedAt: Date.now(),
            },
          },
        }))

        return models
      } catch (error) {
        console.error(`[harnessModelStore] Failed to load ${harnessId} models:`, error)
        const errorMessage = getErrorMessage(error)

        set((state) => {
          const previousEntry = getEntry(state.entries, harnessId)

          return {
            entries: {
              ...state.entries,
              [harnessId]: {
                ...previousEntry,
                error: errorMessage,
                isLoading: false,
                isRefreshing: false,
              },
            },
          }
        })

        throw error
      } finally {
        inFlightModelRequests.delete(harnessId)
      }
    })()

    inFlightModelRequests.set(harnessId, request)
    return request
  }

  return {
    entries: {},

    ensureModels: async (harnessId, options) => {
      const existingRequest = inFlightModelRequests.get(harnessId)
      if (existingRequest) {
        return existingRequest
      }

      const entry = getEntry(get().entries, harnessId)
      const staleAfterMs = options?.staleAfterMs ?? HARNESS_MODEL_CACHE_STALE_MS

      if (!entry.hasLoaded) {
        return fetchModels(harnessId)
      }

      if (!isEntryStale(entry, staleAfterMs)) {
        return entry.models
      }

      void fetchModels(harnessId, { background: true }).catch(() => {
        // Keep stale data visible if the background refresh fails.
      })

      return entry.models
    },

    refreshModels: (harnessId) => fetchModels(harnessId, { background: true }),

    prefetchAllModels: async () => {
      const harnesses = listHarnesses()

      await Promise.allSettled(
        harnesses.map(({ id }) => get().ensureModels(id))
      )
    },
  }
})

export function prefetchHarnessModels(): Promise<void> {
  return useHarnessModelStore.getState().prefetchAllModels()
}

export function resetHarnessModelStoreForTests(): void {
  inFlightModelRequests = new Map<HarnessId, Promise<RuntimeModel[]>>()
  useHarnessModelStore.setState({ entries: {} })
}
