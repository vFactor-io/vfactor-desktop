import { create } from "zustand"
import { loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"
import {
  createDefaultGitResolvePrompts,
  normalizeGitResolvePrompts,
  type GitResolvePrompts,
} from "@/features/shared/components/layout/gitResolve"
import type { GitPullRequestResolveReason } from "@/desktop/contracts"

const STORE_FILE = "settings.json"
const GIT_GENERATION_MODEL_KEY = "gitGenerationModel"
const GIT_RESOLVE_PROMPTS_KEY = "gitResolvePrompts"
const WORKSPACE_SETUP_MODEL_KEY = "workspaceSetupModel"
const CODEX_DEFAULT_MODEL_KEY = "codexDefaultModel"
const CODEX_DEFAULT_REASONING_EFFORT_KEY = "codexDefaultReasoningEffort"
const CODEX_DEFAULT_FAST_MODE_KEY = "codexDefaultFastMode"
const CLAUDE_DEFAULT_MODEL_KEY = "claudeDefaultModel"
const CLAUDE_DEFAULT_REASONING_EFFORT_KEY = "claudeDefaultReasoningEffort"
const CLAUDE_DEFAULT_FAST_MODE_KEY = "claudeDefaultFastMode"
const PERSIST_DEBOUNCE_MS = 250

interface PersistedSettings {
  gitGenerationModel: string
  gitResolvePrompts: GitResolvePrompts
  workspaceSetupModel: string
  codexDefaultModel: string
  codexDefaultReasoningEffort: string
  codexDefaultFastMode: boolean
  claudeDefaultModel: string
  claudeDefaultReasoningEffort: string
  claudeDefaultFastMode: boolean
}

interface SettingsState extends PersistedSettings {
  hasLoaded: boolean
  initialize: () => Promise<void>
  setGitGenerationModel: (model: string) => void
  setGitResolvePrompt: (reason: GitPullRequestResolveReason, prompt: string) => void
  resetGitResolvePrompts: () => void
  resetGitGenerationModel: () => void
  setWorkspaceSetupModel: (model: string) => void
  resetWorkspaceSetupModel: () => void
  setCodexDefaultModel: (model: string) => void
  resetCodexDefaultModel: () => void
  setCodexDefaultReasoningEffort: (effort: string) => void
  resetCodexDefaultReasoningEffort: () => void
  setCodexDefaultFastMode: (enabled: boolean) => void
  resetCodexDefaultFastMode: () => void
  setClaudeDefaultModel: (model: string) => void
  resetClaudeDefaultModel: () => void
  setClaudeDefaultReasoningEffort: (effort: string) => void
  resetClaudeDefaultReasoningEffort: () => void
  setClaudeDefaultFastMode: (enabled: boolean) => void
  resetClaudeDefaultFastMode: () => void
}

let storeInstance: DesktopStoreHandle | null = null
let initializePromise: Promise<void> | null = null
let persistTimeoutId: ReturnType<typeof setTimeout> | null = null

const DEFAULT_PERSISTED_SETTINGS: PersistedSettings = {
  gitGenerationModel: "",
  gitResolvePrompts: createDefaultGitResolvePrompts(),
  workspaceSetupModel: "",
  codexDefaultModel: "",
  codexDefaultReasoningEffort: "",
  codexDefaultFastMode: false,
  claudeDefaultModel: "",
  claudeDefaultReasoningEffort: "",
  claudeDefaultFastMode: false,
}

async function getStore(): Promise<DesktopStoreHandle> {
  if (!storeInstance) {
    storeInstance = await loadDesktopStore(STORE_FILE)
  }

  return storeInstance
}

function normalizeGitGenerationModel(model: string | null | undefined): string {
  return model?.trim() ?? ""
}

function normalizeWorkspaceSetupModel(model: string | null | undefined): string {
  return model?.trim() ?? ""
}

function normalizeCodexDefaultModel(model: string | null | undefined): string {
  return model?.trim() ?? ""
}

function normalizeCodexDefaultReasoningEffort(effort: string | null | undefined): string {
  return effort?.trim() ?? ""
}

function normalizeCodexDefaultFastMode(enabled: boolean | null | undefined): boolean {
  return enabled === true
}

function normalizeClaudeDefaultModel(model: string | null | undefined): string {
  return model?.trim() ?? ""
}

function normalizeClaudeDefaultReasoningEffort(effort: string | null | undefined): string {
  return effort?.trim() ?? ""
}

function normalizeClaudeDefaultFastMode(enabled: boolean | null | undefined): boolean {
  return enabled === true
}

function buildPersistedSettings(source: Partial<PersistedSettings>): PersistedSettings {
  return {
    gitGenerationModel: normalizeGitGenerationModel(source.gitGenerationModel),
    gitResolvePrompts: normalizeGitResolvePrompts(source.gitResolvePrompts),
    workspaceSetupModel: normalizeWorkspaceSetupModel(source.workspaceSetupModel),
    codexDefaultModel: normalizeCodexDefaultModel(source.codexDefaultModel),
    codexDefaultReasoningEffort: normalizeCodexDefaultReasoningEffort(
      source.codexDefaultReasoningEffort
    ),
    codexDefaultFastMode: normalizeCodexDefaultFastMode(source.codexDefaultFastMode),
    claudeDefaultModel: normalizeClaudeDefaultModel(source.claudeDefaultModel),
    claudeDefaultReasoningEffort: normalizeClaudeDefaultReasoningEffort(
      source.claudeDefaultReasoningEffort
    ),
    claudeDefaultFastMode: normalizeClaudeDefaultFastMode(source.claudeDefaultFastMode),
  }
}

function selectPersistedSettings(
  state: Pick<SettingsState, keyof PersistedSettings>
): PersistedSettings {
  return buildPersistedSettings({
    gitGenerationModel: state.gitGenerationModel,
    gitResolvePrompts: state.gitResolvePrompts,
    workspaceSetupModel: state.workspaceSetupModel,
    codexDefaultModel: state.codexDefaultModel,
    codexDefaultReasoningEffort: state.codexDefaultReasoningEffort,
    codexDefaultFastMode: state.codexDefaultFastMode,
    claudeDefaultModel: state.claudeDefaultModel,
    claudeDefaultReasoningEffort: state.claudeDefaultReasoningEffort,
    claudeDefaultFastMode: state.claudeDefaultFastMode,
  })
}

function schedulePersist(settings: PersistedSettings): void {
  if (persistTimeoutId != null) {
    clearTimeout(persistTimeoutId)
  }

  persistTimeoutId = setTimeout(() => {
    persistTimeoutId = null

    void (async () => {
      try {
        const store = await getStore()
        await store.set(GIT_GENERATION_MODEL_KEY, settings.gitGenerationModel)
        await store.set(GIT_RESOLVE_PROMPTS_KEY, settings.gitResolvePrompts)
        await store.set(WORKSPACE_SETUP_MODEL_KEY, settings.workspaceSetupModel)

        if (settings.codexDefaultModel.length > 0) {
          await store.set(CODEX_DEFAULT_MODEL_KEY, settings.codexDefaultModel)
        } else {
          await store.delete(CODEX_DEFAULT_MODEL_KEY)
        }

        if (settings.codexDefaultReasoningEffort.length > 0) {
          await store.set(CODEX_DEFAULT_REASONING_EFFORT_KEY, settings.codexDefaultReasoningEffort)
        } else {
          await store.delete(CODEX_DEFAULT_REASONING_EFFORT_KEY)
        }

        if (settings.codexDefaultFastMode) {
          await store.set(CODEX_DEFAULT_FAST_MODE_KEY, true)
        } else {
          await store.delete(CODEX_DEFAULT_FAST_MODE_KEY)
        }

        if (settings.claudeDefaultModel.length > 0) {
          await store.set(CLAUDE_DEFAULT_MODEL_KEY, settings.claudeDefaultModel)
        } else {
          await store.delete(CLAUDE_DEFAULT_MODEL_KEY)
        }

        if (settings.claudeDefaultReasoningEffort.length > 0) {
          await store.set(
            CLAUDE_DEFAULT_REASONING_EFFORT_KEY,
            settings.claudeDefaultReasoningEffort
          )
        } else {
          await store.delete(CLAUDE_DEFAULT_REASONING_EFFORT_KEY)
        }

        if (settings.claudeDefaultFastMode) {
          await store.set(CLAUDE_DEFAULT_FAST_MODE_KEY, true)
        } else {
          await store.delete(CLAUDE_DEFAULT_FAST_MODE_KEY)
        }

        await store.save()
      } catch (error) {
        console.error("Failed to persist settings:", error)
      }
    })()
  }, PERSIST_DEBOUNCE_MS)
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const persistWith = (overrides: Partial<PersistedSettings>) => {
    schedulePersist(
      buildPersistedSettings({
        ...selectPersistedSettings(get()),
        ...overrides,
      })
    )
  }

  return {
    ...DEFAULT_PERSISTED_SETTINGS,
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
          const savedResolvePrompts =
            await store.get<Partial<Record<GitPullRequestResolveReason, string>>>(
              GIT_RESOLVE_PROMPTS_KEY
            )
          const savedWorkspaceSetupModel = await store.get<string>(WORKSPACE_SETUP_MODEL_KEY)
          const savedCodexDefaultModel = await store.get<string>(CODEX_DEFAULT_MODEL_KEY)
          const savedCodexDefaultReasoningEffort = await store.get<string>(
            CODEX_DEFAULT_REASONING_EFFORT_KEY
          )
          const savedCodexDefaultFastMode = await store.get<boolean>(CODEX_DEFAULT_FAST_MODE_KEY)
          const savedClaudeDefaultModel = await store.get<string>(CLAUDE_DEFAULT_MODEL_KEY)
          const savedClaudeDefaultReasoningEffort = await store.get<string>(
            CLAUDE_DEFAULT_REASONING_EFFORT_KEY
          )
          const savedClaudeDefaultFastMode = await store.get<boolean>(CLAUDE_DEFAULT_FAST_MODE_KEY)

          set({
            ...buildPersistedSettings({
              gitGenerationModel: savedModel,
              gitResolvePrompts: savedResolvePrompts,
              workspaceSetupModel: savedWorkspaceSetupModel,
              codexDefaultModel: savedCodexDefaultModel,
              codexDefaultReasoningEffort: savedCodexDefaultReasoningEffort,
              codexDefaultFastMode: savedCodexDefaultFastMode,
              claudeDefaultModel: savedClaudeDefaultModel,
              claudeDefaultReasoningEffort: savedClaudeDefaultReasoningEffort,
              claudeDefaultFastMode: savedClaudeDefaultFastMode,
            }),
            hasLoaded: true,
          })
        } catch (error) {
          console.error("Failed to load settings:", error)
          set({
            ...DEFAULT_PERSISTED_SETTINGS,
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
      persistWith({ gitGenerationModel: normalized })
    },

    resetGitGenerationModel: () => {
      set({ gitGenerationModel: "" })
      persistWith({ gitGenerationModel: "" })
    },

    setGitResolvePrompt: (reason, prompt) => {
      const nextPrompts = {
        ...get().gitResolvePrompts,
        [reason]: prompt.replace(/\r\n/g, "\n"),
      }

      set({ gitResolvePrompts: nextPrompts })
      persistWith({ gitResolvePrompts: nextPrompts })
    },

    resetGitResolvePrompts: () => {
      const nextPrompts = createDefaultGitResolvePrompts()
      set({ gitResolvePrompts: nextPrompts })
      persistWith({ gitResolvePrompts: nextPrompts })
    },

    setWorkspaceSetupModel: (model) => {
      const normalized = normalizeWorkspaceSetupModel(model)
      set({ workspaceSetupModel: normalized })
      persistWith({ workspaceSetupModel: normalized })
    },

    resetWorkspaceSetupModel: () => {
      set({ workspaceSetupModel: "" })
      persistWith({ workspaceSetupModel: "" })
    },

    setCodexDefaultModel: (model) => {
      const normalized = normalizeCodexDefaultModel(model)
      set({ codexDefaultModel: normalized })
      persistWith({ codexDefaultModel: normalized })
    },

    resetCodexDefaultModel: () => {
      set({ codexDefaultModel: "" })
      persistWith({ codexDefaultModel: "" })
    },

    setCodexDefaultReasoningEffort: (effort) => {
      const normalized = normalizeCodexDefaultReasoningEffort(effort)
      set({ codexDefaultReasoningEffort: normalized })
      persistWith({ codexDefaultReasoningEffort: normalized })
    },

    resetCodexDefaultReasoningEffort: () => {
      set({ codexDefaultReasoningEffort: "" })
      persistWith({ codexDefaultReasoningEffort: "" })
    },

    setCodexDefaultFastMode: (enabled) => {
      const normalized = normalizeCodexDefaultFastMode(enabled)
      set({ codexDefaultFastMode: normalized })
      persistWith({ codexDefaultFastMode: normalized })
    },

    resetCodexDefaultFastMode: () => {
      set({ codexDefaultFastMode: false })
      persistWith({ codexDefaultFastMode: false })
    },

    setClaudeDefaultModel: (model) => {
      const normalized = normalizeClaudeDefaultModel(model)
      set({ claudeDefaultModel: normalized })
      persistWith({ claudeDefaultModel: normalized })
    },

    resetClaudeDefaultModel: () => {
      set({ claudeDefaultModel: "" })
      persistWith({ claudeDefaultModel: "" })
    },

    setClaudeDefaultReasoningEffort: (effort) => {
      const normalized = normalizeClaudeDefaultReasoningEffort(effort)
      set({ claudeDefaultReasoningEffort: normalized })
      persistWith({ claudeDefaultReasoningEffort: normalized })
    },

    resetClaudeDefaultReasoningEffort: () => {
      set({ claudeDefaultReasoningEffort: "" })
      persistWith({ claudeDefaultReasoningEffort: "" })
    },

    setClaudeDefaultFastMode: (enabled) => {
      const normalized = normalizeClaudeDefaultFastMode(enabled)
      set({ claudeDefaultFastMode: normalized })
      persistWith({ claudeDefaultFastMode: normalized })
    },

    resetClaudeDefaultFastMode: () => {
      set({ claudeDefaultFastMode: false })
      persistWith({ claudeDefaultFastMode: false })
    },
  }
})

export {
  normalizeClaudeDefaultFastMode,
  normalizeClaudeDefaultModel,
  normalizeClaudeDefaultReasoningEffort,
  normalizeCodexDefaultFastMode,
  normalizeCodexDefaultModel,
  normalizeCodexDefaultReasoningEffort,
  normalizeGitGenerationModel,
  normalizeWorkspaceSetupModel,
}
