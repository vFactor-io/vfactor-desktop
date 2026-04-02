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
  buildManagedWorktreePath,
  createWorkspaceDisplayName,
  getActiveWorktree,
  generateManagedWorktreeIdentity,
  getWorkspaceSlugFromBranchName,
  isWorktreeReady,
  normalizeProjectWorkspacesPath,
  resolveRepoRootPath,
} from "../utils/worktrees"

const STORE_FILE = "projects.json"
const STORE_KEY = "projects"
const DEFAULT_LOCATION_KEY = "defaultLocation"
const SELECTED_PROJECT_KEY = "selectedProjectId"
const ACTIVE_WORKTREE_KEY = "activeWorktreeId"

type LegacyProject = Partial<Project> & {
  id: string
  name: string
  path: string
  addedAt?: number
}

interface ProjectState {
  projects: Project[]
  focusedProjectId: string | null
  activeWorktreeId: string | null
  defaultLocation: string
  isLoading: boolean
  loadProjects: () => Promise<void>
  addProject: (path: string, name?: string) => Promise<void>
  removeProject: (id: string) => Promise<void>
  setProjectOrder: (projects: Project[]) => Promise<void>
  selectProject: (id: string) => Promise<void>
  selectWorktree: (projectId: string, worktreeId: string) => Promise<void>
  createWorktree: (projectId: string) => Promise<ProjectWorktree>
  renameWorktreeFromIntent: (
    projectId: string,
    worktreeId: string,
    updates: { branchName: string; name?: string | null }
  ) => Promise<ProjectWorktree>
  removeWorktree: (projectId: string, worktreeId: string) => Promise<void>
  updateProject: (
    id: string,
    updates: Partial<Pick<Project, "name" | "iconPath" | "workspacesPath" | "remoteName" | "setupScript">>
  ) => Promise<void>
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
    intentStatus: worktree.intentStatus ?? "configured",
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

function appendBranchCollisionSuffix(branchName: string, collisionIndex: number): string {
  if (collisionIndex <= 1) {
    return branchName.trim()
  }

  const segments = branchName
    .trim()
    .split("/")
    .filter(Boolean)
  const leaf = segments.pop() ?? branchName.trim()

  return [...segments, `${leaf}-${collisionIndex}`].join("/")
}

function resolveManagedRenameTarget(params: {
  project: Pick<Project, "id" | "repoRootPath" | "workspacesPath" | "worktrees" | "hiddenWorktreePaths">
  currentWorktreeId: string
  branchName: string
  preferredName?: string | null
}): { branchName: string; path: string; name: string; collisionIndex: number } {
  const baseSlug = getWorkspaceSlugFromBranchName(params.branchName)
  const baseName =
    params.preferredName?.trim() || createWorkspaceDisplayName(baseSlug)
  const reservedPaths = new Set(
    [
      ...params.project.worktrees
        .filter((worktree) => worktree.id !== params.currentWorktreeId)
        .map((worktree) => normalizeComparablePath(worktree.path)),
      ...(params.project.hiddenWorktreePaths ?? []).map((worktreePath) =>
        normalizeComparablePath(worktreePath)
      ),
    ].filter(Boolean)
  )

  let collisionIndex = 1
  let candidateSlug = baseSlug
  let candidatePath = buildManagedWorktreePath(params.project, candidateSlug)

  while (reservedPaths.has(normalizeComparablePath(candidatePath))) {
    collisionIndex += 1
    candidateSlug = `${baseSlug}-${collisionIndex}`
    candidatePath = buildManagedWorktreePath(params.project, candidateSlug)
  }

  return {
    branchName: appendBranchCollisionSuffix(params.branchName, collisionIndex),
    path: candidatePath,
    name: collisionIndex > 1 ? `${baseName} ${collisionIndex}` : baseName,
    collisionIndex,
  }
}

function normalizeProjectRemoteName(remoteName: string | null | undefined): string | null {
  const normalized = remoteName?.trim()
  return normalized || null
}

export function normalizeProjectSetupScript(setupScript: string | null | undefined): string | null {
  const normalized = setupScript?.trim()
  return normalized || null
}

function hydrateProjectActions(
  project: LegacyProject
): Pick<
  Project,
  "actions" | "primaryActionId" | "iconPath" | "workspacesPath" | "remoteName" | "setupScript"
> {
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
    workspacesPath: normalizeProjectWorkspacesPath(project.workspacesPath),
    remoteName: normalizeProjectRemoteName(project.remoteName),
    setupScript: normalizeProjectSetupScript(project.setupScript),
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
  const { iconPath, actions, primaryActionId, workspacesPath, remoteName, setupScript } =
    hydrateProjectActions(project)
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
  const rootWorktreeIdCandidate = project.rootWorktreeId ?? existingRoot?.id ?? crypto.randomUUID()
  const rootWorktree = normalizeWorktree(existingRoot ?? {}, {
    id: rootWorktreeIdCandidate,
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
  const fallbackRootWorktree =
    normalizedWorktrees.find((worktree) => worktree.id === project.rootWorktreeId) ??
    matchingProjectPathWorktree ??
    normalizedWorktrees.find((worktree) => worktree.source === "root") ??
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
    workspacesPath,
    rootWorktreeId: fallbackRootWorktree?.id ?? null,
    selectedWorktreeId,
    targetBranch:
      project.targetBranch?.trim() ||
      branchData?.defaultBranch?.trim() ||
      rootWorktree.branchName ||
      null,
    remoteName,
    setupScript,
    hiddenWorktreePaths,
    worktrees: normalizedWorktrees,
    addedAt: project.addedAt ?? now,
    actions,
    primaryActionId,
  }
}

function resolveFocusedProjectState(
  projects: Project[],
  focusedProjectId: string | null,
  activeWorktreeId: string | null
): { focusedProjectId: string | null; activeWorktreeId: string | null } {
  const focusedProject =
    (focusedProjectId ? projects.find((project) => project.id === focusedProjectId) : null) ??
    projects[0] ??
    null

  if (!focusedProject) {
    return {
      focusedProjectId: null,
      activeWorktreeId: null,
    }
  }

  return {
    focusedProjectId: focusedProject.id,
    activeWorktreeId: getActiveWorktree(focusedProject, activeWorktreeId)?.id ?? null,
  }
}

function resolveFocusedProjectId(
  projects: Project[],
  focusedProjectId: string | null
): string | null {
  return (
    (focusedProjectId ? projects.find((project) => project.id === focusedProjectId) : null) ??
    projects[0] ??
    null
  )?.id ?? null
}

async function persistSelection(
  focusedProjectId: string | null,
  _activeWorktreeId: string | null
): Promise<void> {
  const store = await getStore()
  await store.set(SELECTED_PROJECT_KEY, focusedProjectId)
  // Keep the active worktree session-scoped so the app always reopens in the empty state.
  await store.set(ACTIVE_WORKTREE_KEY, null)
  await store.save()
}

async function persistProjects(
  projects: Project[],
  focusedProjectId: string | null,
  _activeWorktreeId: string | null
): Promise<void> {
  const store = await getStore()
  await store.set(STORE_KEY, projects)
  await store.set(SELECTED_PROJECT_KEY, focusedProjectId)
  await store.set(ACTIVE_WORKTREE_KEY, null)
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
  focusedProjectId: null,
  activeWorktreeId: null,
  defaultLocation: "",
  isLoading: true,

  loadProjects: async () => {
    try {
      const store = await getStore()
      const persisted = await store.get<LegacyProject[]>(STORE_KEY)
      const savedLocation = await store.get<string>(DEFAULT_LOCATION_KEY)
      const savedFocusedId = await store.get<string>(SELECTED_PROJECT_KEY)

      let defaultLoc = savedLocation || ""
      if (!defaultLoc) {
        try {
          defaultLoc = await desktop.fs.homeDir()
        } catch {
          defaultLoc = ""
        }
      }

      if (!persisted || !Array.isArray(persisted)) {
        set({
          projects: [],
          focusedProjectId: null,
          activeWorktreeId: null,
          defaultLocation: defaultLoc,
          isLoading: false,
        })
        return
      }

      const projects = await Promise.all(persisted.map((project) => hydrateProject(project)))
      const focusedProjectId = resolveFocusedProjectId(projects, savedFocusedId ?? null)

      await persistProjects(projects, focusedProjectId, null)

      set({
        projects,
        focusedProjectId,
        activeWorktreeId: null,
        defaultLocation: defaultLoc,
        isLoading: false,
      })
    } catch (error) {
      console.error("Failed to load projects:", error)
      set({
        projects: [],
        focusedProjectId: null,
        activeWorktreeId: null,
        defaultLocation: "",
        isLoading: false,
      })
    }
  },

  addProject: async (path, name) => {
    const { projects } = get()

    if (projects.some((project) => project.path === path)) {
      return
    }

    const newProject = await createNewProject(path, name)
    const nextProjects = [newProject, ...projects]
    const nextActiveWorktreeId = getActiveWorktree(newProject, null)?.id ?? null

    await persistProjects(nextProjects, newProject.id, nextActiveWorktreeId)
    set({
      projects: nextProjects,
      focusedProjectId: newProject.id,
      activeWorktreeId: nextActiveWorktreeId,
    })
  },

  removeProject: async (id) => {
    const { projects, focusedProjectId, activeWorktreeId } = get()
    const nextProjects = projects.filter((project) => project.id !== id)
    const selection = resolveFocusedProjectState(
      nextProjects,
      focusedProjectId === id ? null : focusedProjectId,
      focusedProjectId === id ? null : activeWorktreeId
    )

    await persistProjects(nextProjects, selection.focusedProjectId, selection.activeWorktreeId)
    set({
      projects: nextProjects,
      focusedProjectId: selection.focusedProjectId,
      activeWorktreeId: selection.activeWorktreeId,
    })
  },

  setProjectOrder: async (projects) => {
    const previousProjects = get().projects
    set({ projects })

    try {
      await persistProjects(projects, get().focusedProjectId, get().activeWorktreeId)
    } catch (error) {
      console.error("Failed to persist project order:", error)
      set({ projects: previousProjects })
      throw error
    }
  },

  selectProject: async (id) => {
    const project = get().projects.find((candidate) => candidate.id === id) ?? null
    if (!project) {
      return
    }

    const nextActiveWorktreeId = getActiveWorktree(project, null)?.id ?? null
    set({
      focusedProjectId: id,
      activeWorktreeId: nextActiveWorktreeId,
    })

    try {
      await persistSelection(id, nextActiveWorktreeId)
    } catch (error) {
      console.error("Failed to persist focused project:", error)
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

    await persistProjects(nextProjects, projectId, worktreeId)
    set({
      projects: nextProjects,
      focusedProjectId: projectId,
      activeWorktreeId: worktreeId,
    })
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
      intentStatus: "pending",
    }

    const provisionalProject = {
      ...project,
      selectedWorktreeId: project.selectedWorktreeId,
      worktrees: sortWorktrees([...project.worktrees, creatingWorktree]),
    }
    const provisionalProjects = replaceProject(get().projects, provisionalProject)
    set({
      projects: provisionalProjects,
      focusedProjectId: project.id,
    })

    try {
      const baseBranch =
        project.targetBranch?.trim() || getActiveWorktree(project, null)?.branchName
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
        rootWorktreeId: latestProject.rootWorktreeId ?? creatingWorktree.id,
        selectedWorktreeId: creatingWorktree.id,
        worktrees: sortWorktrees(
          latestProject.worktrees.map((worktree) =>
            worktree.id === creatingWorktree.id ? readyWorktree : worktree
          )
        ),
      }
      const readyProjects = replaceProject(get().projects, readyProject)
      await persistProjects(readyProjects, project.id, readyWorktree.id)
      set({
        projects: readyProjects,
        focusedProjectId: project.id,
        activeWorktreeId: readyWorktree.id,
      })
      return readyWorktree
    } catch (error) {
      const latestProject =
        get().projects.find((candidate) => candidate.id === project.id) ?? provisionalProject
      const failedProject = {
        ...latestProject,
        worktrees: sortWorktrees(
          latestProject.worktrees.filter((worktree) => worktree.id !== creatingWorktree.id)
        ),
      }
      const failedProjects = replaceProject(get().projects, failedProject)
      const selection = resolveFocusedProjectState(
        failedProjects,
        get().focusedProjectId,
        get().activeWorktreeId
      )
      await persistProjects(failedProjects, selection.focusedProjectId, selection.activeWorktreeId)
      set({
        projects: failedProjects,
        focusedProjectId: selection.focusedProjectId,
        activeWorktreeId: selection.activeWorktreeId,
      })
      throw error
    }
  },

  renameWorktreeFromIntent: async (projectId, worktreeId, updates) => {
    const project = get().projects.find((candidate) => candidate.id === projectId)
    const worktree = project?.worktrees.find((candidate) => candidate.id === worktreeId) ?? null

    if (!project || !worktree) {
      throw new Error(`Unknown worktree: ${projectId}/${worktreeId}`)
    }

    if (worktree.source !== "managed") {
      throw new Error("Only managed worktrees can be renamed from intent.")
    }

    if (!isWorktreeReady(worktree)) {
      throw new Error("Only ready worktrees can be renamed from intent.")
    }

    const requestedBranchName = updates.branchName.trim()
    if (!requestedBranchName) {
      throw new Error("A branch name is required to configure the workspace.")
    }

    const renameTarget = resolveManagedRenameTarget({
      project,
      currentWorktreeId: worktreeId,
      branchName: requestedBranchName,
      preferredName: updates.name,
    })
    const nextBranchName = renameTarget.branchName
    const nextName = renameTarget.name
    const nextPath = renameTarget.path
    const shouldRenameGit = nextBranchName !== worktree.branchName || nextPath !== worktree.path

    const renamedWorktree = shouldRenameGit
      ? await desktop.git.renameWorktree(project.repoRootPath, {
          worktreePath: worktree.path,
          branchName: nextBranchName,
          targetPath: nextPath,
        })
      : {
          worktree: {
            path: worktree.path,
            branchName: worktree.branchName,
            head: null,
            isDetached: false,
            isCurrent: false,
            isMain: false,
          },
        }

    const nextProject = {
      ...project,
      worktrees: sortWorktrees(
        project.worktrees.map((candidate) =>
          candidate.id === worktreeId
            ? {
                ...candidate,
                name: nextName,
                branchName: renamedWorktree.worktree.branchName,
                path: renamedWorktree.worktree.path,
                updatedAt: Date.now(),
                intentStatus: "configured" as const,
              }
            : candidate
        )
      ),
    }
    const nextProjects = replaceProject(get().projects, nextProject)
    await persistProjects(nextProjects, get().focusedProjectId, get().activeWorktreeId)
    set({ projects: nextProjects })

    return nextProject.worktrees.find((candidate) => candidate.id === worktreeId) ?? worktree
  },

  removeWorktree: async (projectId, worktreeId) => {
    const project = get().projects.find((candidate) => candidate.id === projectId)
    const worktree = project?.worktrees.find((candidate) => candidate.id === worktreeId) ?? null

    if (!project || !worktree) {
      throw new Error(`Unknown worktree: ${projectId}/${worktreeId}`)
    }

    const nextWorktrees = project.worktrees.filter((candidate) => candidate.id !== worktreeId)
    const removingPrimaryWorktree = project.rootWorktreeId === worktreeId
    const nextHiddenWorktreePaths = Array.from(
      new Set([...(project.hiddenWorktreePaths ?? []), worktree.path])
    )

    if (nextWorktrees.length === 0) {
      const nextProject = {
        ...project,
        rootWorktreeId: null,
        selectedWorktreeId: null,
        hiddenWorktreePaths: nextHiddenWorktreePaths,
        worktrees: [],
      }
      const nextProjects = replaceProject(get().projects, nextProject)
      const selection = resolveFocusedProjectState(
        nextProjects,
        get().focusedProjectId === projectId ? projectId : get().focusedProjectId,
        get().activeWorktreeId === worktreeId ? null : get().activeWorktreeId
      )

      await persistProjects(nextProjects, selection.focusedProjectId, selection.activeWorktreeId)
      set({
        projects: nextProjects,
        focusedProjectId: selection.focusedProjectId,
        activeWorktreeId: selection.activeWorktreeId,
      })
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
      hiddenWorktreePaths: nextHiddenWorktreePaths,
      worktrees: sortWorktrees(nextWorktrees),
    }
    const nextProjects = replaceProject(get().projects, nextProject)
    const selection = resolveFocusedProjectState(
      nextProjects,
      get().focusedProjectId,
      get().activeWorktreeId === worktreeId ? null : get().activeWorktreeId
    )

    await persistProjects(nextProjects, selection.focusedProjectId, selection.activeWorktreeId)
    set({
      projects: nextProjects,
      focusedProjectId: selection.focusedProjectId,
      activeWorktreeId: selection.activeWorktreeId,
    })
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
            workspacesPath: Object.prototype.hasOwnProperty.call(updates, "workspacesPath")
              ? normalizeProjectWorkspacesPath(updates.workspacesPath)
              : project.workspacesPath ?? null,
            remoteName: Object.prototype.hasOwnProperty.call(updates, "remoteName")
              ? normalizeProjectRemoteName(updates.remoteName)
              : project.remoteName ?? null,
            setupScript: Object.prototype.hasOwnProperty.call(updates, "setupScript")
              ? normalizeProjectSetupScript(updates.setupScript)
              : project.setupScript ?? null,
          }
        : project
    )

    await persistProjects(nextProjects, get().focusedProjectId, get().activeWorktreeId)
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

    await persistProjects(nextProjects, get().focusedProjectId, get().activeWorktreeId)
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

    await persistProjects(nextProjects, get().focusedProjectId, get().activeWorktreeId)
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

    await persistProjects(nextProjects, get().focusedProjectId, get().activeWorktreeId)
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

    await persistProjects(nextProjects, get().focusedProjectId, get().activeWorktreeId)
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

    await persistProjects(nextProjects, get().focusedProjectId, get().activeWorktreeId)
    set({ projects: nextProjects })
  },

  setDefaultLocation: async (path) => {
    const store = await getStore()
    await store.set(DEFAULT_LOCATION_KEY, path)
    await store.save()
    set({ defaultLocation: path })
  },
}))
