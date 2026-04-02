import { beforeEach, describe, expect, mock, test } from "bun:test"

import type { Project, ProjectWorktree } from "../types"

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

let discoveredWorktrees: Array<{ path: string; branchName: string; isMain: boolean }> = []
let gitBranchesResponse: { currentBranch?: string; defaultBranch?: string } | null = null
let createWorktreeImpl = async (
  _repoRootPath: string,
  options: { branchName: string; targetPath: string }
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
      homeDir: async () => "/Users/tester",
    },
    git: {
      getBranches: async () => gitBranchesResponse,
      listWorktrees: async () => discoveredWorktrees,
      createWorktree: async (
        repoRootPath: string,
        options: { branchName: string; targetPath: string }
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
    path: "/tmp/.nucleus-worktrees/repo-project-1/kolkata",
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
    defaultLocation: "",
    isLoading: true,
  })
}

describe("projectStore", () => {
  beforeEach(() => {
    storeData.clear()
    discoveredWorktrees = []
    gitBranchesResponse = null
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
    expect(renamedWorktree.path).toBe("/tmp/.nucleus-worktrees/repo-project-1/fix-first-turn-setup")
    expect(renamedWorktree.name).toBe("Fix first turn setup")
    expect(renamedWorktree.intentStatus).toBe("configured")
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
              path: "/tmp/.nucleus-worktrees/repo-project-1/kolkata",
            }),
            createManagedWorktree({
              id: "existing-worktree",
              name: "Fix first turn setup",
              branchName: "feature/fix-first-turn-setup",
              path: "/tmp/.nucleus-worktrees/repo-project-1/fix-first-turn-setup",
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
    expect(renamedWorktree.path).toBe("/tmp/.nucleus-worktrees/repo-project-1/fix-first-turn-setup-2")
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
    expect(project?.hiddenWorktreePaths).toContain("/tmp/.nucleus-worktrees/repo-project-1/kolkata")
    expect(state.activeWorktreeId).toBe("root-worktree")
    expect(removeWorktreeCallCount).toBe(0)
    expect(getChangesCallCount).toBe(0)
  })
})
