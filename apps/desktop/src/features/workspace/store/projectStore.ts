import { create } from "zustand"
import {
  desktop,
  loadDesktopStore,
  type DesktopStoreHandle,
  type GitBranchesResponse,
  type GitWorktreeSummary,
} from "@/desktop/client"
import { useTabStore } from "@/features/editor/store/tabStore"
import type { Project, ProjectAction, ProjectWorktree } from "../types"
import { findProjectFaviconPath, normalizeProjectIconPath } from "../utils/projectIcon"
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
  newWorkspaceSetupProjectId: string | null
  defaultLocation: string
  isLoading: boolean
  loadProjects: () => Promise<void>
  addProject: (path: string, name?: string) => Promise<void>
  removeProject: (id: string) => Promise<void>
  setProjectOrder: (projects: Project[]) => Promise<void>
  selectProject: (id: string) => Promise<void>
  selectWorktree: (projectId: string, worktreeId: string) => Promise<void>
  startNewWorkspaceSetup: (projectId: string) => void
  cancelNewWorkspaceSetup: () => void
  createWorktree: (projectId: string) => Promise<ProjectWorktree>
  createWorktreeFromIntent: (
    projectId: string,
    updates: { branchName: string; name?: string | null },
    options?: { activateOnSuccess?: boolean }
  ) => Promise<ProjectWorktree>
  renameWorktreeFromIntent: (
    projectId: string,
    worktreeId: string,
    updates: { branchName: string; name?: string | null }
  ) => Promise<ProjectWorktree>
  updateWorktree: (
    projectId: string,
    worktreeId: string,
    updates: Partial<Pick<ProjectWorktree, "name">>
  ) => Promise<ProjectWorktree>
  removeWorktree: (
    projectId: string,
    worktreeId: string,
    options?: { deleteFromDisk?: boolean; clearSelection?: boolean }
  ) => Promise<void>
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
let loadProjectsPromise: Promise<void> | null = null
let projectMutationVersion = 0

function bumpProjectMutationVersion(): number {
  projectMutationVersion += 1
  return projectMutationVersion
}

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

function normalizeWorktreeStatus(status: ProjectWorktree["status"] | null | undefined): ProjectWorktree["status"] {
  if (status === "creating" || status === "error" || status === "ready") {
    return status
  }

  return "ready"
}

function normalizeWorktreeIntentStatus(
  status: ProjectWorktree["intentStatus"] | null | undefined
): ProjectWorktree["intentStatus"] {
  if (status === "pending" || status === "configured") {
    return status
  }

  return "configured"
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

function normalizeComparableBranchName(branchName: string | null | undefined): string {
  return branchName?.trim() ?? ""
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

function resolveManagedTarget(params: {
  project: Pick<Project, "id" | "repoRootPath" | "workspacesPath" | "worktrees" | "hiddenWorktreePaths">
  branchName: string
  preferredName?: string | null
  excludedWorktreeId?: string
}): { branchName: string; path: string; name: string; collisionIndex: number } {
  const baseSlug = getWorkspaceSlugFromBranchName(params.branchName)
  const baseName =
    params.preferredName?.trim() || createWorkspaceDisplayName(baseSlug)
  const relevantWorktrees = params.project.worktrees.filter(
    (worktree) => worktree.id !== params.excludedWorktreeId
  )
  const reservedPaths = new Set(
    [
      ...relevantWorktrees.map((worktree) => normalizeComparablePath(worktree.path)),
      ...(params.project.hiddenWorktreePaths ?? []).map((worktreePath) =>
        normalizeComparablePath(worktreePath)
      ),
    ].filter(Boolean)
  )
  const reservedBranchNames = new Set(
    relevantWorktrees
      .map((worktree) => normalizeComparableBranchName(worktree.branchName))
      .filter(Boolean)
  )

  let collisionIndex = 1
  while (true) {
    const candidateBranchName = appendBranchCollisionSuffix(params.branchName, collisionIndex)
    const candidateSlug = collisionIndex > 1 ? `${baseSlug}-${collisionIndex}` : baseSlug
    const candidatePath = buildManagedWorktreePath(params.project, candidateSlug)

    if (
      !reservedPaths.has(normalizeComparablePath(candidatePath)) &&
      !reservedBranchNames.has(normalizeComparableBranchName(candidateBranchName))
    ) {
      return {
        branchName: candidateBranchName,
        path: candidatePath,
        name: collisionIndex > 1 ? `${baseName} ${collisionIndex}` : baseName,
        collisionIndex,
      }
    }

    collisionIndex += 1
  }
}

function resolveManagedRenameTarget(params: {
  project: Pick<Project, "id" | "repoRootPath" | "workspacesPath" | "worktrees" | "hiddenWorktreePaths">
  currentWorktreeId: string
  branchName: string
  preferredName?: string | null
}): { branchName: string; path: string; name: string; collisionIndex: number } {
  return resolveManagedTarget({
    project: params.project,
    branchName: params.branchName,
    preferredName: params.preferredName,
    excludedWorktreeId: params.currentWorktreeId,
  })
}

function resolveManagedCreationTarget(params: {
  project: Pick<Project, "id" | "repoRootPath" | "workspacesPath" | "worktrees" | "hiddenWorktreePaths">
  branchName: string
  preferredName?: string | null
}): { branchName: string; path: string; name: string; collisionIndex: number } {
  return resolveManagedTarget(params)
}

function normalizeProjectRemoteName(remoteName: string | null | undefined): string | null {
  const normalized = remoteName?.trim()
  return normalized || null
}

export function normalizeProjectSetupScript(setupScript: string | null | undefined): string | null {
  const normalized = setupScript?.trim()
  return normalized || null
}

function restorePersistedProject(project: LegacyProject): Project {
  const now = project.addedAt ?? Date.now()
  const { iconPath, actions, primaryActionId, workspacesPath, remoteName, setupScript } =
    hydrateProjectActions(project)
  const projectPath = project.path?.trim() || ""
  const repoRootPath = project.repoRootPath?.trim() || projectPath
  const faviconPath = normalizeProjectIconPath(project.faviconPath)
  const hiddenWorktreePaths = Array.isArray(project.hiddenWorktreePaths)
    ? project.hiddenWorktreePaths.filter((candidate): candidate is string => Boolean(candidate?.trim()))
    : []
  const hiddenWorktreePathSet = new Set(hiddenWorktreePaths)
  const existingWorktrees = Array.isArray(project.worktrees) ? project.worktrees : []
  const normalizedWorktrees = existingWorktrees
    .map((worktree, index) => {
      const worktreePath = worktree.path?.trim()
      if (!worktreePath || hiddenWorktreePathSet.has(worktreePath)) {
        return null
      }

      const source =
        worktree.source === "managed" || worktree.source === "root"
          ? worktree.source
          : normalizeComparablePath(worktreePath) === normalizeComparablePath(repoRootPath)
            ? "root"
            : "managed"
      const branchName = worktree.branchName?.trim() || project.targetBranch?.trim() || "No branch"
      const name =
        worktree.name?.trim() || (source === "root" ? "Root" : branchName || "Worktree")

      return normalizeWorktree(
        {
          ...worktree,
          status: normalizeWorktreeStatus(worktree.status),
          intentStatus: normalizeWorktreeIntentStatus(worktree.intentStatus),
        },
        {
          id: worktree.id ?? crypto.randomUUID(),
          name,
          branchName,
          path: worktreePath,
          source,
          createdAt: worktree.createdAt ?? now + index,
        }
      )
    })
    .filter((worktree): worktree is ProjectWorktree => worktree != null)

  const hasVisibleRootWorktree = normalizedWorktrees.some(
    (worktree) =>
      worktree.source === "root" ||
      normalizeComparablePath(worktree.path) === normalizeComparablePath(repoRootPath)
  )

  if (repoRootPath && !hiddenWorktreePathSet.has(repoRootPath) && !hasVisibleRootWorktree) {
    normalizedWorktrees.unshift(
      normalizeWorktree(
        {
          id: project.rootWorktreeId ?? undefined,
        },
        {
          id: project.rootWorktreeId ?? crypto.randomUUID(),
          name: "Root",
          branchName: project.targetBranch?.trim() || "No branch",
          path: repoRootPath,
          source: "root",
          createdAt: now,
        }
      )
    )
  }

  const sortedWorktrees = sortWorktrees(normalizedWorktrees)
  const matchingProjectPathWorktree = sortedWorktrees.find(
    (worktree) => normalizeComparablePath(worktree.path) === normalizeComparablePath(projectPath)
  )
  const fallbackSelectedWorktree =
    matchingProjectPathWorktree ??
    sortedWorktrees.find((worktree) => worktree.id === project.rootWorktreeId) ??
    sortedWorktrees.find((worktree) => worktree.status === "ready") ??
    sortedWorktrees[0] ??
    null
  const fallbackRootWorktree =
    sortedWorktrees.find((worktree) => worktree.id === project.rootWorktreeId) ??
    matchingProjectPathWorktree ??
    sortedWorktrees.find((worktree) => worktree.source === "root") ??
    sortedWorktrees.find((worktree) => worktree.status === "ready") ??
    sortedWorktrees[0] ??
    null
  const selectedWorktreeId = sortedWorktrees.some((worktree) => worktree.id === project.selectedWorktreeId)
    ? project.selectedWorktreeId ?? fallbackSelectedWorktree?.id ?? null
    : fallbackSelectedWorktree?.id ?? null
  const rootWorktreeId = sortedWorktrees.some((worktree) => worktree.id === project.rootWorktreeId)
    ? project.rootWorktreeId ?? fallbackRootWorktree?.id ?? null
    : fallbackRootWorktree?.id ?? null

  return {
    id: project.id,
    name: project.name?.trim() || projectPath.split("/").pop() || projectPath,
    iconPath,
    faviconPath,
    path: projectPath,
    repoRootPath,
    workspacesPath,
    rootWorktreeId,
    selectedWorktreeId,
    targetBranch: project.targetBranch?.trim() || null,
    remoteName,
    setupScript,
    hiddenWorktreePaths,
    worktrees: sortedWorktrees,
    addedAt: project.addedAt ?? now,
    actions,
    primaryActionId,
  }
}

type ProjectBaseBranchResolution = {
  baseBranch: string | null
  source: "targetBranch" | "gitDefaultBranch" | "rootWorktreeBranch" | "none"
  configuredTargetBranch: string | null
  gitDefaultBranch: string | null
  rootWorktreeBranch: string | null
  rootWorktreeId: string | null
}

function normalizeTargetBranchValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === "No branch") {
    return null
  }

  return trimmed
}

async function resolveProjectBaseBranch(
  project: Pick<Project, "targetBranch" | "repoRootPath" | "rootWorktreeId" | "worktrees">
): Promise<ProjectBaseBranchResolution> {
  const configuredTargetBranch = normalizeTargetBranchValue(project.targetBranch)
  if (configuredTargetBranch) {
    return {
      baseBranch: configuredTargetBranch,
      source: "targetBranch",
      configuredTargetBranch,
      gitDefaultBranch: null,
      rootWorktreeBranch: null,
      rootWorktreeId: project.rootWorktreeId,
    }
  }

  let gitDefaultBranch: string | null = null

  try {
    const branchData = await desktop.git.getBranches(project.repoRootPath)
    if (!branchData.isGitAvailable) {
      throw new Error("Git is not installed on this machine. Install Git before creating managed workspaces.")
    }

    if (!branchData.isRepo) {
      throw new Error("Initialize Git for this project before creating managed workspaces.")
    }

    gitDefaultBranch = normalizeTargetBranchValue(branchData.defaultBranch)
    if (gitDefaultBranch) {
      return {
        baseBranch: gitDefaultBranch,
        source: "gitDefaultBranch",
        configuredTargetBranch,
        gitDefaultBranch,
        rootWorktreeBranch: null,
        rootWorktreeId: project.rootWorktreeId,
      }
    }
  } catch {
    // Fall back to local worktree metadata when git metadata is temporarily unavailable.
  }

  const rootWorktree =
    project.worktrees.find((worktree) => worktree.id === project.rootWorktreeId) ??
    project.worktrees.find((worktree) => worktree.source === "root") ??
    null
  const rootWorktreeBranch = normalizeTargetBranchValue(rootWorktree?.branchName)

  return {
    baseBranch: rootWorktreeBranch,
    source: rootWorktreeBranch ? "rootWorktreeBranch" : "none",
    configuredTargetBranch,
    gitDefaultBranch,
    rootWorktreeBranch,
    rootWorktreeId: rootWorktree?.id ?? project.rootWorktreeId,
  }
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
  const [{ branchData, worktrees: discoveredWorktrees }, faviconPath] = await Promise.all([
    getGitMetadata(project.path),
    findProjectFaviconPath(project.path),
  ])
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
    faviconPath,
    path: project.path,
    repoRootPath,
    workspacesPath,
    rootWorktreeId: fallbackRootWorktree?.id ?? null,
    selectedWorktreeId,
    targetBranch:
      normalizeTargetBranchValue(project.targetBranch) ||
      normalizeTargetBranchValue(branchData?.defaultBranch) ||
      (branchData?.isRepo ? normalizeTargetBranchValue(rootWorktree.branchName) : null) ||
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
  newWorkspaceSetupProjectId: null,
  defaultLocation: "",
  isLoading: true,

  loadProjects: async () => {
    if (loadProjectsPromise) {
      return loadProjectsPromise
    }

    loadProjectsPromise = (async () => {
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

        const restoredProjects = persisted.map((project) => restorePersistedProject(project))
        const restoredFocusedProjectId = resolveFocusedProjectId(restoredProjects, savedFocusedId ?? null)
        const refreshMutationVersion = projectMutationVersion

        set({
          projects: restoredProjects,
          focusedProjectId: restoredFocusedProjectId,
          activeWorktreeId: null,
          defaultLocation: defaultLoc,
          isLoading: false,
        })

        const refreshedProjects = await Promise.all(
          restoredProjects.map((project) => hydrateProject(project))
        )

        if (projectMutationVersion !== refreshMutationVersion) {
          return
        }

        const currentState = get()
        const focusedProjectId = resolveFocusedProjectId(refreshedProjects, currentState.focusedProjectId)
        const focusedProject =
          (focusedProjectId
            ? refreshedProjects.find((project) => project.id === focusedProjectId)
            : null) ?? null
        const activeWorktreeId =
          currentState.activeWorktreeId == null
            ? null
            : getActiveWorktree(focusedProject, currentState.activeWorktreeId)?.id ?? null

        await persistProjects(refreshedProjects, focusedProjectId, activeWorktreeId)

        set({
          projects: refreshedProjects,
          focusedProjectId,
          activeWorktreeId,
          defaultLocation: currentState.defaultLocation,
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
      } finally {
        loadProjectsPromise = null
      }
    })()

    return loadProjectsPromise
  },

  addProject: async (path, name) => {
    const { projects } = get()

    if (projects.some((project) => project.path === path)) {
      return
    }

    const newProject = await createNewProject(path, name)
    const nextProjects = [newProject, ...projects]
    const nextActiveWorktreeId = getActiveWorktree(newProject, null)?.id ?? null

    bumpProjectMutationVersion()
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

    bumpProjectMutationVersion()
    await persistProjects(nextProjects, selection.focusedProjectId, selection.activeWorktreeId)
    set({
      projects: nextProjects,
      focusedProjectId: selection.focusedProjectId,
      activeWorktreeId: selection.activeWorktreeId,
      newWorkspaceSetupProjectId:
        get().newWorkspaceSetupProjectId === id ? null : get().newWorkspaceSetupProjectId,
    })
  },

  setProjectOrder: async (projects) => {
    const previousProjects = get().projects
    set({ projects })

    try {
      bumpProjectMutationVersion()
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
    const previousState = get()
    const mutationVersion = bumpProjectMutationVersion()
    set({
      projects: nextProjects,
      focusedProjectId: projectId,
      activeWorktreeId: worktreeId,
    })

    try {
      await persistProjects(nextProjects, projectId, worktreeId)
    } catch (error) {
      if (projectMutationVersion === mutationVersion) {
        set({
          projects: previousState.projects,
          focusedProjectId: previousState.focusedProjectId,
          activeWorktreeId: previousState.activeWorktreeId,
        })
      }
      throw error
    }
  },

  startNewWorkspaceSetup: (projectId) => {
    if (!get().projects.some((candidate) => candidate.id === projectId)) {
      return
    }

    set({
      newWorkspaceSetupProjectId: projectId,
    })
  },

  cancelNewWorkspaceSetup: () => {
    set({
      newWorkspaceSetupProjectId: null,
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
      const baseBranchResolution = await resolveProjectBaseBranch(project)
      const baseBranch = baseBranchResolution.baseBranch
      console.debug("[workspace] createWorktree:base-branch", {
        projectId: project.id,
        repoRootPath: project.repoRootPath,
        requestedBranchName: identity.branchName,
        requestedWorkspaceName: identity.name,
        requestedTargetPath: identity.path,
        remoteName: project.remoteName ?? null,
        ...baseBranchResolution,
      })
      if (!baseBranch) {
        throw new Error("Choose a target branch before creating a worktree.")
      }

      console.debug("[workspace] createWorktree:request", {
        projectId: project.id,
        repoRootPath: project.repoRootPath,
        branchName: identity.branchName,
        workspaceName: identity.name,
        baseBranch,
        remoteName: project.remoteName ?? null,
        targetPath: identity.path,
      })

      const result = await desktop.git.createWorktree(project.repoRootPath, {
        name: identity.name,
        branchName: identity.branchName,
        baseBranch,
        remoteName: project.remoteName ?? null,
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
      bumpProjectMutationVersion()
      await persistProjects(readyProjects, project.id, readyWorktree.id)
      set({
        projects: readyProjects,
        focusedProjectId: project.id,
        activeWorktreeId: readyWorktree.id,
        newWorkspaceSetupProjectId:
          get().newWorkspaceSetupProjectId === project.id ? null : get().newWorkspaceSetupProjectId,
      })
      console.debug("[workspace] createWorktree:success", {
        projectId: project.id,
        requestedBranchName: identity.branchName,
        createdBranchName: readyWorktree.branchName,
        createdPath: readyWorktree.path,
        activeWorktreeId: readyWorktree.id,
      })
      return readyWorktree
    } catch (error) {
      console.error("[workspace] createWorktree:error", {
        projectId: project.id,
        repoRootPath: project.repoRootPath,
        requestedBranchName: identity.branchName,
        requestedTargetPath: identity.path,
        error,
      })
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
      bumpProjectMutationVersion()
      await persistProjects(failedProjects, selection.focusedProjectId, selection.activeWorktreeId)
      set({
        projects: failedProjects,
        focusedProjectId: selection.focusedProjectId,
        activeWorktreeId: selection.activeWorktreeId,
      })
      throw error
    }
  },

  createWorktreeFromIntent: async (projectId, updates, options) => {
    const project = get().projects.find((candidate) => candidate.id === projectId)
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`)
    }
    const activateOnSuccess = options?.activateOnSuccess ?? true

    const resolvedTarget = resolveManagedCreationTarget({
      project,
      branchName: updates.branchName,
      preferredName: updates.name,
    })
    const creatingWorktree: ProjectWorktree = {
      id: crypto.randomUUID(),
      name: resolvedTarget.name,
      branchName: resolvedTarget.branchName,
      path: resolvedTarget.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: "managed",
      status: "creating",
      intentStatus: "configured",
    }

    const provisionalProject = {
      ...project,
      worktrees: sortWorktrees([...project.worktrees, creatingWorktree]),
    }
    const provisionalProjects = replaceProject(get().projects, provisionalProject)
    set({
      projects: provisionalProjects,
      focusedProjectId: activateOnSuccess ? project.id : get().focusedProjectId,
    })

    try {
      const baseBranchResolution = await resolveProjectBaseBranch(project)
      const baseBranch = baseBranchResolution.baseBranch
      console.debug("[workspace] createWorktreeFromIntent:base-branch", {
        projectId: project.id,
        repoRootPath: project.repoRootPath,
        requestedBranchName: updates.branchName,
        resolvedBranchName: resolvedTarget.branchName,
        requestedWorkspaceName: updates.name ?? null,
        resolvedWorkspaceName: resolvedTarget.name,
        requestedTargetPath: resolvedTarget.path,
        activateOnSuccess,
        remoteName: project.remoteName ?? null,
        ...baseBranchResolution,
      })
      if (!baseBranch) {
        throw new Error("Choose a target branch before creating a worktree.")
      }

      console.debug("[workspace] createWorktreeFromIntent:request", {
        projectId: project.id,
        repoRootPath: project.repoRootPath,
        branchName: resolvedTarget.branchName,
        workspaceName: resolvedTarget.name,
        baseBranch,
        remoteName: project.remoteName ?? null,
        targetPath: resolvedTarget.path,
        activateOnSuccess,
      })

      const result = await desktop.git.createWorktree(project.repoRootPath, {
        name: resolvedTarget.name,
        branchName: resolvedTarget.branchName,
        baseBranch,
        remoteName: project.remoteName ?? null,
        targetPath: resolvedTarget.path,
      })

      const readyWorktree: ProjectWorktree = {
        ...creatingWorktree,
        name: resolvedTarget.name,
        branchName: result.worktree.branchName,
        path: result.worktree.path,
        updatedAt: Date.now(),
        status: "ready",
        intentStatus: "configured",
      }
      const latestProject =
        get().projects.find((candidate) => candidate.id === project.id) ?? provisionalProject
      const readyProject = {
        ...latestProject,
        rootWorktreeId: latestProject.rootWorktreeId ?? creatingWorktree.id,
        selectedWorktreeId: activateOnSuccess
          ? creatingWorktree.id
          : latestProject.selectedWorktreeId,
        worktrees: sortWorktrees(
          latestProject.worktrees.map((worktree) =>
            worktree.id === creatingWorktree.id ? readyWorktree : worktree
          )
        ),
      }
      const readyProjects = replaceProject(get().projects, readyProject)
      bumpProjectMutationVersion()
      await persistProjects(
        readyProjects,
        activateOnSuccess ? project.id : get().focusedProjectId,
        activateOnSuccess ? readyWorktree.id : get().activeWorktreeId
      )
      set({
        projects: readyProjects,
        focusedProjectId: activateOnSuccess ? project.id : get().focusedProjectId,
        activeWorktreeId: activateOnSuccess ? readyWorktree.id : get().activeWorktreeId,
      })
      console.debug("[workspace] createWorktreeFromIntent:success", {
        projectId: project.id,
        requestedBranchName: updates.branchName,
        createdBranchName: readyWorktree.branchName,
        createdPath: readyWorktree.path,
        activateOnSuccess,
        activeWorktreeId: activateOnSuccess ? readyWorktree.id : get().activeWorktreeId,
      })
      return readyWorktree
    } catch (error) {
      console.error("[workspace] createWorktreeFromIntent:error", {
        projectId: project.id,
        repoRootPath: project.repoRootPath,
        requestedBranchName: updates.branchName,
        requestedWorkspaceName: updates.name ?? null,
        requestedTargetPath: resolvedTarget.path,
        activateOnSuccess,
        error,
      })
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
      bumpProjectMutationVersion()
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
    bumpProjectMutationVersion()
    await persistProjects(nextProjects, get().focusedProjectId, get().activeWorktreeId)
    set({ projects: nextProjects })
    if (renamedWorktree.worktree.path !== worktree.path) {
      useTabStore.getState().rebaseWorktreeTabPaths(
        worktreeId,
        worktree.path,
        renamedWorktree.worktree.path,
      )
    }

    return nextProject.worktrees.find((candidate) => candidate.id === worktreeId) ?? worktree
  },

  removeWorktree: async (projectId, worktreeId, options) => {
    const project = get().projects.find((candidate) => candidate.id === projectId)
    const worktree = project?.worktrees.find((candidate) => candidate.id === worktreeId) ?? null

    if (!project || !worktree) {
      throw new Error(`Unknown worktree: ${projectId}/${worktreeId}`)
    }

    const shouldDeleteFromDisk = options?.deleteFromDisk === true
    const shouldClearSelection = options?.clearSelection === true
    if (shouldDeleteFromDisk) {
      if (worktree.source !== "managed") {
        throw new Error("The root workspace cannot be deleted from disk.")
      }

      await desktop.git.removeWorktree(project.repoRootPath, {
        worktreePath: worktree.path,
      })
    }

    const nextWorktrees = project.worktrees.filter((candidate) => candidate.id !== worktreeId)
    const removingPrimaryWorktree = project.rootWorktreeId === worktreeId
    const nextHiddenWorktreePaths = shouldDeleteFromDisk
      ? [...(project.hiddenWorktreePaths ?? [])]
      : Array.from(new Set([...(project.hiddenWorktreePaths ?? []), worktree.path]))

    if (nextWorktrees.length === 0) {
      const nextProject = {
        ...project,
        rootWorktreeId: null,
        selectedWorktreeId: null,
        hiddenWorktreePaths: nextHiddenWorktreePaths,
        worktrees: [],
      }
      const nextProjects = replaceProject(get().projects, nextProject)
      const selection = shouldClearSelection
        ? {
            focusedProjectId: null,
            activeWorktreeId: null,
          }
        : resolveFocusedProjectState(
            nextProjects,
            get().focusedProjectId === projectId ? projectId : get().focusedProjectId,
            get().activeWorktreeId === worktreeId ? null : get().activeWorktreeId
          )

      bumpProjectMutationVersion()
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
    const selection = shouldClearSelection
      ? {
          focusedProjectId: null,
          activeWorktreeId: null,
        }
      : resolveFocusedProjectState(
          nextProjects,
          get().focusedProjectId,
          get().activeWorktreeId === worktreeId ? null : get().activeWorktreeId
        )

    bumpProjectMutationVersion()
    await persistProjects(nextProjects, selection.focusedProjectId, selection.activeWorktreeId)
    set({
      projects: nextProjects,
      focusedProjectId: selection.focusedProjectId,
      activeWorktreeId: selection.activeWorktreeId,
    })
  },

  updateWorktree: async (projectId, worktreeId, updates) => {
    let updatedWorktree: ProjectWorktree | null = null
    const nextProjects = get().projects.map((project) => {
      if (project.id !== projectId) {
        return project
      }

      const nextWorktrees = project.worktrees.map((worktree) => {
        if (worktree.id !== worktreeId) {
          return worktree
        }

        updatedWorktree = {
          ...worktree,
          name: updates.name?.trim() ? updates.name.trim() : worktree.name,
          updatedAt: Date.now(),
        }

        return updatedWorktree
      })

      return {
        ...project,
        worktrees: nextWorktrees,
      }
    })

    if (!updatedWorktree) {
      throw new Error(`Unknown worktree: ${projectId}/${worktreeId}`)
    }

    bumpProjectMutationVersion()
    await persistProjects(nextProjects, get().focusedProjectId, get().activeWorktreeId)
    set({ projects: nextProjects })
    return updatedWorktree
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

    bumpProjectMutationVersion()
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

    bumpProjectMutationVersion()
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

    bumpProjectMutationVersion()
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

    bumpProjectMutationVersion()
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

    bumpProjectMutationVersion()
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

    bumpProjectMutationVersion()
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
