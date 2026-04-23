import { beforeEach, describe, expect, mock, test } from "bun:test"

const storeData = new Map<string, unknown>()

const desktopStore = {
  get: async <T>(key: string): Promise<T | null> =>
    storeData.has(key) ? (storeData.get(key) as T) : null,
  set: async (key: string, value: unknown) => {
    storeData.set(key, value)
  },
  delete: async (key: string) => {
    storeData.delete(key)
  },
  save: async () => {},
}

mock.module("@/desktop/client", () => ({
  desktop: {
    app: {
      syncWindowTheme: async () => {},
    },
    fs: {
      exists: async () => true,
      homeDir: async () => "/Users/tester",
    },
    git: {
      getBranches: async () => null,
      listWorktrees: async () => [],
      createWorktree: async () => ({ worktree: { branchName: "", path: "" } }),
      renameWorktree: async () => ({ worktree: { branchName: "", path: "" } }),
      removeWorktree: async () => ({ worktreePath: "" }),
      getChanges: async () => [],
    },
  },
  loadDesktopStore: async () => desktopStore,
}))

const { useSettingsStore } = await import("./settingsStore")

function resetSettingsStore() {
  useSettingsStore.setState({
    appearanceThemeId: "system",
    appearanceTextSizePx: 13,
    terminalLinkTarget: "in-app",
    gitGenerationModel: "",
    gitResolvePrompts: {
      conflicts: "conflicts",
      behind: "behind",
      failed_checks: "failed_checks",
      blocked: "blocked",
      draft: "draft",
      unknown: "unknown",
    },
    workspaceSetupModel: "",
    codexDefaultModel: "",
    codexDefaultReasoningEffort: "",
    codexDefaultFastMode: false,
    claudeDefaultModel: "",
    claudeDefaultReasoningEffort: "",
    claudeDefaultFastMode: false,
    hasLoaded: false,
  })
}

describe("settingsStore resolve prompts", () => {
  beforeEach(() => {
    storeData.clear()
    resetSettingsStore()
  })

  test("initializes missing resolve prompts with defaults while keeping saved values", async () => {
    storeData.set("gitResolvePrompts", {
      conflicts: "Resolve {{currentBranch}}",
    })

    await useSettingsStore.getState().initialize()

    expect(useSettingsStore.getState().gitResolvePrompts.conflicts).toBe("Resolve {{currentBranch}}")
    expect(useSettingsStore.getState().gitResolvePrompts.behind.length).toBeGreaterThan(0)
    expect(useSettingsStore.getState().gitResolvePrompts.failed_checks.length).toBeGreaterThan(0)
  })

  test("persists edited resolve prompts", async () => {
    await useSettingsStore.getState().initialize()
    useSettingsStore.getState().setGitResolvePrompt("blocked", "Inspect {{prUrl}}")

    await Bun.sleep(350)

    expect(storeData.get("gitResolvePrompts")).toMatchObject({
      blocked: "Inspect {{prUrl}}",
    })
  })

  test("initializes Codex defaults from persisted values", async () => {
    storeData.set("codexDefaultModel", " gpt-5.4 ")
    storeData.set("codexDefaultReasoningEffort", " high ")
    storeData.set("codexDefaultFastMode", true)

    await useSettingsStore.getState().initialize()

    expect(useSettingsStore.getState().codexDefaultModel).toBe("gpt-5.4")
    expect(useSettingsStore.getState().codexDefaultReasoningEffort).toBe("high")
    expect(useSettingsStore.getState().codexDefaultFastMode).toBe(true)
  })

  test("initializes appearance settings from persisted values", async () => {
    storeData.set("appearanceThemeId", "dracula")
    storeData.set("appearanceTextSizePx", 16)
    storeData.set("terminalLinkTarget", "system-browser")

    await useSettingsStore.getState().initialize()

    expect(useSettingsStore.getState().appearanceThemeId).toBe("dracula")
    expect(useSettingsStore.getState().appearanceTextSizePx).toBe(16)
    expect(useSettingsStore.getState().terminalLinkTarget).toBe("system-browser")
  })

  test("persists appearance settings after edits", async () => {
    await useSettingsStore.getState().initialize()

    useSettingsStore.getState().setAppearanceThemeId("nord")
    useSettingsStore.getState().setAppearanceTextSizePx(12)
    useSettingsStore.getState().setTerminalLinkTarget("system-browser")

    await Bun.sleep(350)

    expect(storeData.get("appearanceThemeId")).toBe("nord")
    expect(storeData.get("appearanceTextSizePx")).toBe(12)
    expect(storeData.get("terminalLinkTarget")).toBe("system-browser")
  })

  test("reset methods restore default appearance settings", async () => {
    await useSettingsStore.getState().initialize()

    useSettingsStore.getState().setAppearanceThemeId("nord")
    useSettingsStore.getState().setAppearanceTextSizePx(12)
    await Bun.sleep(350)

    useSettingsStore.getState().resetAppearanceThemeId()
    useSettingsStore.getState().resetAppearanceTextSizePx()
    useSettingsStore.getState().resetTerminalLinkTarget()
    await Bun.sleep(350)

    expect(storeData.get("appearanceThemeId")).toBe("system")
    expect(storeData.get("appearanceTextSizePx")).toBe(13)
    expect(storeData.get("terminalLinkTarget")).toBe("in-app")
    expect(useSettingsStore.getState().appearanceThemeId).toBe("system")
    expect(useSettingsStore.getState().appearanceTextSizePx).toBe(13)
    expect(useSettingsStore.getState().terminalLinkTarget).toBe("in-app")
  })

  test("persists Codex defaults after edits", async () => {
    await useSettingsStore.getState().initialize()

    useSettingsStore.getState().setCodexDefaultModel(" gpt-5.4 ")
    useSettingsStore.getState().setCodexDefaultReasoningEffort(" medium ")
    useSettingsStore.getState().setCodexDefaultFastMode(true)

    await Bun.sleep(350)

    expect(storeData.get("codexDefaultModel")).toBe("gpt-5.4")
    expect(storeData.get("codexDefaultReasoningEffort")).toBe("medium")
    expect(storeData.get("codexDefaultFastMode")).toBe(true)
  })

  test("reset methods clear persisted Codex defaults", async () => {
    await useSettingsStore.getState().initialize()

    useSettingsStore.getState().setCodexDefaultModel("gpt-5.4")
    useSettingsStore.getState().setCodexDefaultReasoningEffort("high")
    useSettingsStore.getState().setCodexDefaultFastMode(true)
    await Bun.sleep(350)

    useSettingsStore.getState().resetCodexDefaultModel()
    useSettingsStore.getState().resetCodexDefaultReasoningEffort()
    useSettingsStore.getState().resetCodexDefaultFastMode()
    await Bun.sleep(350)

    expect(storeData.has("codexDefaultModel")).toBe(false)
    expect(storeData.has("codexDefaultReasoningEffort")).toBe(false)
    expect(storeData.has("codexDefaultFastMode")).toBe(false)
    expect(useSettingsStore.getState().codexDefaultModel).toBe("")
    expect(useSettingsStore.getState().codexDefaultReasoningEffort).toBe("")
    expect(useSettingsStore.getState().codexDefaultFastMode).toBe(false)
  })
})
