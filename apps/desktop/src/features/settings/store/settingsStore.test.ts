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
    appearanceCornerStyle: "soft",
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
    harnessDefaults: {
      codex: {
        model: "",
        reasoningEffort: "",
        modelVariant: "",
        fastMode: false,
      },
      "claude-code": {
        model: "",
        reasoningEffort: "",
        modelVariant: "",
        fastMode: false,
      },
      opencode: {
        model: "",
        reasoningEffort: "",
        modelVariant: "",
        fastMode: false,
      },
    },
    favoriteModels: [],
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

  test("initializes harness defaults from persisted values", async () => {
    storeData.set("codexDefaultModel", " gpt-5.4 ")
    storeData.set("codexDefaultReasoningEffort", " high ")
    storeData.set("codexDefaultFastMode", true)
    storeData.set("harnessDefaults", {
      opencode: {
        model: " openai/gpt-5.4 ",
      },
    })

    await useSettingsStore.getState().initialize()

    expect(useSettingsStore.getState().harnessDefaults.codex.model).toBe("gpt-5.4")
    expect(useSettingsStore.getState().harnessDefaults.codex.reasoningEffort).toBe("high")
    expect(useSettingsStore.getState().harnessDefaults.codex.fastMode).toBe(true)
    expect(useSettingsStore.getState().harnessDefaults.opencode.model).toBe("openai/gpt-5.4")
  })

  test("initializes appearance settings from persisted values", async () => {
    storeData.set("appearanceThemeId", "dracula")
    storeData.set("appearanceTextSizePx", 16)
    storeData.set("appearanceCornerStyle", "rounded")
    storeData.set("terminalLinkTarget", "system-browser")

    await useSettingsStore.getState().initialize()

    expect(useSettingsStore.getState().appearanceThemeId).toBe("dracula")
    expect(useSettingsStore.getState().appearanceTextSizePx).toBe(16)
    expect(useSettingsStore.getState().appearanceCornerStyle).toBe("rounded")
    expect(useSettingsStore.getState().terminalLinkTarget).toBe("system-browser")
  })

  test("persists appearance settings after edits", async () => {
    await useSettingsStore.getState().initialize()

    useSettingsStore.getState().setAppearanceThemeId("nord")
    useSettingsStore.getState().setAppearanceTextSizePx(12)
    useSettingsStore.getState().setAppearanceCornerStyle("square")
    useSettingsStore.getState().setTerminalLinkTarget("system-browser")

    await Bun.sleep(350)

    expect(storeData.get("appearanceThemeId")).toBe("nord")
    expect(storeData.get("appearanceTextSizePx")).toBe(12)
    expect(storeData.get("appearanceCornerStyle")).toBe("square")
    expect(storeData.get("terminalLinkTarget")).toBe("system-browser")
  })

  test("reset methods restore default appearance settings", async () => {
    await useSettingsStore.getState().initialize()

    useSettingsStore.getState().setAppearanceThemeId("nord")
    useSettingsStore.getState().setAppearanceTextSizePx(12)
    useSettingsStore.getState().setAppearanceCornerStyle("rounded")
    await Bun.sleep(350)

    useSettingsStore.getState().resetAppearanceThemeId()
    useSettingsStore.getState().resetAppearanceTextSizePx()
    useSettingsStore.getState().resetAppearanceCornerStyle()
    useSettingsStore.getState().resetTerminalLinkTarget()
    await Bun.sleep(350)

    expect(storeData.get("appearanceThemeId")).toBe("system")
    expect(storeData.get("appearanceTextSizePx")).toBe(13)
    expect(storeData.get("appearanceCornerStyle")).toBe("soft")
    expect(storeData.get("terminalLinkTarget")).toBe("in-app")
    expect(useSettingsStore.getState().appearanceThemeId).toBe("system")
    expect(useSettingsStore.getState().appearanceTextSizePx).toBe(13)
    expect(useSettingsStore.getState().appearanceCornerStyle).toBe("soft")
    expect(useSettingsStore.getState().terminalLinkTarget).toBe("in-app")
  })

  test("persists harness defaults after edits", async () => {
    await useSettingsStore.getState().initialize()

    useSettingsStore.getState().setHarnessDefaultModel("codex", " gpt-5.4 ")
    useSettingsStore.getState().setHarnessDefaultReasoningEffort("codex", " medium ")
    useSettingsStore.getState().setHarnessDefaultFastMode("codex", true)
    useSettingsStore.getState().setHarnessDefaultModel("opencode", " openai/gpt-5.4 ")
    useSettingsStore.getState().setHarnessDefaultModelVariant("opencode", " high ")

    await Bun.sleep(350)

    expect(storeData.get("harnessDefaults")).toEqual({
      codex: {
        model: "gpt-5.4",
        reasoningEffort: "medium",
        modelVariant: "",
        fastMode: true,
      },
      "claude-code": {
        model: "",
        reasoningEffort: "",
        modelVariant: "",
        fastMode: false,
      },
      opencode: {
        model: "openai/gpt-5.4",
        reasoningEffort: "",
        modelVariant: "high",
        fastMode: false,
      },
    })
  })

  test("initializes and toggles favorite models", async () => {
    storeData.set("favoriteModels", ["codex:gpt-5.4", " opencode:openai/gpt-5.4 ", "codex:gpt-5.4"])

    await useSettingsStore.getState().initialize()

    expect(useSettingsStore.getState().favoriteModels).toEqual([
      "codex:gpt-5.4",
      "opencode:openai/gpt-5.4",
    ])

    useSettingsStore.getState().toggleFavoriteModel("claude-code:claude-opus")
    useSettingsStore.getState().toggleFavoriteModel("codex:gpt-5.4")

    await Bun.sleep(350)

    expect(storeData.get("favoriteModels")).toEqual([
      "opencode:openai/gpt-5.4",
      "claude-code:claude-opus",
    ])
  })

  test("reset methods clear persisted harness defaults", async () => {
    await useSettingsStore.getState().initialize()

    useSettingsStore.getState().setHarnessDefaultModel("codex", "gpt-5.4")
    useSettingsStore.getState().setHarnessDefaultReasoningEffort("codex", "high")
    useSettingsStore.getState().setHarnessDefaultModelVariant("codex", "deep")
    useSettingsStore.getState().setHarnessDefaultFastMode("codex", true)
    await Bun.sleep(350)

    useSettingsStore.getState().resetHarnessDefaultModel("codex")
    useSettingsStore.getState().resetHarnessDefaultReasoningEffort("codex")
    useSettingsStore.getState().resetHarnessDefaultModelVariant("codex")
    useSettingsStore.getState().resetHarnessDefaultFastMode("codex")
    await Bun.sleep(350)

    expect(storeData.get("harnessDefaults")).toEqual({
      codex: {
        model: "",
        reasoningEffort: "",
        modelVariant: "",
        fastMode: false,
      },
      "claude-code": {
        model: "",
        reasoningEffort: "",
        modelVariant: "",
        fastMode: false,
      },
      opencode: {
        model: "",
        reasoningEffort: "",
        modelVariant: "",
        fastMode: false,
      },
    })
    expect(useSettingsStore.getState().harnessDefaults.codex.model).toBe("")
    expect(useSettingsStore.getState().harnessDefaults.codex.reasoningEffort).toBe("")
    expect(useSettingsStore.getState().harnessDefaults.codex.modelVariant).toBe("")
    expect(useSettingsStore.getState().harnessDefaults.codex.fastMode).toBe(false)
  })
})
