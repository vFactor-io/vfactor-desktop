import { create } from "zustand"
import { loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"

const STORE_FILE = "settings.json"
const GIT_GENERATION_MODEL_KEY = "gitGenerationModel"
const PERSIST_DEBOUNCE_MS = 250

interface SettingsState {
  gitGenerationModel: string
  hasLoaded: boolean
  initialize: () => Promise<void>
  setGitGenerationModel: (model: string) => void
  resetGitGenerationModel: () => void
}

let storeInstance: DesktopStoreHandle | null = null
let initializePromise: Promise<void> | null = null
let persistTimeoutId: ReturnType<typeof setTimeout> | null = null

async function getStore(): Promise<DesktopStoreHandle> {
  if (!storeInstance) {
    storeInstance = await loadDesktopStore(STORE_FILE)
  }

  return storeInstance
}

function normalizeGitGenerationModel(model: string | null | undefined): string {
  if (!model) {
    return ""
  }

  return model.trim()
}

function schedulePersist(model: string): void {
  if (persistTimeoutId != null) {
    clearTimeout(persistTimeoutId)
  }

  persistTimeoutId = setTimeout(() => {
    persistTimeoutId = null

    void (async () => {
      try {
        const store = await getStore()
        await store.set(GIT_GENERATION_MODEL_KEY, model)
        await store.save()
      } catch (error) {
        console.error("Failed to persist settings:", error)
      }
    })()
  }, PERSIST_DEBOUNCE_MS)
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  gitGenerationModel: "",
  hasLoaded: false,

  initialize: async () => {
    if (get().hasLoaded) {
      return
    }

    if (initializePromise) {
      return initializePromise
    }

    initializePromise = (async () => {
      try {
        const store = await getStore()
        const savedModel = await store.get<string>(GIT_GENERATION_MODEL_KEY)

        set({
          gitGenerationModel: normalizeGitGenerationModel(savedModel),
          hasLoaded: true,
        })
      } catch (error) {
        console.error("Failed to load settings:", error)
        set({
          gitGenerationModel: "",
          hasLoaded: true,
        })
      }
    })().finally(() => {
      initializePromise = null
    })

    return initializePromise
  },

  setGitGenerationModel: (model) => {
    const normalized = normalizeGitGenerationModel(model)
    set({ gitGenerationModel: normalized })
    schedulePersist(normalized)
  },

  resetGitGenerationModel: () => {
    set({ gitGenerationModel: "" })
    schedulePersist("")
  },
}))

export { normalizeGitGenerationModel }
