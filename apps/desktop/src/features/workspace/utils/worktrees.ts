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

function getDirname(filePath: string): string {
  const normalized = filePath.replace(/\/+$/, "")
  const lastSlashIndex = normalized.lastIndexOf("/")
  return lastSlashIndex <= 0 ? "/" : normalized.slice(0, lastSlashIndex)
}

function getBasename(filePath: string): string {
  const normalized = filePath.replace(/\/+$/, "")
  const lastSlashIndex = normalized.lastIndexOf("/")
  return lastSlashIndex < 0 ? normalized : normalized.slice(lastSlashIndex + 1)
}

function normalizePath(filePath: string): string {
  const normalized = filePath.trim().replace(/\/+$/, "")
  return normalized || "/"
}

function isSamePathOrAncestor(candidatePath: string, targetPath: string): boolean {
  const normalizedCandidatePath = normalizePath(candidatePath)
  const normalizedTargetPath = normalizePath(targetPath)

  return (
    normalizedCandidatePath === normalizedTargetPath ||
    normalizedTargetPath.startsWith(`${normalizedCandidatePath}/`)
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
  return `${repoParentPath}/.nucleus-worktrees/${repoName}-${project.id}/${slug}`
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

export function generateManagedWorktreeIdentity(
  project: Pick<Project, "id" | "repoRootPath" | "worktrees">
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
    path: buildManagedWorktreePath(project, slug),
  }
}
