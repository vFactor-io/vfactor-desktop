import { create } from "zustand"
import type { GitPullRequestResolveReason } from "@/desktop/contracts"
import { loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"
import {
  clampTextSizePx,
  DEFAULT_TEXT_SIZE_PX,
  DEFAULT_THEME_ID,
  isThemeId,
  setAppearanceState,
  type ThemeId,
} from "@/features/shared/appearance"
import {
  createDefaultGitResolvePrompts,
  normalizeGitResolvePrompts,
  type GitResolvePrompts,
} from "@/features/shared/components/layout/gitResolve"

const STORE_FILE = "settings.json"
const APPEARANCE_THEME_ID_KEY = "appearanceThemeId"
const APPEARANCE_TEXT_SIZE_KEY = "appearanceTextSizePx"
const TERMINAL_LINK_TARGET_KEY = "terminalLinkTarget"
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

export type TerminalLinkTarget = "in-app" | "system-browser"

interface PersistedSettings {
  appearanceThemeId: ThemeId
  appearanceTextSizePx: number
  terminalLinkTarget: TerminalLinkTarget
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
  setAppearanceThemeId: (themeId: ThemeId) => void
  resetAppearanceThemeId: () => void
  setAppearanceTextSizePx: (sizePx: number) => void
  resetAppearanceTextSizePx: () => void
  setTerminalLinkTarget: (target: TerminalLinkTarget) => void
  resetTerminalLinkTarget: () => void
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
  appearanceThemeId: DEFAULT_THEME_ID,
  appearanceTextSizePx: DEFAULT_TEXT_SIZE_PX,
  terminalLinkTarget: "in-app",
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

export function normalizeAppearanceThemeId(themeId: string | null | undefined): ThemeId {
  return isThemeId(themeId) ? themeId : DEFAULT_THEME_ID
}

export function normalizeAppearanceTextSizePx(value: number | null | undefined): number {
  return clampTextSizePx(value)
}

export function normalizeTerminalLinkTarget(
  value: string | null | undefined
): TerminalLinkTarget {
  return value === "system-browser" ? value : "in-app"
}

export function normalizeGitGenerationModel(model: string | null | undefined): string {
  return model?.trim() ?? ""
}

export function normalizeWorkspaceSetupModel(model: string | null | undefined): string {
  return model?.trim() ?? ""
}

export function normalizeCodexDefaultModel(model: string | null | undefined): string {
  return model?.trim() ?? ""
}

export function normalizeCodexDefaultReasoningEffort(effort: string | null | undefined): string {
  return effort?.trim() ?? ""
}

export function normalizeCodexDefaultFastMode(enabled: boolean | null | undefined): boolean {
  return enabled === true
}

export function normalizeClaudeDefaultModel(model: string | null | undefined): string {
  return model?.trim() ?? ""
}

export function normalizeClaudeDefaultReasoningEffort(effort: string | null | undefined): string {
  return effort?.trim() ?? ""
}

export function normalizeClaudeDefaultFastMode(enabled: boolean | null | undefined): boolean {
  return enabled === true
}

function buildPersistedSettings(source: Partial<PersistedSettings>): PersistedSettings {
  return {
    appearanceThemeId: normalizeAppearanceThemeId(source.appearanceThemeId),
    appearanceTextSizePx: normalizeAppearanceTextSizePx(source.appearanceTextSizePx),
    terminalLinkTarget: normalizeTerminalLinkTarget(source.terminalLinkTarget),
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
    appearanceThemeId: state.appearanceThemeId,
    appearanceTextSizePx: state.appearanceTextSizePx,
    terminalLinkTarget: state.terminalLinkTarget,
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
        await store.set(APPEARANCE_THEME_ID_KEY, settings.appearanceThemeId)
        await store.set(APPEARANCE_TEXT_SIZE_KEY, settings.appearanceTextSizePx)
        await store.set(TERMINAL_LINK_TARGET_KEY, settings.terminalLinkTarget)
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
          const savedAppearanceThemeId = await store.get<string>(APPEARANCE_THEME_ID_KEY)
          const savedAppearanceTextSizePx = await store.get<number>(APPEARANCE_TEXT_SIZE_KEY)
          const savedTerminalLinkTarget = await store.get<string>(TERMINAL_LINK_TARGET_KEY)
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

          const persistedSettings = buildPersistedSettings({
            appearanceThemeId: savedAppearanceThemeId,
            appearanceTextSizePx: savedAppearanceTextSizePx,
            terminalLinkTarget: savedTerminalLinkTarget,
            gitGenerationModel: savedModel,
            gitResolvePrompts: savedResolvePrompts,
            workspaceSetupModel: savedWorkspaceSetupModel,
            codexDefaultModel: savedCodexDefaultModel,
            codexDefaultReasoningEffort: savedCodexDefaultReasoningEffort,
            codexDefaultFastMode: savedCodexDefaultFastMode,
            claudeDefaultModel: savedClaudeDefaultModel,
            claudeDefaultReasoningEffort: savedClaudeDefaultReasoningEffort,
            claudeDefaultFastMode: savedClaudeDefaultFastMode,
          })

          setAppearanceState(
            {
              themeId: persistedSettings.appearanceThemeId,
              textSizePx: persistedSettings.appearanceTextSizePx,
            },
            { notify: false }
          )

          set({
            ...persistedSettings,
            hasLoaded: true,
          })
        } catch (error) {
          console.error("Failed to load settings:", error)
          setAppearanceState(
            {
              themeId: DEFAULT_THEME_ID,
              textSizePx: DEFAULT_TEXT_SIZE_PX,
            },
            { notify: false }
          )
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

    setAppearanceThemeId: (themeId) => {
      const normalizedThemeId = normalizeAppearanceThemeId(themeId)
      set({ appearanceThemeId: normalizedThemeId })
      setAppearanceState({ themeId: normalizedThemeId })
      persistWith({ appearanceThemeId: normalizedThemeId })
    },

    resetAppearanceThemeId: () => {
      set({ appearanceThemeId: DEFAULT_THEME_ID })
      setAppearanceState({ themeId: DEFAULT_THEME_ID })
      persistWith({ appearanceThemeId: DEFAULT_THEME_ID })
    },

    setAppearanceTextSizePx: (sizePx) => {
      const normalizedSizePx = normalizeAppearanceTextSizePx(sizePx)
      set({ appearanceTextSizePx: normalizedSizePx })
      setAppearanceState({ textSizePx: normalizedSizePx })
      persistWith({ appearanceTextSizePx: normalizedSizePx })
    },

    resetAppearanceTextSizePx: () => {
      set({ appearanceTextSizePx: DEFAULT_TEXT_SIZE_PX })
      setAppearanceState({ textSizePx: DEFAULT_TEXT_SIZE_PX })
      persistWith({ appearanceTextSizePx: DEFAULT_TEXT_SIZE_PX })
    },

    setTerminalLinkTarget: (target) => {
      const normalizedTarget = normalizeTerminalLinkTarget(target)
      set({ terminalLinkTarget: normalizedTarget })
      persistWith({ terminalLinkTarget: normalizedTarget })
    },

    resetTerminalLinkTarget: () => {
      set({ terminalLinkTarget: DEFAULT_PERSISTED_SETTINGS.terminalLinkTarget })
      persistWith({ terminalLinkTarget: DEFAULT_PERSISTED_SETTINGS.terminalLinkTarget })
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
