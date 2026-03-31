import type { GitWorktreeSummary } from "@/desktop/contracts"
import type { Project, ProjectWorktree } from "../types"

const WORKTREE_NAME_POOL = [
  "Kolkata",
  "Valencia",
  "Oslo",
  "Kyoto",
  "Lima",
  "Nairobi",
  "Lisbon",
  "Seoul",
  "Dakar",
  "Hobart",
  "Accra",
  "Bergen",
  "Cusco",
  "Naples",
  "Tbilisi",
  "Jaipur",
  "Split",
  "Recife",
  "Tallinn",
  "Oaxaca",
]

function usesWindowsSeparators(filePath: string): boolean {
  return /\\/.test(filePath) || /^[A-Za-z]:[\\/]/.test(filePath)
}

function getPathSeparator(filePath: string): "\\" | "/" {
  return usesWindowsSeparators(filePath) ? "\\" : "/"
}

function getPathRoot(filePath: string): string {
  if (usesWindowsSeparators(filePath)) {
    const driveRoot = filePath.match(/^[A-Za-z]:[\\/]/)?.[0]
    if (driveRoot) {
      return driveRoot.replace(/\//g, "\\")
    }

    if (filePath.startsWith("\\\\")) {
      return "\\\\"
    }

    if (filePath.startsWith("\\")) {
      return "\\"
    }

    return ""
  }

  return filePath.startsWith("/") ? "/" : ""
}

function trimTrailingSeparators(filePath: string): string {
  const trimmed = filePath.trim()
  if (!trimmed) {
    return trimmed
  }

  const root = getPathRoot(trimmed)
  if (root && trimmed === root) {
    return root
  }

  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/, "")
  return withoutTrailingSeparators || root || getPathSeparator(trimmed)
}

function getDirname(filePath: string): string {
  const normalized = trimTrailingSeparators(filePath)
  const root = getPathRoot(normalized)
  if (root && normalized === root) {
    return root
  }

  const lastSeparatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  if (lastSeparatorIndex < 0) {
    return "."
  }

  if (root && lastSeparatorIndex < root.length) {
    return root
  }

  return normalized.slice(0, lastSeparatorIndex)
}

function getBasename(filePath: string): string {
  const normalized = trimTrailingSeparators(filePath)
  const root = getPathRoot(normalized)
  if (root && normalized === root) {
    return root
  }

  const lastSeparatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  return lastSeparatorIndex < 0 ? normalized : normalized.slice(lastSeparatorIndex + 1)
}

function joinPaths(basePath: string, ...segments: string[]): string {
  const separator = getPathSeparator(basePath)
  const root = getPathRoot(basePath)
  let result = trimTrailingSeparators(basePath)

  for (const segment of segments) {
    const cleanedSegment = segment.replace(/^[\\/]+|[\\/]+$/g, "")
    if (!cleanedSegment) {
      continue
    }

    if (!result) {
      result = cleanedSegment
      continue
    }

    result = result === root ? `${result}${cleanedSegment}` : `${result}${separator}${cleanedSegment}`
  }

  return result
}

function normalizePath(filePath: string): string {
  const normalized = trimTrailingSeparators(filePath)
  return normalized || "/"
}

function isSamePathOrAncestor(candidatePath: string, targetPath: string): boolean {
  const normalizedCandidatePath = normalizePath(candidatePath)
  const normalizedTargetPath = normalizePath(targetPath)
  const separator =
    usesWindowsSeparators(candidatePath) || usesWindowsSeparators(targetPath) ? "\\" : "/"

  return (
    normalizedCandidatePath === normalizedTargetPath ||
    normalizedTargetPath.startsWith(`${normalizedCandidatePath}${separator}`)
  )
}

export function createSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || "worktree"
}

function createCandidateName(baseName: string, suffix: number): string {
  return suffix <= 1 ? baseName : `${baseName} ${suffix}`
}

export function buildManagedWorktreePath(project: Pick<Project, "id" | "repoRootPath">, slug: string): string {
  const repoRootPath = project.repoRootPath || ""
  const repoParentPath = getDirname(repoRootPath)
  const repoName = getBasename(repoRootPath)
  return joinPaths(repoParentPath, ".nucleus-worktrees", `${repoName}-${project.id}`, slug)
}

export function getDefaultProjectWorkspacesPath(
  project: Pick<Project, "id" | "repoRootPath">
): string {
  const repoRootPath = project.repoRootPath || ""
  const repoParentPath = getDirname(repoRootPath)
  const repoName = getBasename(repoRootPath)
  return joinPaths(repoParentPath, ".nucleus-worktrees", `${repoName}-${project.id}`)
}

export function getProjectWorkspacesPath(
  project: Pick<Project, "id" | "repoRootPath" | "workspacesPath">
): string {
  const customPath = project.workspacesPath?.trim().replace(/[\\/]+$/, "")
  return customPath || getDefaultProjectWorkspacesPath(project)
}

export function normalizeProjectWorkspacesPath(
  workspacesPath: string | null | undefined
): string | null {
  const normalized = workspacesPath?.trim().replace(/[\\/]+$/, "")
  return normalized || null
}

export function resolveRepoRootPath(
  projectPath: string,
  discoveredWorktrees: Pick<GitWorktreeSummary, "path" | "isMain">[]
): string {
  const normalizedProjectPath = normalizePath(projectPath)
  const mainWorktreePath = discoveredWorktrees.find((worktree) => worktree.isMain)?.path
  if (mainWorktreePath) {
    return normalizePath(mainWorktreePath)
  }

  const matchingAncestorPaths = discoveredWorktrees
    .map((worktree) => normalizePath(worktree.path))
    .filter((worktreePath) => isSamePathOrAncestor(worktreePath, normalizedProjectPath))
    .sort((left, right) => left.length - right.length)

  return matchingAncestorPaths[0] ?? normalizedProjectPath
}

export function isWorktreeReady(
  worktree: Pick<ProjectWorktree, "status"> | null | undefined
): worktree is Pick<ProjectWorktree, "status"> & { status: "ready" } {
  return worktree?.status === "ready"
}

export function getSelectedWorktree(
  project: Pick<Project, "selectedWorktreeId" | "rootWorktreeId" | "worktrees"> | null | undefined
): ProjectWorktree | null {
  if (!project) {
    return null
  }

  return (
    project.worktrees.find((worktree) => worktree.id === project.selectedWorktreeId) ??
    project.worktrees.find((worktree) => worktree.id === project.rootWorktreeId) ??
    project.worktrees.find((worktree) => worktree.status === "ready") ??
    project.worktrees[0] ??
    null
  )
}

export function getWorktreeById(
  project: Pick<Project, "worktrees"> | null | undefined,
  worktreeId: string | null | undefined
): ProjectWorktree | null {
  if (!project || !worktreeId) {
    return null
  }

  return project.worktrees.find((worktree) => worktree.id === worktreeId) ?? null
}

export function getActiveWorktree(
  project: Pick<Project, "selectedWorktreeId" | "rootWorktreeId" | "worktrees"> | null | undefined,
  activeWorktreeId: string | null | undefined
): ProjectWorktree | null {
  const activeWorktree = getWorktreeById(project, activeWorktreeId)
  if (isWorktreeReady(activeWorktree)) {
    return activeWorktree
  }

  const selectedWorktree = getSelectedWorktree(project)
  if (isWorktreeReady(selectedWorktree)) {
    return selectedWorktree
  }

  return project?.worktrees.find((worktree) => isWorktreeReady(worktree)) ?? null
}

export function generateManagedWorktreeIdentity(
  project: Pick<Project, "id" | "repoRootPath" | "workspacesPath" | "worktrees">
): { name: string; slug: string; branchName: string; path: string } {
  const usedNames = new Set(project.worktrees.map((worktree) => worktree.name.toLowerCase()))
  const usedSlugs = new Set(project.worktrees.map((worktree) => createSlug(worktree.branchName)))

  let baseName = WORKTREE_NAME_POOL[Math.floor(Math.random() * WORKTREE_NAME_POOL.length)] ?? "Kolkata"
  if (usedNames.has(baseName.toLowerCase())) {
    baseName = WORKTREE_NAME_POOL.find((candidate) => !usedNames.has(candidate.toLowerCase())) ?? baseName
  }

  let suffix = 1
  let name = createCandidateName(baseName, suffix)
  let slug = createSlug(name)

  while (usedNames.has(name.toLowerCase()) || usedSlugs.has(slug)) {
    suffix += 1
    name = createCandidateName(baseName, suffix)
    slug = createSlug(name)
  }

  return {
    name,
    slug,
    branchName: slug,
    path: joinPaths(getProjectWorkspacesPath(project), slug),
  }
}
