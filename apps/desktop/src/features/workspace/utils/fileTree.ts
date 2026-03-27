import type { FileTreeItem } from "@/features/version-control/types"
import {
  readProjectSubtree,
  shouldIgnoreFileSystemEntry,
} from "@/features/workspace/utils/fileSystem"
import type { ProjectFileSystemEvent } from "@/features/workspace/utils/projectWatcher"

type FileTreeRecord = Record<string, FileTreeItem>

function getRelativeSegments(rootPath: string, path: string): string[] | null {
  const normalizedRoot = rootPath.replace(/\/+$/, "")
  const normalizedPath = path.replace(/\/+$/, "")

  if (normalizedPath === normalizedRoot) {
    return []
  }

  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return null
  }

  return normalizedPath.slice(normalizedRoot.length + 1).split("/").filter(Boolean)
}

function getParentId(rootPath: string, path: string): string | null {
  const segments = getRelativeSegments(rootPath, path)
  if (!segments || segments.length === 0) {
    return null
  }

  if (segments.length === 1) {
    return "root"
  }

  return `${rootPath}/${segments.slice(0, -1).join("/")}`
}

function sortChildIds(tree: FileTreeRecord, children: string[]): string[] {
  return [...children].sort((leftId, rightId) => {
    const left = tree[leftId]
    const right = tree[rightId]

    const leftIsDirectory = left?.isDirectory ?? false
    const rightIsDirectory = right?.isDirectory ?? false

    if (leftIsDirectory && !rightIsDirectory) return -1
    if (!leftIsDirectory && rightIsDirectory) return 1

    return (left?.name ?? leftId).localeCompare(right?.name ?? rightId)
  })
}

function upsertChild(tree: FileTreeRecord, parentId: string, childId: string): void {
  const parent = tree[parentId]
  if (!parent) {
    return
  }

  const existingChildren = parent.children ?? []
  const nextChildren = existingChildren.includes(childId)
    ? existingChildren
    : [...existingChildren, childId]

  tree[parentId] = {
    ...parent,
    isDirectory: true,
    children: sortChildIds(tree, nextChildren),
  }
}

function ensureParentChain(tree: FileTreeRecord, rootPath: string, path: string): string | null {
  const segments = getRelativeSegments(rootPath, path)
  if (!segments || segments.length === 0) {
    return null
  }

  let parentId = "root"
  let currentPath = rootPath

  for (const segment of segments.slice(0, -1)) {
    if (shouldIgnoreFileSystemEntry(segment)) {
      return null
    }

    currentPath = `${currentPath}/${segment}`

    if (!tree[currentPath]) {
      tree[currentPath] = {
        name: segment,
        isDirectory: true,
        children: [],
      }
      upsertChild(tree, parentId, currentPath)
    }

    parentId = currentPath
  }

  return parentId
}

export function removeFileTreeEntry(
  tree: FileTreeRecord,
  rootPath: string,
  path: string
): FileTreeRecord {
  const nextTree: FileTreeRecord = { ...tree }
  const idsToDelete = new Set(
    Object.keys(nextTree).filter((candidate) => candidate === path || candidate.startsWith(`${path}/`))
  )

  if (idsToDelete.size === 0) {
    return tree
  }

  for (const id of idsToDelete) {
    delete nextTree[id]
  }

  const parentId = getParentId(rootPath, path)
  if (parentId && nextTree[parentId]) {
    nextTree[parentId] = {
      ...nextTree[parentId],
      children: sortChildIds(
        nextTree,
        (nextTree[parentId].children ?? []).filter((childId) => !idsToDelete.has(childId))
      ),
    }
  }

  return nextTree
}

export async function addFileTreeEntry(
  tree: FileTreeRecord,
  rootPath: string,
  path: string,
  isDirectory: boolean
): Promise<FileTreeRecord | null> {
  const segments = getRelativeSegments(rootPath, path)
  if (!segments || segments.length === 0) {
    return tree
  }

  const entryName = segments[segments.length - 1]
  if (shouldIgnoreFileSystemEntry(entryName)) {
    return tree
  }

  const nextTree: FileTreeRecord = { ...tree }
  const parentId = ensureParentChain(nextTree, rootPath, path)
  if (!parentId || !nextTree[parentId]) {
    return null
  }

  if (isDirectory) {
    const subtree = await readProjectSubtree(path)
    Object.assign(nextTree, subtree)
  } else {
    nextTree[path] = {
      name: entryName,
      isDirectory: false,
    }
  }

  upsertChild(nextTree, parentId, path)
  return nextTree
}

export async function applyProjectFileSystemEvent(
  tree: FileTreeRecord,
  rootPath: string,
  event: ProjectFileSystemEvent
): Promise<FileTreeRecord | null> {
  if (event.requiresRescan || event.kind === "rescan") {
    return null
  }

  switch (event.kind) {
    case "add":
      return addFileTreeEntry(tree, rootPath, event.path, event.isDirectory)
    case "modify":
      return tree
    case "unlink":
      return removeFileTreeEntry(tree, rootPath, event.path)
    case "rename": {
      const withoutOldPath = event.oldPath
        ? removeFileTreeEntry(tree, rootPath, event.oldPath)
        : tree
      return addFileTreeEntry(withoutOldPath, rootPath, event.path, event.isDirectory)
    }
  }
}
