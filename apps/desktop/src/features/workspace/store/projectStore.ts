import { create } from "zustand"
import {
  desktop,
  loadDesktopStore,
  type DesktopStoreHandle,
  type GitBranchesResponse,
  type GitWorktreeSummary,
} from "@/desktop/client"
import type { Project, ProjectAction, ProjectWorktree } from "../types"
import { normalizeProjectIconPath } from "../utils/projectIcon"
import { normalizeProjectActionIconName } from "../utils/projectActionIcons"
import {
  generateManagedWorktreeIdentity,
  getSelectedWorktree,
  isWorktreeReady,
  resolveRepoRootPath,
} from "../utils/worktrees"

const STORE_FILE = "projects.json"
const STORE_KEY = "projects"
const DEFAULT_LOCATION_KEY = "defaultLocation"
const SELECTED_PROJECT_KEY = "selectedProjectId"

type LegacyProject = Partial<Project> & {
  id: string
  name: string
  path: string
  addedAt?: number
}

interface ProjectState {
  projects: Project[]
  selectedProjectId: string | null
  defaultLocation: string
  isLoading: boolean
  loadProjects: () => Promise<void>
  addProject: (path: string, name?: string) => Promise<void>
  removeProject: (id: string) => Promise<void>
  setProjectOrder: (projects: Project[]) => Promise<void>
  selectProject: (id: string) => Promise<void>
  selectWorktree: (projectId: string, worktreeId: string) => Promise<void>
  createWorktree: (projectId: string) => Promise<ProjectWorktree>
  removeWorktree: (projectId: string, worktreeId: string) => Promise<void>
  updateProject: (id: string, updates: Partial<Pick<Project, "name" | "iconPath">>) => Promise<void>
  setTargetBranch: (projectId: string, branchName: string | null) => Promise<void>
  addProjectAction: (
    projectId: string,
    action: Omit<ProjectAction, "id" | "createdAt">
  ) => Promise<ProjectAction>
  updateProjectAction: (
    projectId: string,
    actionId: string,
    updates: Omit<ProjectAction, "id" | "createdAt">
  ) => Promise<ProjectAction>
  deleteProjectAction: (projectId: string, actionId: string) => Promise<void>
  setPrimaryAction: (projectId: string, actionId: string) => Promise<void>
  setDefaultLocation: (path: string) => Promise<void>
}

let storeInstance: DesktopStoreHandle | null = null

async function getStore(): Promise<DesktopStoreHandle> {
  if (!storeInstance) {
    storeInstance = await loadDesktopStore(STORE_FILE)
  }
  return storeInstance
}

function normalizeWorktree(
  worktree: Partial<ProjectWorktree>,
  fallback: {
    id: string
    name: string
    branchName: string
    path: string
    source: ProjectWorktree["source"]
    createdAt: number
  }
): ProjectWorktree {
  return {
    id: worktree.id ?? fallback.id,
    name: worktree.name?.trim() || fallback.name,
    branchName: worktree.branchName?.trim() || fallback.branchName,
    path: worktree.path?.trim() || fallback.path,
    source: worktree.source ?? fallback.source,
    status: worktree.status ?? "ready",
    createdAt: worktree.createdAt ?? fallback.createdAt,
    updatedAt: worktree.updatedAt ?? Date.now(),
  }
}

function sortWorktrees(worktrees: ProjectWorktree[]): ProjectWorktree[] {
  return [...worktrees].sort((a, b) => {
    if (a.source === "root" && b.source !== "root") {
      return -1
    }
    if (a.source !== "root" && b.source === "root") {
      return 1
    }
    return b.updatedAt - a.updatedAt
  })
}

function normalizeComparablePath(filePath: string | null | undefined): string {
  return filePath?.trim().replace(/\/+$/, "") ?? ""
}

function hydrateProjectActions(project: LegacyProject): Pick<Project, "actions" | "primaryActionId" | "iconPath"> {
  const actions = Array.isArray(project.actions)
    ? project.actions.map((action) => ({
        ...action,
        iconName: normalizeProjectActionIconName(action.iconName),
        iconPath: normalizeProjectIconPath(action.iconPath),
        hotkey: action.hotkey ?? null,
      }))
    : []

  const primaryActionId =
    project.primaryActionId && actions.some((action) => action.id === project.primaryActionId)
      ? project.primaryActionId
      : actions[0]?.id ?? null

  return {
    iconPath: normalizeProjectIconPath(project.iconPath),
    actions,
    primaryActionId,
  }
}

async function getGitMetadata(projectPath: string): Promise<{
  branchData: GitBranchesResponse | null
  worktrees: GitWorktreeSummary[]
}> {
  try {
    const [branchData, worktrees] = await Promise.all([
      desktop.git.getBranches(projectPath).catch(() => null),
      desktop.git.listWorktrees(projectPath).catch(() => []),
    ])

    return { branchData, worktrees }
  } catch {
    return { branchData: null, worktrees: [] }
  }
}

async function hydrateProject(project: LegacyProject): Promise<Project> {
  const now = Date.now()
  const { iconPath, actions, primaryActionId } = hydrateProjectActions(project)
  const { branchData, worktrees: discoveredWorktrees } = await getGitMetadata(project.path)
  const repoRootPath = project.repoRootPath?.trim() || resolveRepoRootPath(project.path, discoveredWorktrees)
  const existingWorktrees = Array.isArray(project.worktrees) ? project.worktrees : []
  const hiddenWorktreePaths = Array.isArray(project.hiddenWorktreePaths)
    ? project.hiddenWorktreePaths.filter((candidate): candidate is string => Boolean(candidate?.trim()))
    : []
  const hiddenWorktreePathSet = new Set(hiddenWorktreePaths)
  const isRepoRootHidden = hiddenWorktreePathSet.has(repoRootPath)
  const existingRoot =
    existingWorktrees.find((worktree) => worktree.source === "root") ??
    existingWorktrees.find((worktree) => worktree.path === repoRootPath)
  const rootDiscovered = discoveredWorktrees.find((worktree) => worktree.path === repoRootPath)
  const rootWorktreeId = project.rootWorktreeId ?? existingRoot?.id ?? crypto.randomUUID()
  const rootWorktree = normalizeWorktree(existingRoot ?? {}, {
    id: rootWorktreeId,
    name: existingRoot?.name?.trim() || "Root",
    branchName:
      existingRoot?.branchName?.trim() ||
      rootDiscovered?.branchName?.trim() ||
      branchData?.currentBranch?.trim() ||
      "No branch",
    path: repoRootPath,
    source: "root",
    createdAt: existingRoot?.createdAt ?? project.addedAt ?? now,
  })

  const existingByPath = new Map(existingWorktrees.map((worktree) => [worktree.path, worktree]))
  const nextWorktrees = new Map<string, ProjectWorktree>()

  if (!isRepoRootHidden) {
    nextWorktrees.set(rootWorktree.id, rootWorktree)
  }

  for (const worktree of discoveredWorktrees) {
    if (hiddenWorktreePathSet.has(worktree.path)) {
      continue
    }

    if (worktree.path === repoRootPath) {
      continue
    }

    const existing = existingByPath.get(worktree.path)
    const nextWorktree = normalizeWorktree(existing ?? {}, {
      id: existing?.id ?? crypto.randomUUID(),
      name: existing?.name?.trim() || worktree.branchName,
      branchName: worktree.branchName,
      path: worktree.path,
      source: existing?.source ?? "managed",
      createdAt: existing?.createdAt ?? now,
    })

    nextWorktrees.set(nextWorktree.id, nextWorktree)
  }

  for (const worktree of existingWorktrees) {
    if (nextWorktrees.has(worktree.id)) {
      continue
    }

    const worktreePath = worktree.path?.trim()
    if (!worktreePath) {
      continue
    }

    if (hiddenWorktreePathSet.has(worktreePath)) {
      continue
    }

    if (worktree.source === "root" && worktreePath === repoRootPath) {
      continue
    }

    if (worktree.source === "managed") {
      const pathExists = await desktop.fs.exists(worktreePath).catch(() => false)
      if (!pathExists || !isWorktreeReady(worktree)) {
        continue
      }
    }

    nextWorktrees.set(
      worktree.id,
      normalizeWorktree(worktree, {
        id: worktree.id,
        name: worktree.name || worktree.branchName || "Worktree",
        branchName: worktree.branchName || "No branch",
        path: worktree.path || project.path,
        source: worktree.source ?? "managed",
        createdAt: worktree.createdAt ?? now,
      })
    )
  }

  const normalizedWorktrees = sortWorktrees(Array.from(nextWorktrees.values()))
  const matchingProjectPathWorktree = normalizedWorktrees.find(
    (worktree) => normalizeComparablePath(worktree.path) === normalizeComparablePath(project.path)
  )
  const fallbackSelectedWorktree =
    matchingProjectPathWorktree ??
    normalizedWorktrees.find((worktree) => worktree.id === project.rootWorktreeId) ??
    normalizedWorktrees.find((worktree) => worktree.status === "ready") ??
    normalizedWorktrees[0] ??
    null
  const selectedWorktreeId =
    normalizedWorktrees.some((worktree) => worktree.id === project.selectedWorktreeId)
      ? project.selectedWorktreeId ?? fallbackSelectedWorktree?.id ?? null
      : fallbackSelectedWorktree?.id ?? null

  return {
    id: project.id,
    name: project.name,
    iconPath,
    path: project.path,
    repoRootPath,
    rootWorktreeId,
    selectedWorktreeId,
    targetBranch:
      project.targetBranch?.trim() ||
      branchData?.defaultBranch?.trim() ||
      rootWorktree.branchName ||
      null,
    hiddenWorktreePaths,
    worktrees: normalizedWorktrees,
    addedAt: project.addedAt ?? now,
    actions,
    primaryActionId,
  }
}

async function persistProjects(projects: Project[], selectedProjectId: string | null): Promise<void> {
  const store = await getStore()
  await store.set(STORE_KEY, projects)
  await store.set(SELECTED_PROJECT_KEY, selectedProjectId)
  await store.save()
}

function replaceProject(projects: Project[], nextProject: Project): Project[] {
  return projects.map((project) => (project.id === nextProject.id ? nextProject : project))
}

async function createNewProject(path: string, name?: string): Promise<Project> {
  return hydrateProject({
    id: crypto.randomUUID(),
    name: name || path.split("/").pop() || path,
    path,
    addedAt: Date.now(),
    hiddenWorktreePaths: [],
    worktrees: [],
  })
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  defaultLocation: "",
  isLoading: true,

  loadProjects: async () => {
    try {
      const store = await getStore()
      const persisted = await store.get<LegacyProject[]>(STORE_KEY)
      const savedLocation = await store.get<string>(DEFAULT_LOCATION_KEY)
      const savedSelectedId = await store.get<string>(SELECTED_PROJECT_KEY)

      let defaultLoc = savedLocation || ""
      if (!defaultLoc) {
        try {
          defaultLoc = await desktop.fs.homeDir()
        } catch {
          defaultLoc = ""
        }
      }

      if (!persisted || !Array.isArray(persisted)) {
        set({ projects: [], defaultLocation: defaultLoc, isLoading: false })
        return
      }

      const projects = await Promise.all(persisted.map((project) => hydrateProject(project)))
      const validSelectedId =
        savedSelectedId && projects.some((project) => project.id === savedSelectedId)
          ? savedSelectedId
          : projects[0]?.id ?? null

      await persistProjects(projects, validSelectedId)

      set({
        projects,
        selectedProjectId: validSelectedId,
        defaultLocation: defaultLoc,
        isLoading: false,
      })
    } catch (error) {
      console.error("Failed to load projects:", error)
      set({ projects: [], defaultLocation: "", isLoading: false })
    }
  },

  addProject: async (path, name) => {
    const { projects } = get()

    if (projects.some((project) => project.path === path)) {
      return
    }

    const newProject = await createNewProject(path, name)
    const nextProjects = [newProject, ...projects]

    await persistProjects(nextProjects, newProject.id)
    set({
      projects: nextProjects,
      selectedProjectId: newProject.id,
    })
  },

  removeProject: async (id) => {
    const { projects, selectedProjectId } = get()
    const nextProjects = projects.filter((project) => project.id !== id)
    const nextSelectedProjectId =
      selectedProjectId === id ? nextProjects[0]?.id ?? null : selectedProjectId

    await persistProjects(nextProjects, nextSelectedProjectId)
    set({ projects: nextProjects, selectedProjectId: nextSelectedProjectId })
  },

  setProjectOrder: async (projects) => {
    const previousProjects = get().projects
    set({ projects })

    try {
      await persistProjects(projects, get().selectedProjectId)
    } catch (error) {
      console.error("Failed to persist project order:", error)
      set({ projects: previousProjects })
      throw error
    }
  },

  selectProject: async (id) => {
    set({ selectedProjectId: id })

    try {
      const store = await getStore()
      await store.set(SELECTED_PROJECT_KEY, id)
      await store.save()
    } catch (error) {
      console.error("Failed to persist selected project:", error)
    }
  },

  selectWorktree: async (projectId, worktreeId) => {
    const project = get().projects.find((candidate) => candidate.id === projectId)
    if (!project || !project.worktrees.some((worktree) => worktree.id === worktreeId && isWorktreeReady(worktree))) {
      return
    }

    const nextProject = {
      ...project,
      selectedWorktreeId: worktreeId,
    }
    const nextProjects = replaceProject(get().projects, nextProject)

    await persistProjects(nextProjects, get().selectedProjectId)
    set({ projects: nextProjects })
  },

  createWorktree: async (projectId) => {
    const project = get().projects.find((candidate) => candidate.id === projectId)
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`)
    }

    const identity = generateManagedWorktreeIdentity(project)
    const creatingWorktree: ProjectWorktree = {
      id: crypto.randomUUID(),
      name: identity.name,
      branchName: identity.branchName,
      path: identity.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: "managed",
      status: "creating",
    }

    const provisionalProject = {
      ...project,
      selectedWorktreeId: project.selectedWorktreeId,
      worktrees: sortWorktrees([...project.worktrees, creatingWorktree]),
    }
    const provisionalProjects = replaceProject(get().projects, provisionalProject)
    set({ projects: provisionalProjects })

    try {
      const baseBranch = project.targetBranch?.trim() || getSelectedWorktree(project)?.branchName
      if (!baseBranch) {
        throw new Error("Choose a target branch before creating a worktree.")
      }

      const result = await desktop.git.createWorktree(project.repoRootPath, {
        name: identity.name,
        branchName: identity.branchName,
        baseBranch,
        targetPath: identity.path,
      })

      const readyWorktree: ProjectWorktree = {
        ...creatingWorktree,
        branchName: result.worktree.branchName,
        path: result.worktree.path,
        updatedAt: Date.now(),
        status: "ready",
      }
      const latestProject =
        get().projects.find((candidate) => candidate.id === project.id) ?? provisionalProject
      const readyProject = {
        ...latestProject,
        selectedWorktreeId: creatingWorktree.id,
        worktrees: sortWorktrees(
          latestProject.worktrees.map((worktree) =>
            worktree.id === creatingWorktree.id ? readyWorktree : worktree
          )
        ),
      }
      const readyProjects = replaceProject(get().projects, readyProject)
      await persistProjects(readyProjects, get().selectedProjectId)
      set({ projects: readyProjects })
      return readyWorktree
    } catch (error) {
      const latestProject =
        get().projects.find((candidate) => candidate.id === project.id) ?? provisionalProject
      const failedProject = {
        ...latestProject,
        selectedWorktreeId:
          latestProject.selectedWorktreeId === creatingWorktree.id
            ? project.selectedWorktreeId
            : latestProject.selectedWorktreeId,
        worktrees: sortWorktrees(
          latestProject.worktrees.filter((worktree) => worktree.id !== creatingWorktree.id)
        ),
      }
      const failedProjects = replaceProject(get().projects, failedProject)
      await persistProjects(failedProjects, get().selectedProjectId)
      set({ projects: failedProjects })
      throw error
    }
  },

  removeWorktree: async (projectId, worktreeId) => {
    const project = get().projects.find((candidate) => candidate.id === projectId)
    const worktree = project?.worktrees.find((candidate) => candidate.id === worktreeId) ?? null

    if (!project || !worktree) {
      throw new Error(`Unknown worktree: ${projectId}/${worktreeId}`)
    }

    const nextWorktrees = project.worktrees.filter((candidate) => candidate.id !== worktreeId)

    const removingVisibleRootWorktree = worktree.source === "root"
    const removingPrimaryWorktree = project.rootWorktreeId === worktreeId
    if (removingVisibleRootWorktree) {
      const changes = await desktop.git.getChanges(worktree.path)
      if (changes.length > 0) {
        throw new Error("This worktree has uncommitted changes. Clean it up before removing it.")
      }
    } else {
      await desktop.git.removeWorktree(project.repoRootPath, { worktreePath: worktree.path })
    }

    if (nextWorktrees.length === 0) {
      const nextProjects = get().projects.filter((candidate) => candidate.id !== projectId)
      const nextSelectedProjectId =
        get().selectedProjectId === projectId ? nextProjects[0]?.id ?? null : get().selectedProjectId

      await persistProjects(nextProjects, nextSelectedProjectId)
      set({ projects: nextProjects, selectedProjectId: nextSelectedProjectId })
      return
    }

    const nextPrimaryWorktree = removingPrimaryWorktree
      ? nextWorktrees.find((candidate) => candidate.status === "ready") ?? nextWorktrees[0] ?? null
      : nextWorktrees.find((candidate) => candidate.id === project.rootWorktreeId) ?? nextWorktrees[0] ?? null
    const nextProject = {
      ...project,
      rootWorktreeId: nextPrimaryWorktree?.id ?? project.rootWorktreeId,
      selectedWorktreeId:
        project.selectedWorktreeId === worktreeId
          ? nextPrimaryWorktree?.id ?? nextWorktrees[0]?.id ?? null
          : project.selectedWorktreeId,
      hiddenWorktreePaths: removingVisibleRootWorktree
        ? Array.from(new Set([...(project.hiddenWorktreePaths ?? []), worktree.path]))
        : project.hiddenWorktreePaths ?? [],
      worktrees: sortWorktrees(nextWorktrees),
    }
    const nextProjects = replaceProject(get().projects, nextProject)

    await persistProjects(nextProjects, get().selectedProjectId)
    set({ projects: nextProjects })
  },

  updateProject: async (id, updates) => {
    const nextProjects = get().projects.map((project) =>
      project.id === id
        ? {
            ...project,
            ...updates,
            name: updates.name?.trim() ? updates.name.trim() : project.name,
            iconPath: Object.prototype.hasOwnProperty.call(updates, "iconPath")
              ? normalizeProjectIconPath(updates.iconPath)
              : project.iconPath ?? null,
          }
        : project
    )

    await persistProjects(nextProjects, get().selectedProjectId)
    set({ projects: nextProjects })
  },

  setTargetBranch: async (projectId, branchName) => {
    const nextProjects = get().projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            targetBranch: branchName?.trim() || null,
          }
        : project
    )

    await persistProjects(nextProjects, get().selectedProjectId)
    set({ projects: nextProjects })
  },

  addProjectAction: async (projectId, action) => {
    const nextAction: ProjectAction = {
      ...action,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      name: action.name.trim(),
      iconName: normalizeProjectActionIconName(action.iconName),
      iconPath: normalizeProjectIconPath(action.iconPath),
      hotkey: action.hotkey ?? null,
      command: action.command.trim(),
    }

    let created = false
    const nextProjects = get().projects.map((project) => {
      if (project.id !== projectId) {
        return project
      }

      created = true
      return {
        ...project,
        actions: [...(project.actions ?? []), nextAction],
        primaryActionId: nextAction.id,
      }
    })

    if (!created) {
      throw new Error(`Unknown project: ${projectId}`)
    }

    await persistProjects(nextProjects, get().selectedProjectId)
    set({ projects: nextProjects })
    return nextAction
  },

  updateProjectAction: async (projectId, actionId, updates) => {
    let updatedAction: ProjectAction | null = null
    const nextProjects = get().projects.map((project) => {
      if (project.id !== projectId) {
        return project
      }

      return {
        ...project,
        actions: (project.actions ?? []).map((action) => {
          if (action.id !== actionId) {
            return action
          }

          updatedAction = {
            ...action,
            name: updates.name.trim(),
            iconName: normalizeProjectActionIconName(updates.iconName),
            iconPath: normalizeProjectIconPath(updates.iconPath),
            hotkey: updates.hotkey ?? null,
            command: updates.command.trim(),
          }

          return updatedAction
        }),
      }
    })

    if (!updatedAction) {
      throw new Error(`Unknown project action: ${projectId}/${actionId}`)
    }

    await persistProjects(nextProjects, get().selectedProjectId)
    set({ projects: nextProjects })
    return updatedAction
  },

  deleteProjectAction: async (projectId, actionId) => {
    let didDelete = false
    const nextProjects = get().projects.map((project) => {
      if (project.id !== projectId) {
        return project
      }

      const nextActions = (project.actions ?? []).filter((action) => action.id !== actionId)
      didDelete = nextActions.length !== (project.actions ?? []).length

      return {
        ...project,
        actions: nextActions,
        primaryActionId:
          project.primaryActionId === actionId
            ? nextActions[0]?.id ?? null
            : project.primaryActionId,
      }
    })

    if (!didDelete) {
      throw new Error(`Unknown project action: ${projectId}/${actionId}`)
    }

    await persistProjects(nextProjects, get().selectedProjectId)
    set({ projects: nextProjects })
  },

  setPrimaryAction: async (projectId, actionId) => {
    const nextProjects = get().projects.map((project) => {
      if (project.id !== projectId || !(project.actions ?? []).some((action) => action.id === actionId)) {
        return project
      }

      return {
        ...project,
        primaryActionId: actionId,
      }
    })

    await persistProjects(nextProjects, get().selectedProjectId)
    set({ projects: nextProjects })
  },

  setDefaultLocation: async (path) => {
    const store = await getStore()
    await store.set(DEFAULT_LOCATION_KEY, path)
    await store.save()
    set({ defaultLocation: path })
  },
}))
