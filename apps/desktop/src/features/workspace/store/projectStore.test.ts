import { beforeEach, describe, expect, mock, test } from "bun:test"

import type { Project, ProjectWorktree } from "../types"

const storeData = new Map<string, unknown>()
const directoryEntries = new Map<
  string,
  Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }>
>()
const readDirCalls: string[] = []

const desktopStore = {
  get: async <T>(key: string): Promise<T | null> =>
    storeData.has(key) ? (storeData.get(key) as T) : null,
  set: async (key: string, value: unknown) => {
    storeData.set(key, value)
  },
  delete: async (key: string) => {
    storeData.delete(key)
  },
  save: async () => saveStoreImpl(),
}

let saveStoreImpl = async () => {}

let discoveredWorktrees: Array<{ path: string; branchName: string; isMain: boolean }> = []
let gitBranchesResponse: { currentBranch?: string; defaultBranch?: string } | null = null
let getBranchesImpl = async (_projectPath: string) => gitBranchesResponse
let listWorktreesImpl = async (_projectPath: string) => discoveredWorktrees
let createWorktreeImpl = async (
  _repoRootPath: string,
  options: {
    name?: string
    branchName: string
    baseBranch?: string
    remoteName?: string | null
    targetPath: string
  }
) => ({
  worktree: {
    branchName: options.branchName,
    path: options.targetPath,
  },
})
let renameWorktreeImpl = async (
  _repoRootPath: string,
  options: { worktreePath: string; branchName: string; targetPath?: string | null }
) => ({
  worktree: {
    branchName: options.branchName,
    path: options.targetPath ?? options.worktreePath,
  },
})
let removeWorktreeImpl = async () => {}
let getChangesImpl = async () => [] as Array<unknown>
let pathExists = true
let removeWorktreeCallCount = 0
let renameWorktreeCallCount = 0
let getChangesCallCount = 0
mock.module("@/desktop/client", () => ({
  desktop: {
    fs: {
      exists: async () => pathExists,
      readDir: async (path: string) => {
        readDirCalls.push(path)
        return directoryEntries.get(path) ?? []
      },
      homeDir: async () => "/Users/tester",
    },
    git: {
      getBranches: async (projectPath: string) => getBranchesImpl(projectPath),
      listWorktrees: async (projectPath: string) => listWorktreesImpl(projectPath),
      createWorktree: async (
        repoRootPath: string,
        options: {
          name?: string
          branchName: string
          baseBranch?: string
          remoteName?: string | null
          targetPath: string
        }
      ) => createWorktreeImpl(repoRootPath, options),
      renameWorktree: async (
        repoRootPath: string,
        options: { worktreePath: string; branchName: string; targetPath?: string | null }
      ) => {
        renameWorktreeCallCount += 1
        return renameWorktreeImpl(repoRootPath, options)
      },
      removeWorktree: async (repoRootPath: string, options: { worktreePath: string }) => {
        removeWorktreeCallCount += 1
        return removeWorktreeImpl(repoRootPath, options)
      },
      getChanges: async (worktreePath: string) => {
        getChangesCallCount += 1
        return getChangesImpl(worktreePath)
      },
    },
  },
  loadDesktopStore: async () => desktopStore,
}))

const { useProjectStore } = await import("./projectStore")
const { useTabStore } = await import("@/features/editor/store")

function createRootWorktree(overrides: Partial<ProjectWorktree> = {}): ProjectWorktree {
  return {
    id: "root-worktree",
    name: "Root",
    branchName: "main",
    path: "/tmp/repo",
    createdAt: 1,
    updatedAt: 1,
    source: "root",
    status: "ready",
    intentStatus: "configured",
    ...overrides,
  }
}

function createManagedWorktree(overrides: Partial<ProjectWorktree> = {}): ProjectWorktree {
  return {
    id: "managed-worktree",
    name: "Kolkata",
    branchName: "kolkata",
    path: "/tmp/.vfactor-worktrees/repo-project-1/kolkata",
    createdAt: 2,
    updatedAt: 2,
    source: "managed",
    status: "ready",
    intentStatus: "configured",
    ...overrides,
  }
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Repo",
    iconPath: null,
    faviconPath: null,
    path: "/tmp/repo",
    repoRootPath: "/tmp/repo",
    workspacesPath: null,
    rootWorktreeId: "root-worktree",
    selectedWorktreeId: "root-worktree",
    targetBranch: "main",
    remoteName: null,
    setupScript: null,
    hiddenWorktreePaths: [],
    worktrees: [createRootWorktree()],
    addedAt: 1,
    actions: [],
    primaryActionId: null,
    ...overrides,
  }
}

function createPersistedProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    name: "Repo",
    iconPath: null,
    path: "/tmp/repo",
    addedAt: 1,
    hiddenWorktreePaths: [],
    worktrees: [],
    ...overrides,
  }
}

function resetStoreState() {
  useProjectStore.setState({
    projects: [],
    focusedProjectId: null,
    activeWorktreeId: null,
    newWorkspaceSetupProjectId: null,
    defaultLocation: "",
    isLoading: true,
  })
}

async function waitFor(assertion: () => boolean, timeoutMs = 250): Promise<void> {
  const startedAt = Date.now()
  while (!assertion()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition")
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe("projectStore", () => {
  beforeEach(() => {
    storeData.clear()
    directoryEntries.clear()
    readDirCalls.length = 0
    saveStoreImpl = async () => {}
    discoveredWorktrees = []
    gitBranchesResponse = null
    getBranchesImpl = async (_projectPath) => gitBranchesResponse
    listWorktreesImpl = async (_projectPath) => discoveredWorktrees
    createWorktreeImpl = async (_repoRootPath, options) => ({
      worktree: {
        branchName: options.branchName,
        path: options.targetPath,
      },
    })
    renameWorktreeImpl = async (_repoRootPath, options) => ({
      worktree: {
        branchName: options.branchName,
        path: options.targetPath ?? options.worktreePath,
      },
    })
    removeWorktreeImpl = async () => {}
    getChangesImpl = async () => []
    pathExists = true
    removeWorktreeCallCount = 0
    renameWorktreeCallCount = 0
    getChangesCallCount = 0
    useTabStore.setState({
      rebaseWorktreeTabPaths: mock(() => {}),
    })
    resetStoreState()
  })

  test("hydrates setupScript from persisted project data", async () => {
    storeData.set("projects", [
      createPersistedProject({
        setupScript: "  bun install && bun test  ",
      }),
    ])

    await useProjectStore.getState().loadProjects()

    const project = useProjectStore.getState().projects[0]
    const persistedProjects = storeData.get("projects") as Array<{ setupScript?: string | null }>

    expect(project?.setupScript).toBe("bun install && bun test")
    expect(persistedProjects[0]?.setupScript).toBe("bun install && bun test")
  })

  test("hydrates faviconPath from project files when no image override is set", async () => {
    directoryEntries.set("/tmp/repo", [
      {
        name: "public",
        path: "/tmp/repo/public",
        isDirectory: true,
        isFile: false,
      },
    ])
    directoryEntries.set("/tmp/repo/public", [
      {
        name: "favicon.svg",
        path: "/tmp/repo/public/favicon.svg",
        isDirectory: false,
        isFile: true,
      },
    ])
    storeData.set("projects", [createPersistedProject()])

    await useProjectStore.getState().loadProjects()

    const project = useProjectStore.getState().projects[0]

    expect(project?.iconPath).toBeNull()
    expect(project?.faviconPath).toBe("/tmp/repo/public/favicon.svg")
  })

  test("preserves image overrides while still discovering the fallback favicon", async () => {
    directoryEntries.set("/tmp/repo", [
      {
        name: "public",
        path: "/tmp/repo/public",
        isDirectory: true,
        isFile: false,
      },
    ])
    directoryEntries.set("/tmp/repo/public", [
      {
        name: "favicon.png",
        path: "/tmp/repo/public/favicon.png",
        isDirectory: false,
        isFile: true,
      },
    ])
    storeData.set("projects", [
      createPersistedProject({
        iconPath: "  data:image/png;base64,override  ",
      }),
    ])

    await useProjectStore.getState().loadProjects()

    const project = useProjectStore.getState().projects[0]

    expect(project?.iconPath).toBe("data:image/png;base64,override")
    expect(project?.faviconPath).toBe("/tmp/repo/public/favicon.png")
  })

  test("loadProjects keeps favicon discovery bounded to the project root and top-level candidates", async () => {
    directoryEntries.set("/tmp/repo", [
      {
        name: "apps",
        path: "/tmp/repo/apps",
        isDirectory: true,
        isFile: false,
      },
      {
        name: "packages",
        path: "/tmp/repo/packages",
        isDirectory: true,
        isFile: false,
      },
    ])
    directoryEntries.set("/tmp/repo/apps", [
      {
        name: "desktop",
        path: "/tmp/repo/apps/desktop",
        isDirectory: true,
        isFile: false,
      },
    ])
    directoryEntries.set("/tmp/repo/packages", [
      {
        name: "ui",
        path: "/tmp/repo/packages/ui",
        isDirectory: true,
        isFile: false,
      },
    ])
    storeData.set("projects", [createPersistedProject()])

    await useProjectStore.getState().loadProjects()

    expect(readDirCalls).toEqual(["/tmp/repo", "/tmp/repo/apps", "/tmp/repo/packages"])
  })

  test("updateProject trims and persists setupScript", async () => {
    useProjectStore.setState({
      projects: [createProject()],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    await useProjectStore.getState().updateProject("project-1", {
      setupScript: "  npm install && npm test  ",
    })

    const project = useProjectStore.getState().projects[0]
    const persistedProjects = storeData.get("projects") as Array<{ setupScript?: string | null }>

    expect(project?.setupScript).toBe("npm install && npm test")
    expect(persistedProjects[0]?.setupScript).toBe("npm install && npm test")
  })

  test("normalizes whitespace-only setupScript to null", async () => {
    useProjectStore.setState({
      projects: [createProject({ setupScript: "echo start" })],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    await useProjectStore.getState().updateProject("project-1", {
      setupScript: "   \n\t  ",
    })

    const project = useProjectStore.getState().projects[0]
    const persistedProjects = storeData.get("projects") as Array<{ setupScript?: string | null }>

    expect(project?.setupScript).toBeNull()
    expect(persistedProjects[0]?.setupScript).toBeNull()
  })

  test("updateWorktree trims and persists visual workspace name", async () => {
    useProjectStore.setState({
      projects: [createProject({ worktrees: [createRootWorktree(), createManagedWorktree()] })],
      focusedProjectId: "project-1",
      activeWorktreeId: "managed-worktree",
      isLoading: false,
    })

    const updatedWorktree = await useProjectStore.getState().updateWorktree(
      "project-1",
      "managed-worktree",
      {
        name: "  Checkout polish  ",
      }
    )

    const project = useProjectStore.getState().projects[0]
    const worktree = project?.worktrees.find((candidate) => candidate.id === "managed-worktree")
    const persistedProjects = storeData.get("projects") as Array<Project>
    const persistedWorktree = persistedProjects[0]?.worktrees.find(
      (candidate) => candidate.id === "managed-worktree"
    )

    expect(updatedWorktree.name).toBe("Checkout polish")
    expect(worktree?.name).toBe("Checkout polish")
    expect(persistedWorktree?.name).toBe("Checkout polish")
    expect(worktree?.branchName).toBe("kolkata")
  })

  test("removing the last worktree preserves the project and clears active worktree state", async () => {
    useProjectStore.setState({
      projects: [createProject()],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    await useProjectStore.getState().removeWorktree("project-1", "root-worktree")

    const state = useProjectStore.getState()
    const project = state.projects[0]
    const persistedProjects = storeData.get("projects") as Project[]

    expect(state.projects).toHaveLength(1)
    expect(project?.worktrees).toHaveLength(0)
    expect(project?.rootWorktreeId).toBeNull()
    expect(project?.selectedWorktreeId).toBeNull()
    expect(project?.hiddenWorktreePaths).toContain("/tmp/repo")
    expect(state.focusedProjectId).toBe("project-1")
    expect(state.activeWorktreeId).toBeNull()
    expect(persistedProjects).toHaveLength(1)
    expect((storeData.get("activeWorktreeId") as string | null) ?? null).toBeNull()
    expect(removeWorktreeCallCount).toBe(0)
    expect(getChangesCallCount).toBe(0)
  })

  test("hydration keeps a zero-worktree project stable across reload", async () => {
    storeData.set("projects", [
      createPersistedProject({
        rootWorktreeId: null,
        selectedWorktreeId: null,
        hiddenWorktreePaths: ["/tmp/repo"],
        worktrees: [],
      }),
    ])
    storeData.set("selectedProjectId", "project-1")
    storeData.set("activeWorktreeId", null)

    await useProjectStore.getState().loadProjects()

    const state = useProjectStore.getState()
    const project = state.projects[0]

    expect(project?.worktrees).toHaveLength(0)
    expect(project?.rootWorktreeId).toBeNull()
    expect(project?.selectedWorktreeId).toBeNull()
    expect(state.focusedProjectId).toBe("project-1")
    expect(state.activeWorktreeId).toBeNull()
  })

  test("loadProjects clears any persisted active worktree selection on launch", async () => {
    storeData.set("projects", [createPersistedProject()])
    storeData.set("selectedProjectId", "project-1")
    storeData.set("activeWorktreeId", "root-worktree")

    await useProjectStore.getState().loadProjects()

    const state = useProjectStore.getState()

    expect(state.focusedProjectId).toBe("project-1")
    expect(state.activeWorktreeId).toBeNull()
    expect((storeData.get("activeWorktreeId") as string | null) ?? null).toBeNull()
  })

  test("loadProjects restores persisted projects before async refresh completes", async () => {
    storeData.set("projects", [
      createPersistedProject({
        rootWorktreeId: "root-worktree",
        selectedWorktreeId: "root-worktree",
        targetBranch: "stale-main",
      }),
    ])
    storeData.set("selectedProjectId", "project-1")

    let releaseBranches: (() => void) | null = null
    const branchesGate = new Promise<void>((resolve) => {
      releaseBranches = resolve
    })

    listWorktreesImpl = async () => [
      {
        path: "/tmp/repo",
        branchName: "main",
        isMain: true,
      },
      {
        path: "/tmp/.vfactor-worktrees/repo-project-1/feature-fast-restore",
        branchName: "feature/fast-restore",
        isMain: false,
      },
    ]

    getBranchesImpl = async () => {
      await branchesGate
      return {
        currentBranch: "main",
        defaultBranch: "origin/main",
      }
    }

    const loadPromise = useProjectStore.getState().loadProjects()
    await waitFor(() => useProjectStore.getState().isLoading === false)

    const interimState = useProjectStore.getState()
    expect(interimState.isLoading).toBe(false)
    expect(interimState.projects).toHaveLength(1)
    expect(interimState.focusedProjectId).toBe("project-1")
    expect(interimState.activeWorktreeId).toBeNull()
    expect(interimState.projects[0]?.worktrees).toHaveLength(1)

    releaseBranches?.()
    await loadPromise

    const finalState = useProjectStore.getState()
    expect(finalState.projects[0]?.worktrees).toHaveLength(2)
    expect(finalState.activeWorktreeId).toBeNull()
    expect((storeData.get("activeWorktreeId") as string | null) ?? null).toBeNull()
  })

  test("loadProjects leaves targetBranch unset until git metadata resolves", async () => {
    storeData.set("projects", [
      createPersistedProject({
        rootWorktreeId: "root-worktree",
        selectedWorktreeId: "root-worktree",
      }),
    ])
    storeData.set("selectedProjectId", "project-1")

    let releaseBranches: (() => void) | null = null
    const branchesGate = new Promise<void>((resolve) => {
      releaseBranches = resolve
    })

    listWorktreesImpl = async () => [
      {
        path: "/tmp/repo",
        branchName: "tests/app",
        isMain: true,
      },
    ]

    getBranchesImpl = async () => {
      await branchesGate
      return {
        currentBranch: "tests/app",
        defaultBranch: "main",
      }
    }

    const loadPromise = useProjectStore.getState().loadProjects()
    await waitFor(() => useProjectStore.getState().isLoading === false)

    expect(useProjectStore.getState().projects[0]?.targetBranch).toBeNull()

    releaseBranches?.()
    await loadPromise

    expect(useProjectStore.getState().projects[0]?.targetBranch).toBe("main")
  })

  test("background refresh preserves a project selected during startup", async () => {
    storeData.set("projects", [
      createPersistedProject({
        rootWorktreeId: "root-worktree-1",
        selectedWorktreeId: "root-worktree-1",
      }),
      createPersistedProject({
        id: "project-2",
        name: "Repo Two",
        path: "/tmp/repo-2",
        repoRootPath: "/tmp/repo-2",
        rootWorktreeId: "root-worktree-2",
        selectedWorktreeId: "root-worktree-2",
        targetBranch: "develop",
      }),
    ])
    storeData.set("selectedProjectId", "project-1")

    let releaseBranches: (() => void) | null = null
    const branchesGate = new Promise<void>((resolve) => {
      releaseBranches = resolve
    })

    getBranchesImpl = async (projectPath) => {
      await branchesGate
      return projectPath === "/tmp/repo-2"
        ? {
            currentBranch: "develop",
            defaultBranch: "origin/develop",
          }
        : {
            currentBranch: "main",
            defaultBranch: "origin/main",
          }
    }

    const loadPromise = useProjectStore.getState().loadProjects()
    await waitFor(() => useProjectStore.getState().projects.length === 2)
    await useProjectStore.getState().selectProject("project-2")

    releaseBranches?.()
    await loadPromise

    const state = useProjectStore.getState()
    expect(state.focusedProjectId).toBe("project-2")
    expect(state.activeWorktreeId).toBe("root-worktree-2")
    expect((storeData.get("selectedProjectId") as string | null) ?? null).toBe("project-2")
  })

  test("selecting a zero-worktree project focuses it and leaves activeWorktreeId null", async () => {
    useProjectStore.setState({
      projects: [
        createProject({
          id: "project-1",
          rootWorktreeId: null,
          selectedWorktreeId: null,
          hiddenWorktreePaths: ["/tmp/repo"],
          worktrees: [],
        }),
        createProject({
          id: "project-2",
          path: "/tmp/repo-2",
          repoRootPath: "/tmp/repo-2",
          worktrees: [createRootWorktree({ id: "root-worktree-2", path: "/tmp/repo-2" })],
          rootWorktreeId: "root-worktree-2",
          selectedWorktreeId: "root-worktree-2",
        }),
      ],
      focusedProjectId: "project-2",
      activeWorktreeId: "root-worktree-2",
      isLoading: false,
    })

    await useProjectStore.getState().selectProject("project-1")

    const state = useProjectStore.getState()
    expect(state.focusedProjectId).toBe("project-1")
    expect(state.activeWorktreeId).toBeNull()
  })

  test("selectWorktree updates selection before persistence finishes", async () => {
    let releaseSave: (() => void) | null = null
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    saveStoreImpl = async () => {
      await saveGate
    }

    useProjectStore.setState({
      projects: [
        createProject({
          selectedWorktreeId: "root-worktree",
          worktrees: [createRootWorktree(), createManagedWorktree()],
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    const selectPromise = useProjectStore.getState().selectWorktree("project-1", "managed-worktree")

    const interimState = useProjectStore.getState()
    expect(interimState.focusedProjectId).toBe("project-1")
    expect(interimState.activeWorktreeId).toBe("managed-worktree")
    expect(interimState.projects[0]?.selectedWorktreeId).toBe("managed-worktree")

    releaseSave?.()
    await selectPromise

    const persistedProjects = storeData.get("projects") as Project[]
    expect(persistedProjects[0]?.selectedWorktreeId).toBe("managed-worktree")
  })

  test("creating a worktree from a zero-worktree project reactivates it", async () => {
    useProjectStore.setState({
      projects: [
        createProject({
          rootWorktreeId: null,
          selectedWorktreeId: null,
          hiddenWorktreePaths: ["/tmp/repo"],
          worktrees: [],
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: null,
      isLoading: false,
    })

    const createdWorktree = await useProjectStore.getState().createWorktree("project-1")

    const state = useProjectStore.getState()
    const project = state.projects[0]

    expect(project?.worktrees).toHaveLength(1)
    expect(project?.selectedWorktreeId).toBe(createdWorktree.id)
    expect(project?.rootWorktreeId).toBe(createdWorktree.id)
    expect(state.focusedProjectId).toBe("project-1")
    expect(state.activeWorktreeId).toBe(createdWorktree.id)
    expect(createdWorktree.status).toBe("ready")
  })

  test("startNewWorkspaceSetup activates project-level setup mode", () => {
    useProjectStore.setState({
      projects: [createProject()],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      newWorkspaceSetupProjectId: null,
      isLoading: false,
    })

    useProjectStore.getState().startNewWorkspaceSetup("project-1")

    expect(useProjectStore.getState().newWorkspaceSetupProjectId).toBe("project-1")
  })

  test("cancelNewWorkspaceSetup clears project-level setup mode", () => {
    useProjectStore.setState({
      projects: [createProject()],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      newWorkspaceSetupProjectId: "project-1",
      isLoading: false,
    })

    useProjectStore.getState().cancelNewWorkspaceSetup()

    expect(useProjectStore.getState().newWorkspaceSetupProjectId).toBeNull()
  })

  test("createWorktreeFromIntent creates a configured managed workspace from final naming", async () => {
    useProjectStore.setState({
      projects: [createProject()],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    const createdWorktree = await useProjectStore.getState().createWorktreeFromIntent("project-1", {
      branchName: "feature/fix-first-turn-setup",
      name: "Fix first turn setup",
    })

    const state = useProjectStore.getState()
    const project = state.projects[0]

    expect(createdWorktree.branchName).toBe("feature/fix-first-turn-setup")
    expect(createdWorktree.path).toBe("/tmp/.vfactor-worktrees/repo-project-1/fix-first-turn-setup")
    expect(createdWorktree.name).toBe("Fix first turn setup")
    expect(createdWorktree.intentStatus).toBe("configured")
    expect(project?.selectedWorktreeId).toBe(createdWorktree.id)
    expect(state.activeWorktreeId).toBe(createdWorktree.id)
  })

  test("createWorktreeFromIntent adds entropy when the target workspace path is already taken", async () => {
    useProjectStore.setState({
      projects: [
        createProject({
          worktrees: [
            createRootWorktree(),
            createManagedWorktree({
              id: "existing-worktree",
              name: "Fix first turn setup",
              branchName: "feature/fix-first-turn-setup",
              path: "/tmp/.vfactor-worktrees/repo-project-1/fix-first-turn-setup",
            }),
          ],
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    const createdWorktree = await useProjectStore.getState().createWorktreeFromIntent("project-1", {
      branchName: "feature/fix-first-turn-setup",
      name: "Fix first turn setup",
    })

    expect(createdWorktree.branchName).toBe("feature/fix-first-turn-setup-2")
    expect(createdWorktree.path).toBe("/tmp/.vfactor-worktrees/repo-project-1/fix-first-turn-setup-2")
    expect(createdWorktree.name).toBe("Fix first turn setup 2")
  })

  test("createWorktreeFromIntent adds entropy when an existing worktree already uses the branch name", async () => {
    useProjectStore.setState({
      projects: [
        createProject({
          worktrees: [
            createRootWorktree(),
            createManagedWorktree({
              id: "manual-worktree",
              name: "Manual setup branch",
              branchName: "feature/fix-first-turn-setup",
              path: "/tmp/manual-worktrees/fix-first-turn-setup",
            }),
          ],
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    const createdWorktree = await useProjectStore.getState().createWorktreeFromIntent("project-1", {
      branchName: "feature/fix-first-turn-setup",
      name: "Fix first turn setup",
    })

    expect(createdWorktree.branchName).toBe("feature/fix-first-turn-setup-2")
    expect(createdWorktree.path).toBe("/tmp/.vfactor-worktrees/repo-project-1/fix-first-turn-setup-2")
    expect(createdWorktree.name).toBe("Fix first turn setup 2")
  })

  test("createWorktreeFromIntent can create without activating the new workspace", async () => {
    useProjectStore.setState({
      projects: [createProject()],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    const createdWorktree = await useProjectStore.getState().createWorktreeFromIntent(
      "project-1",
      {
        branchName: "feature/fix-first-turn-setup",
        name: "Fix first turn setup",
      },
      {
        activateOnSuccess: false,
      }
    )

    const state = useProjectStore.getState()
    const project = state.projects[0]

    expect(createdWorktree.branchName).toBe("feature/fix-first-turn-setup")
    expect(project?.selectedWorktreeId).toBe("root-worktree")
    expect(state.activeWorktreeId).toBe("root-worktree")
    expect(state.focusedProjectId).toBe("project-1")
  })

  test("createWorktreeFromIntent uses the repo default branch when targetBranch is unset", async () => {
    let createWorktreeBaseBranch: string | null = null
    createWorktreeImpl = async (_repoRootPath, options) => {
      createWorktreeBaseBranch = options.baseBranch ?? null
      return {
        worktree: {
          branchName: options.branchName,
          path: options.targetPath,
        },
      }
    }
    getBranchesImpl = async () => ({
      isGitAvailable: true,
      isRepo: true,
      currentBranch: "tests/app",
      defaultBranch: "main",
    })

    useProjectStore.setState({
      projects: [
        createProject({
          targetBranch: null,
          worktrees: [createRootWorktree({ branchName: "tests/app" })],
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    await useProjectStore.getState().createWorktreeFromIntent("project-1", {
      branchName: "feature/fix-first-turn-setup",
      name: "Fix first turn setup",
    })

    expect(createWorktreeBaseBranch).toBe("main")
  })

  test("selectWorktree updates project-local selection and global active state", async () => {
    useProjectStore.setState({
      projects: [
        createProject({
          worktrees: [createRootWorktree(), createManagedWorktree()],
          selectedWorktreeId: "root-worktree",
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    await useProjectStore.getState().selectWorktree("project-1", "managed-worktree")

    const state = useProjectStore.getState()
    expect(state.projects[0]?.selectedWorktreeId).toBe("managed-worktree")
    expect(state.focusedProjectId).toBe("project-1")
    expect(state.activeWorktreeId).toBe("managed-worktree")
  })

  test("renameWorktreeFromIntent renames a pending managed worktree and marks it configured", async () => {
    useProjectStore.setState({
      projects: [
        createProject({
          worktrees: [
            createRootWorktree(),
            createManagedWorktree({
              intentStatus: "pending",
            }),
          ],
          selectedWorktreeId: "managed-worktree",
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: "managed-worktree",
      isLoading: false,
    })

    const renamedWorktree = await useProjectStore.getState().renameWorktreeFromIntent(
      "project-1",
      "managed-worktree",
      {
        branchName: "fix-first-turn-setup",
        name: "Fix first turn setup",
      }
    )

    expect(renameWorktreeCallCount).toBe(1)
    expect(renamedWorktree.branchName).toBe("fix-first-turn-setup")
    expect(renamedWorktree.path).toBe("/tmp/.vfactor-worktrees/repo-project-1/fix-first-turn-setup")
    expect(renamedWorktree.name).toBe("Fix first turn setup")
    expect(renamedWorktree.intentStatus).toBe("configured")
    expect(useTabStore.getState().rebaseWorktreeTabPaths).toHaveBeenCalledWith(
      "managed-worktree",
      "/tmp/.vfactor-worktrees/repo-project-1/kolkata",
      "/tmp/.vfactor-worktrees/repo-project-1/fix-first-turn-setup",
    )
  })

  test("renameWorktreeFromIntent adds entropy when the target workspace path is already taken", async () => {
    useProjectStore.setState({
      projects: [
        createProject({
          worktrees: [
            createRootWorktree(),
            createManagedWorktree({
              id: "managed-worktree",
              intentStatus: "pending",
              path: "/tmp/.vfactor-worktrees/repo-project-1/kolkata",
            }),
            createManagedWorktree({
              id: "existing-worktree",
              name: "Fix first turn setup",
              branchName: "feature/fix-first-turn-setup",
              path: "/tmp/.vfactor-worktrees/repo-project-1/fix-first-turn-setup",
              createdAt: 3,
              updatedAt: 3,
            }),
          ],
          selectedWorktreeId: "managed-worktree",
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: "managed-worktree",
      isLoading: false,
    })

    const renamedWorktree = await useProjectStore.getState().renameWorktreeFromIntent(
      "project-1",
      "managed-worktree",
      {
        branchName: "fix-first-turn-setup",
        name: "Fix first turn setup",
      }
    )

    expect(renameWorktreeCallCount).toBe(1)
    expect(renamedWorktree.branchName).toBe("fix-first-turn-setup-2")
    expect(renamedWorktree.path).toBe("/tmp/.vfactor-worktrees/repo-project-1/fix-first-turn-setup-2")
    expect(renamedWorktree.name).toBe("Fix first turn setup 2")
    expect(renamedWorktree.intentStatus).toBe("configured")
  })

  test("removing a managed workspace with changes only hides it from the app", async () => {
    getChangesImpl = async () => [{ path: "src/app.ts" }]

    useProjectStore.setState({
      projects: [
        createProject({
          worktrees: [createRootWorktree(), createManagedWorktree()],
          selectedWorktreeId: "managed-worktree",
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: "managed-worktree",
      isLoading: false,
    })

    await useProjectStore.getState().removeWorktree("project-1", "managed-worktree")

    const state = useProjectStore.getState()
    const project = state.projects[0]

    expect(project?.worktrees.map((worktree) => worktree.id)).toEqual(["root-worktree"])
    expect(project?.hiddenWorktreePaths).toContain("/tmp/.vfactor-worktrees/repo-project-1/kolkata")
    expect(state.activeWorktreeId).toBe("root-worktree")
    expect(removeWorktreeCallCount).toBe(0)
    expect(getChangesCallCount).toBe(0)
  })

  test("removing a managed workspace from disk calls git removal and does not hide its path", async () => {
    useProjectStore.setState({
      projects: [
        createProject({
          worktrees: [createRootWorktree(), createManagedWorktree()],
          selectedWorktreeId: "managed-worktree",
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: "managed-worktree",
      isLoading: false,
    })

    await useProjectStore.getState().removeWorktree("project-1", "managed-worktree", {
      deleteFromDisk: true,
    })

    const state = useProjectStore.getState()
    const project = state.projects[0]

    expect(project?.worktrees.map((worktree) => worktree.id)).toEqual(["root-worktree"])
    expect(project?.hiddenWorktreePaths).not.toContain("/tmp/.vfactor-worktrees/repo-project-1/kolkata")
    expect(state.activeWorktreeId).toBe("root-worktree")
    expect(removeWorktreeCallCount).toBe(1)
    expect(getChangesCallCount).toBe(0)
  })

  test("archiving the active managed workspace falls back to the remaining worktree", async () => {
    useProjectStore.setState({
      projects: [
        createProject({
          worktrees: [createRootWorktree(), createManagedWorktree()],
          selectedWorktreeId: "managed-worktree",
        }),
      ],
      focusedProjectId: "project-1",
      activeWorktreeId: "managed-worktree",
      isLoading: false,
    })

    await useProjectStore.getState().removeWorktree("project-1", "managed-worktree", {
      deleteFromDisk: true,
    })

    const state = useProjectStore.getState()
    const project = state.projects[0]

    expect(project?.worktrees.map((worktree) => worktree.id)).toEqual(["root-worktree"])
    expect(state.focusedProjectId).toBe("project-1")
    expect(state.activeWorktreeId).toBe("root-worktree")
  })

  test("deleting the root workspace from disk is rejected", async () => {
    useProjectStore.setState({
      projects: [createProject()],
      focusedProjectId: "project-1",
      activeWorktreeId: "root-worktree",
      isLoading: false,
    })

    await expect(
      useProjectStore.getState().removeWorktree("project-1", "root-worktree", {
        deleteFromDisk: true,
      })
    ).rejects.toThrow("root workspace cannot be deleted from disk")

    expect(removeWorktreeCallCount).toBe(0)
  })
})
