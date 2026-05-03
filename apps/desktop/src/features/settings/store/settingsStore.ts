import { create } from "zustand"
import type { GitPullRequestResolveReason } from "@/desktop/contracts"
import type { RuntimeProviderSettingsRecord } from "@/desktop/contracts"
import { loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"
import type { HarnessId } from "@/features/chat/types"
import {
  clampTextSizePx,
  DEFAULT_CORNER_STYLE,
  DEFAULT_TEXT_SIZE_PX,
  DEFAULT_THEME_ID,
  isCornerStyle,
  isThemeId,
  setAppearanceState,
  type CornerStyle,
  type ThemeId,
} from "@/features/shared/appearance"
import {
  createDefaultGitResolvePrompts,
  normalizeGitResolvePrompts,
  type GitResolvePrompts,
} from "@/features/shared/components/layout/gitResolve"
import {
  DEFAULT_AGENT_FINISH_SOUND_ID,
  normalizeAgentFinishSoundId,
  type AgentFinishSoundId,
} from "@/features/notifications/agentFinishSounds"

const STORE_FILE = "settings.json"
const APPEARANCE_THEME_ID_KEY = "appearanceThemeId"
const APPEARANCE_TEXT_SIZE_KEY = "appearanceTextSizePx"
const APPEARANCE_CORNER_STYLE_KEY = "appearanceCornerStyle"
const TERMINAL_LINK_TARGET_KEY = "terminalLinkTarget"
const GIT_GENERATION_MODEL_KEY = "gitGenerationModel"
const GIT_RESOLVE_PROMPTS_KEY = "gitResolvePrompts"
const WORKSPACE_SETUP_MODEL_KEY = "workspaceSetupModel"
const HARNESS_DEFAULTS_KEY = "harnessDefaults"
const PROVIDER_SETTINGS_KEY = "providerSettings"
const FAVORITE_MODELS_KEY = "favoriteModels"
const AGENT_FINISH_NOTIFICATIONS_ENABLED_KEY = "agentFinishNotificationsEnabled"
const AGENT_FINISH_SOUND_ENABLED_KEY = "agentFinishSoundEnabled"
const AGENT_FINISH_SOUND_ID_KEY = "agentFinishSoundId"
const CODEX_DEFAULT_MODEL_KEY = "codexDefaultModel"
const CODEX_DEFAULT_REASONING_EFFORT_KEY = "codexDefaultReasoningEffort"
const CODEX_DEFAULT_FAST_MODE_KEY = "codexDefaultFastMode"
const CLAUDE_DEFAULT_MODEL_KEY = "claudeDefaultModel"
const CLAUDE_DEFAULT_REASONING_EFFORT_KEY = "claudeDefaultReasoningEffort"
const CLAUDE_DEFAULT_FAST_MODE_KEY = "claudeDefaultFastMode"
const PERSIST_DEBOUNCE_MS = 250

export type TerminalLinkTarget = "in-app" | "system-browser"

export interface HarnessDefaults {
  model: string
  reasoningEffort: string
  modelVariant: string
  fastMode: boolean
}

export type HarnessDefaultsRecord = Record<HarnessId, HarnessDefaults>

interface PersistedSettings {
  appearanceThemeId: ThemeId
  appearanceTextSizePx: number
  appearanceCornerStyle: CornerStyle
  terminalLinkTarget: TerminalLinkTarget
  gitGenerationModel: string
  gitResolvePrompts: GitResolvePrompts
  workspaceSetupModel: string
  harnessDefaults: HarnessDefaultsRecord
  providerSettings: RuntimeProviderSettingsRecord
  favoriteModels: string[]
  agentFinishNotificationsEnabled: boolean
  agentFinishSoundEnabled: boolean
  agentFinishSoundId: AgentFinishSoundId
}

interface SettingsState extends PersistedSettings {
  hasLoaded: boolean
  initialize: () => Promise<void>
  setAppearanceThemeId: (themeId: ThemeId) => void
  resetAppearanceThemeId: () => void
  setAppearanceTextSizePx: (sizePx: number) => void
  resetAppearanceTextSizePx: () => void
  setAppearanceCornerStyle: (style: CornerStyle) => void
  resetAppearanceCornerStyle: () => void
  setTerminalLinkTarget: (target: TerminalLinkTarget) => void
  resetTerminalLinkTarget: () => void
  setGitGenerationModel: (model: string) => void
  setGitResolvePrompt: (reason: GitPullRequestResolveReason, prompt: string) => void
  resetGitResolvePrompts: () => void
  resetGitGenerationModel: () => void
  setWorkspaceSetupModel: (model: string) => void
  resetWorkspaceSetupModel: () => void
  setHarnessDefaultModel: (harnessId: HarnessId, model: string) => void
  resetHarnessDefaultModel: (harnessId: HarnessId) => void
  setHarnessDefaultReasoningEffort: (harnessId: HarnessId, effort: string) => void
  resetHarnessDefaultReasoningEffort: (harnessId: HarnessId) => void
  setHarnessDefaultModelVariant: (harnessId: HarnessId, variant: string) => void
  resetHarnessDefaultModelVariant: (harnessId: HarnessId) => void
  setHarnessDefaultFastMode: (harnessId: HarnessId, enabled: boolean) => void
  resetHarnessDefaultFastMode: (harnessId: HarnessId) => void
  setProviderEnabled: (harnessId: HarnessId, enabled: boolean) => void
  setProviderBinaryPath: (harnessId: HarnessId, binaryPath: string) => void
  setProviderHomePath: (homePath: string) => void
  setProviderLaunchArgs: (launchArgs: string) => void
  setOpenCodeServerUrl: (serverUrl: string) => void
  setOpenCodeServerPassword: (serverPassword: string) => void
  toggleFavoriteModel: (modelKey: string) => void
  setAgentFinishNotificationsEnabled: (enabled: boolean) => void
  setAgentFinishSoundEnabled: (enabled: boolean) => void
  setAgentFinishSoundId: (soundId: string) => void
  resetAgentFinishNotifications: () => void
}

let storeInstance: DesktopStoreHandle | null = null
let initializePromise: Promise<void> | null = null
let persistTimeoutId: ReturnType<typeof setTimeout> | null = null

export const EMPTY_HARNESS_DEFAULTS: HarnessDefaults = Object.freeze({
  model: "",
  reasoningEffort: "",
  modelVariant: "",
  fastMode: false,
})

export const DEFAULT_HARNESS_DEFAULTS: HarnessDefaultsRecord = {
  codex: { ...EMPTY_HARNESS_DEFAULTS },
  "claude-code": { ...EMPTY_HARNESS_DEFAULTS },
  opencode: { ...EMPTY_HARNESS_DEFAULTS },
}

export const DEFAULT_PROVIDER_SETTINGS: RuntimeProviderSettingsRecord = {
  codex: {
    enabled: true,
    binaryPath: "codex",
    homePath: "",
    customModels: [],
  },
  "claude-code": {
    enabled: true,
    binaryPath: "claude",
    launchArgs: "",
    customModels: [],
  },
  opencode: {
    enabled: true,
    binaryPath: "opencode",
    serverUrl: "",
    serverPassword: "",
    customModels: [],
  },
}

const DEFAULT_PERSISTED_SETTINGS: PersistedSettings = {
  appearanceThemeId: DEFAULT_THEME_ID,
  appearanceTextSizePx: DEFAULT_TEXT_SIZE_PX,
  appearanceCornerStyle: DEFAULT_CORNER_STYLE,
  terminalLinkTarget: "in-app",
  gitGenerationModel: "",
  gitResolvePrompts: createDefaultGitResolvePrompts(),
  workspaceSetupModel: "",
  harnessDefaults: DEFAULT_HARNESS_DEFAULTS,
  providerSettings: DEFAULT_PROVIDER_SETTINGS,
  favoriteModels: [],
  agentFinishNotificationsEnabled: true,
  agentFinishSoundEnabled: true,
  agentFinishSoundId: DEFAULT_AGENT_FINISH_SOUND_ID,
}

export function normalizeFavoriteModels(value: string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? [])
        .map((modelKey) => modelKey.trim())
        .filter((modelKey) => modelKey.length > 0)
    )
  )
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

export function normalizeAppearanceCornerStyle(value: string | null | undefined): CornerStyle {
  return isCornerStyle(value) ? value : DEFAULT_CORNER_STYLE
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

export function normalizeHarnessDefaultModel(model: string | null | undefined): string {
  return model?.trim() ?? ""
}

export function normalizeHarnessDefaultReasoningEffort(effort: string | null | undefined): string {
  return effort?.trim() ?? ""
}

export function normalizeHarnessDefaultModelVariant(variant: string | null | undefined): string {
  return variant?.trim() ?? ""
}

export function normalizeHarnessDefaultFastMode(enabled: boolean | null | undefined): boolean {
  return enabled === true
}

export function normalizeHarnessDefaults(
  value: Partial<Record<HarnessId, Partial<HarnessDefaults>>> | null | undefined
): HarnessDefaultsRecord {
  return {
    codex: {
      model: normalizeHarnessDefaultModel(value?.codex?.model),
      reasoningEffort: normalizeHarnessDefaultReasoningEffort(value?.codex?.reasoningEffort),
      modelVariant: normalizeHarnessDefaultModelVariant(value?.codex?.modelVariant),
      fastMode: normalizeHarnessDefaultFastMode(value?.codex?.fastMode),
    },
    "claude-code": {
      model: normalizeHarnessDefaultModel(value?.["claude-code"]?.model),
      reasoningEffort: normalizeHarnessDefaultReasoningEffort(
        value?.["claude-code"]?.reasoningEffort
      ),
      modelVariant: normalizeHarnessDefaultModelVariant(value?.["claude-code"]?.modelVariant),
      fastMode: normalizeHarnessDefaultFastMode(value?.["claude-code"]?.fastMode),
    },
    opencode: {
      model: normalizeHarnessDefaultModel(value?.opencode?.model),
      reasoningEffort: normalizeHarnessDefaultReasoningEffort(value?.opencode?.reasoningEffort),
      modelVariant: normalizeHarnessDefaultModelVariant(value?.opencode?.modelVariant),
      fastMode: normalizeHarnessDefaultFastMode(value?.opencode?.fastMode),
    },
  }
}

function normalizeProviderCustomModels(value: string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? [])
        .map((model) => model.trim())
        .filter((model) => model.length > 0)
    )
  )
}

export function normalizeProviderSettings(
  value: Partial<Record<HarnessId, Record<string, unknown>>> | null | undefined
): RuntimeProviderSettingsRecord {
  return {
    codex: {
      enabled: value?.codex?.enabled === false ? false : true,
      binaryPath:
        typeof value?.codex?.binaryPath === "string" && value.codex.binaryPath.trim()
          ? value.codex.binaryPath.trim()
          : "codex",
      homePath: typeof value?.codex?.homePath === "string" ? value.codex.homePath.trim() : "",
      customModels: normalizeProviderCustomModels(value?.codex?.customModels as string[] | undefined),
    },
    "claude-code": {
      enabled: value?.["claude-code"]?.enabled === false ? false : true,
      binaryPath:
        typeof value?.["claude-code"]?.binaryPath === "string" &&
        value["claude-code"].binaryPath.trim()
          ? value["claude-code"].binaryPath.trim()
          : "claude",
      launchArgs:
        typeof value?.["claude-code"]?.launchArgs === "string"
          ? value["claude-code"].launchArgs.trim()
          : "",
      customModels: normalizeProviderCustomModels(
        value?.["claude-code"]?.customModels as string[] | undefined
      ),
    },
    opencode: {
      enabled: value?.opencode?.enabled === false ? false : true,
      binaryPath:
        typeof value?.opencode?.binaryPath === "string" && value.opencode.binaryPath.trim()
          ? value.opencode.binaryPath.trim()
          : "opencode",
      serverUrl:
        typeof value?.opencode?.serverUrl === "string" ? value.opencode.serverUrl.trim() : "",
      serverPassword:
        typeof value?.opencode?.serverPassword === "string"
          ? value.opencode.serverPassword.trim()
          : "",
      customModels: normalizeProviderCustomModels(value?.opencode?.customModels as string[] | undefined),
    },
  }
}

function buildPersistedSettings(source: Partial<PersistedSettings>): PersistedSettings {
  return {
    appearanceThemeId: normalizeAppearanceThemeId(source.appearanceThemeId),
    appearanceTextSizePx: normalizeAppearanceTextSizePx(source.appearanceTextSizePx),
    appearanceCornerStyle: normalizeAppearanceCornerStyle(source.appearanceCornerStyle),
    terminalLinkTarget: normalizeTerminalLinkTarget(source.terminalLinkTarget),
    gitGenerationModel: normalizeGitGenerationModel(source.gitGenerationModel),
    gitResolvePrompts: normalizeGitResolvePrompts(source.gitResolvePrompts),
    workspaceSetupModel: normalizeWorkspaceSetupModel(source.workspaceSetupModel),
    harnessDefaults: normalizeHarnessDefaults(source.harnessDefaults),
    providerSettings: normalizeProviderSettings(source.providerSettings),
    favoriteModels: normalizeFavoriteModels(source.favoriteModels),
    agentFinishNotificationsEnabled: source.agentFinishNotificationsEnabled !== false,
    agentFinishSoundEnabled: source.agentFinishSoundEnabled !== false,
    agentFinishSoundId: normalizeAgentFinishSoundId(source.agentFinishSoundId),
  }
}

function selectPersistedSettings(
  state: Pick<SettingsState, keyof PersistedSettings>
): PersistedSettings {
  return buildPersistedSettings({
    appearanceThemeId: state.appearanceThemeId,
    appearanceTextSizePx: state.appearanceTextSizePx,
    appearanceCornerStyle: state.appearanceCornerStyle,
    terminalLinkTarget: state.terminalLinkTarget,
    gitGenerationModel: state.gitGenerationModel,
    gitResolvePrompts: state.gitResolvePrompts,
    workspaceSetupModel: state.workspaceSetupModel,
    harnessDefaults: state.harnessDefaults,
    providerSettings: state.providerSettings,
    favoriteModels: state.favoriteModels,
    agentFinishNotificationsEnabled: state.agentFinishNotificationsEnabled,
    agentFinishSoundEnabled: state.agentFinishSoundEnabled,
    agentFinishSoundId: state.agentFinishSoundId,
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
        await store.set(APPEARANCE_CORNER_STYLE_KEY, settings.appearanceCornerStyle)
        await store.set(TERMINAL_LINK_TARGET_KEY, settings.terminalLinkTarget)
        await store.set(GIT_GENERATION_MODEL_KEY, settings.gitGenerationModel)
        await store.set(GIT_RESOLVE_PROMPTS_KEY, settings.gitResolvePrompts)
        await store.set(WORKSPACE_SETUP_MODEL_KEY, settings.workspaceSetupModel)
        await store.set(HARNESS_DEFAULTS_KEY, settings.harnessDefaults)
        await store.set(PROVIDER_SETTINGS_KEY, settings.providerSettings)
        await store.set(FAVORITE_MODELS_KEY, settings.favoriteModels)
        await store.set(
          AGENT_FINISH_NOTIFICATIONS_ENABLED_KEY,
          settings.agentFinishNotificationsEnabled
        )
        await store.set(AGENT_FINISH_SOUND_ENABLED_KEY, settings.agentFinishSoundEnabled)
        await store.set(AGENT_FINISH_SOUND_ID_KEY, settings.agentFinishSoundId)
        await store.delete(CODEX_DEFAULT_MODEL_KEY)
        await store.delete(CODEX_DEFAULT_REASONING_EFFORT_KEY)
        await store.delete(CODEX_DEFAULT_FAST_MODE_KEY)
        await store.delete(CLAUDE_DEFAULT_MODEL_KEY)
        await store.delete(CLAUDE_DEFAULT_REASONING_EFFORT_KEY)
        await store.delete(CLAUDE_DEFAULT_FAST_MODE_KEY)

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
          const savedAppearanceCornerStyle = await store.get<string>(APPEARANCE_CORNER_STYLE_KEY)
          const savedTerminalLinkTarget = await store.get<string>(TERMINAL_LINK_TARGET_KEY)
          const savedModel = await store.get<string>(GIT_GENERATION_MODEL_KEY)
          const savedResolvePrompts =
            await store.get<Partial<Record<GitPullRequestResolveReason, string>>>(
              GIT_RESOLVE_PROMPTS_KEY
            )
          const savedWorkspaceSetupModel = await store.get<string>(WORKSPACE_SETUP_MODEL_KEY)
          const savedHarnessDefaults =
            await store.get<Partial<Record<HarnessId, Partial<HarnessDefaults>>>>(
              HARNESS_DEFAULTS_KEY
            )
          const savedProviderSettings =
            await store.get<Partial<Record<HarnessId, Record<string, unknown>>>>(
              PROVIDER_SETTINGS_KEY
            )
          const savedFavoriteModels = await store.get<string[]>(FAVORITE_MODELS_KEY)
          const savedAgentFinishNotificationsEnabled = await store.get<boolean>(
            AGENT_FINISH_NOTIFICATIONS_ENABLED_KEY
          )
          const savedAgentFinishSoundEnabled = await store.get<boolean>(
            AGENT_FINISH_SOUND_ENABLED_KEY
          )
          const savedAgentFinishSoundId = await store.get<string>(AGENT_FINISH_SOUND_ID_KEY)
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
            appearanceCornerStyle: savedAppearanceCornerStyle,
            terminalLinkTarget: savedTerminalLinkTarget,
            gitGenerationModel: savedModel,
            gitResolvePrompts: savedResolvePrompts,
            workspaceSetupModel: savedWorkspaceSetupModel,
            favoriteModels: normalizeFavoriteModels(savedFavoriteModels),
            agentFinishNotificationsEnabled: savedAgentFinishNotificationsEnabled ?? true,
            agentFinishSoundEnabled: savedAgentFinishSoundEnabled ?? true,
            agentFinishSoundId: normalizeAgentFinishSoundId(savedAgentFinishSoundId),
            providerSettings: normalizeProviderSettings(savedProviderSettings),
            harnessDefaults: normalizeHarnessDefaults({
              ...savedHarnessDefaults,
              codex: {
                ...(savedHarnessDefaults?.codex ?? {}),
                model: savedHarnessDefaults?.codex?.model ?? savedCodexDefaultModel,
                reasoningEffort:
                  savedHarnessDefaults?.codex?.reasoningEffort ??
                  savedCodexDefaultReasoningEffort,
                fastMode: savedHarnessDefaults?.codex?.fastMode ?? savedCodexDefaultFastMode,
              },
              "claude-code": {
                ...(savedHarnessDefaults?.["claude-code"] ?? {}),
                model:
                  savedHarnessDefaults?.["claude-code"]?.model ?? savedClaudeDefaultModel,
                reasoningEffort:
                  savedHarnessDefaults?.["claude-code"]?.reasoningEffort ??
                  savedClaudeDefaultReasoningEffort,
                fastMode:
                  savedHarnessDefaults?.["claude-code"]?.fastMode ?? savedClaudeDefaultFastMode,
              },
            }),
          })

          setAppearanceState(
            {
              themeId: persistedSettings.appearanceThemeId,
              textSizePx: persistedSettings.appearanceTextSizePx,
              cornerStyle: persistedSettings.appearanceCornerStyle,
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
              cornerStyle: DEFAULT_CORNER_STYLE,
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

    setAppearanceCornerStyle: (style) => {
      const normalizedStyle = normalizeAppearanceCornerStyle(style)
      set({ appearanceCornerStyle: normalizedStyle })
      setAppearanceState({ cornerStyle: normalizedStyle })
      persistWith({ appearanceCornerStyle: normalizedStyle })
    },

    resetAppearanceCornerStyle: () => {
      set({ appearanceCornerStyle: DEFAULT_CORNER_STYLE })
      setAppearanceState({ cornerStyle: DEFAULT_CORNER_STYLE })
      persistWith({ appearanceCornerStyle: DEFAULT_CORNER_STYLE })
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

    setHarnessDefaultModel: (harnessId, model) => {
      const normalized = normalizeHarnessDefaultModel(model)
      const nextHarnessDefaults = {
        ...get().harnessDefaults,
        [harnessId]: {
          ...get().harnessDefaults[harnessId],
          model: normalized,
        },
      }
      set({ harnessDefaults: nextHarnessDefaults })
      persistWith({ harnessDefaults: nextHarnessDefaults })
    },

    resetHarnessDefaultModel: (harnessId) => {
      const nextHarnessDefaults = {
        ...get().harnessDefaults,
        [harnessId]: {
          ...get().harnessDefaults[harnessId],
          model: "",
        },
      }
      set({ harnessDefaults: nextHarnessDefaults })
      persistWith({ harnessDefaults: nextHarnessDefaults })
    },

    setHarnessDefaultReasoningEffort: (harnessId, effort) => {
      const normalized = normalizeHarnessDefaultReasoningEffort(effort)
      const nextHarnessDefaults = {
        ...get().harnessDefaults,
        [harnessId]: {
          ...get().harnessDefaults[harnessId],
          reasoningEffort: normalized,
        },
      }
      set({ harnessDefaults: nextHarnessDefaults })
      persistWith({ harnessDefaults: nextHarnessDefaults })
    },

    resetHarnessDefaultReasoningEffort: (harnessId) => {
      const nextHarnessDefaults = {
        ...get().harnessDefaults,
        [harnessId]: {
          ...get().harnessDefaults[harnessId],
          reasoningEffort: "",
        },
      }
      set({ harnessDefaults: nextHarnessDefaults })
      persistWith({ harnessDefaults: nextHarnessDefaults })
    },

    setHarnessDefaultModelVariant: (harnessId, variant) => {
      const normalized = normalizeHarnessDefaultModelVariant(variant)
      const nextHarnessDefaults = {
        ...get().harnessDefaults,
        [harnessId]: {
          ...get().harnessDefaults[harnessId],
          modelVariant: normalized,
        },
      }
      set({ harnessDefaults: nextHarnessDefaults })
      persistWith({ harnessDefaults: nextHarnessDefaults })
    },

    resetHarnessDefaultModelVariant: (harnessId) => {
      const nextHarnessDefaults = {
        ...get().harnessDefaults,
        [harnessId]: {
          ...get().harnessDefaults[harnessId],
          modelVariant: "",
        },
      }
      set({ harnessDefaults: nextHarnessDefaults })
      persistWith({ harnessDefaults: nextHarnessDefaults })
    },

    setHarnessDefaultFastMode: (harnessId, enabled) => {
      const normalized = normalizeHarnessDefaultFastMode(enabled)
      const nextHarnessDefaults = {
        ...get().harnessDefaults,
        [harnessId]: {
          ...get().harnessDefaults[harnessId],
          fastMode: normalized,
        },
      }
      set({ harnessDefaults: nextHarnessDefaults })
      persistWith({ harnessDefaults: nextHarnessDefaults })
    },

    resetHarnessDefaultFastMode: (harnessId) => {
      const nextHarnessDefaults = {
        ...get().harnessDefaults,
        [harnessId]: {
          ...get().harnessDefaults[harnessId],
          fastMode: false,
        },
      }
      set({ harnessDefaults: nextHarnessDefaults })
      persistWith({ harnessDefaults: nextHarnessDefaults })
    },

    setProviderEnabled: (harnessId, enabled) => {
      const next = {
        ...get().providerSettings,
        [harnessId]: {
          ...get().providerSettings[harnessId],
          enabled,
        },
      }
      set({ providerSettings: next })
      persistWith({ providerSettings: next })
    },

    setProviderBinaryPath: (harnessId, binaryPath) => {
      const fallback = DEFAULT_PROVIDER_SETTINGS[harnessId].binaryPath
      const next = {
        ...get().providerSettings,
        [harnessId]: {
          ...get().providerSettings[harnessId],
          binaryPath: binaryPath.trim() || fallback,
        },
      }
      set({ providerSettings: next })
      persistWith({ providerSettings: next })
    },

    setProviderHomePath: (homePath) => {
      const next = {
        ...get().providerSettings,
        codex: {
          ...get().providerSettings.codex,
          homePath: homePath.trim(),
        },
      }
      set({ providerSettings: next })
      persistWith({ providerSettings: next })
    },

    setProviderLaunchArgs: (launchArgs) => {
      const next = {
        ...get().providerSettings,
        "claude-code": {
          ...get().providerSettings["claude-code"],
          launchArgs: launchArgs.trim(),
        },
      }
      set({ providerSettings: next })
      persistWith({ providerSettings: next })
    },

    setOpenCodeServerUrl: (serverUrl) => {
      const next = {
        ...get().providerSettings,
        opencode: {
          ...get().providerSettings.opencode,
          serverUrl: serverUrl.trim(),
        },
      }
      set({ providerSettings: next })
      persistWith({ providerSettings: next })
    },

    setOpenCodeServerPassword: (serverPassword) => {
      const next = {
        ...get().providerSettings,
        opencode: {
          ...get().providerSettings.opencode,
          serverPassword: serverPassword.trim(),
        },
      }
      set({ providerSettings: next })
      persistWith({ providerSettings: next })
    },

    toggleFavoriteModel: (modelKey) => {
      const normalizedModelKey = modelKey.trim()
      if (!normalizedModelKey) {
        return
      }

      const nextFavoriteModels = get().favoriteModels.includes(normalizedModelKey)
        ? get().favoriteModels.filter((favoriteModelKey) => favoriteModelKey !== normalizedModelKey)
        : [...get().favoriteModels, normalizedModelKey]

      set({ favoriteModels: nextFavoriteModels })
      persistWith({ favoriteModels: nextFavoriteModels })
    },

    setAgentFinishNotificationsEnabled: (enabled) => {
      set({ agentFinishNotificationsEnabled: enabled })
      persistWith({ agentFinishNotificationsEnabled: enabled })
    },

    setAgentFinishSoundEnabled: (enabled) => {
      set({ agentFinishSoundEnabled: enabled })
      persistWith({ agentFinishSoundEnabled: enabled })
    },

    setAgentFinishSoundId: (soundId) => {
      const normalizedSoundId = normalizeAgentFinishSoundId(soundId)
      set({ agentFinishSoundId: normalizedSoundId })
      persistWith({ agentFinishSoundId: normalizedSoundId })
    },

    resetAgentFinishNotifications: () => {
      set({
        agentFinishNotificationsEnabled:
          DEFAULT_PERSISTED_SETTINGS.agentFinishNotificationsEnabled,
        agentFinishSoundEnabled: DEFAULT_PERSISTED_SETTINGS.agentFinishSoundEnabled,
        agentFinishSoundId: DEFAULT_PERSISTED_SETTINGS.agentFinishSoundId,
      })
      persistWith({
        agentFinishNotificationsEnabled:
          DEFAULT_PERSISTED_SETTINGS.agentFinishNotificationsEnabled,
        agentFinishSoundEnabled: DEFAULT_PERSISTED_SETTINGS.agentFinishSoundEnabled,
        agentFinishSoundId: DEFAULT_PERSISTED_SETTINGS.agentFinishSoundId,
      })
    },
  }
})
