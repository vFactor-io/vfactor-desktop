import { create } from "zustand"
import { loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"

const STORE_FILE = "settings.json"
const CREATE_PR_INSTRUCTIONS_KEY = "createPrInstructions"
const LEGACY_CREATE_PR_PROMPT_KEY = "createPrPrompt"
const PERSIST_DEBOUNCE_MS = 250

const LEGACY_DEFAULT_CREATE_PR_PROMPT =
  "Create a pull request for my current branch. Summarize the changes, include a concise test plan, and call out any risks or follow-up work."

interface SettingsState {
  createPrInstructions: string
  hasLoaded: boolean
  initialize: () => Promise<void>
  setCreatePrInstructions: (instructions: string) => void
  resetCreatePrInstructions: () => void
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

function normalizeCreatePrInstructions(prompt: string | null | undefined): string {
  if (!prompt) {
    return ""
  }

  if (prompt === LEGACY_DEFAULT_CREATE_PR_PROMPT) {
    return ""
  }

  return prompt
}

function schedulePersist(instructions: string): void {
  if (persistTimeoutId != null) {
    clearTimeout(persistTimeoutId)
  }

  persistTimeoutId = setTimeout(() => {
    persistTimeoutId = null

    void (async () => {
      try {
        const store = await getStore()
        await store.set(CREATE_PR_INSTRUCTIONS_KEY, instructions)
        await store.save()
      } catch (error) {
        console.error("Failed to persist settings:", error)
      }
    })()
  }, PERSIST_DEBOUNCE_MS)
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  createPrInstructions: "",
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
        const savedInstructions = await store.get<string>(CREATE_PR_INSTRUCTIONS_KEY)
        const legacyPrompt = await store.get<string>(LEGACY_CREATE_PR_PROMPT_KEY)

        set({
          createPrInstructions: normalizeCreatePrInstructions(savedInstructions ?? legacyPrompt),
          hasLoaded: true,
        })
      } catch (error) {
        console.error("Failed to load settings:", error)
        set({
          createPrInstructions: "",
          hasLoaded: true,
        })
      }
    })().finally(() => {
      initializePromise = null
    })

    return initializePromise
  },

  setCreatePrInstructions: (instructions) => {
    set({ createPrInstructions: instructions })
    schedulePersist(instructions)
  },

  resetCreatePrInstructions: () => {
    set({ createPrInstructions: "" })
    schedulePersist("")
  },
}))

export { normalizeCreatePrInstructions }
