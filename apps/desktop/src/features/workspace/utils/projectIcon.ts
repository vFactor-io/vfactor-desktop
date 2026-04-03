import { desktop, type DesktopDirEntry } from "@/desktop/client"
import { shouldIgnoreFileSystemEntry } from "@/features/workspace/utils/fileSystem"

const FAVICON_FILE_PRIORITY = [
  "favicon.svg",
  "favicon.png",
  "favicon-32x32.png",
  "favicon-16x16.png",
  "apple-touch-icon.png",
  "favicon.ico",
  "icon.svg",
  "icon.png",
  "icon.ico",
] as const

const FAVICON_DIRECTORY_PRIORITY = [
  "public",
  "static",
  "www",
  "web",
  "app",
  "src",
  "apps",
  "packages",
] as const

export function normalizeProjectIconPath(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  return trimmed
}

export function projectIconPathToSrc(value: string | null | undefined): string | null {
  const normalizedPath = normalizeProjectIconPath(value)
  if (!normalizedPath) {
    return null
  }

  if (normalizedPath.startsWith("data:") || /^[a-zA-Z]+:\/\//.test(normalizedPath)) {
    return normalizedPath
  }

  const pathWithForwardSlashes = normalizedPath.replace(/\\/g, "/")
  const encodedPath = encodeURI(pathWithForwardSlashes)
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F")

  if (/^[A-Za-z]:\//.test(pathWithForwardSlashes)) {
    return `file:///${encodedPath}`
  }

  if (pathWithForwardSlashes.startsWith("//")) {
    return `file:${encodedPath}`
  }

  return `file://${encodedPath}`
}

export function resolveProjectIconPath(
  project?: { iconPath?: string | null; faviconPath?: string | null } | null
): string | null {
  return (
    normalizeProjectIconPath(project?.iconPath) ??
    normalizeProjectIconPath(project?.faviconPath) ??
    null
  )
}

function getFilePriority(fileName: string): number {
  const normalizedName = fileName.trim().toLowerCase()
  const priority = FAVICON_FILE_PRIORITY.indexOf(
    normalizedName as (typeof FAVICON_FILE_PRIORITY)[number]
  )

  return priority === -1 ? Number.POSITIVE_INFINITY : priority
}

function getDirectoryPriority(directoryName: string): number {
  const normalizedName = directoryName.trim().toLowerCase()
  const priority = FAVICON_DIRECTORY_PRIORITY.indexOf(
    normalizedName as (typeof FAVICON_DIRECTORY_PRIORITY)[number]
  )

  return priority === -1 ? Number.POSITIVE_INFINITY : priority
}

function compareDirectoryEntries(left: DesktopDirEntry, right: DesktopDirEntry): number {
  const leftPriority = getDirectoryPriority(left.name)
  const rightPriority = getDirectoryPriority(right.name)

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority
  }

  return left.name.localeCompare(right.name)
}

async function readDirectoryEntries(directoryPath: string): Promise<DesktopDirEntry[] | null> {
  try {
    return await desktop.fs.readDir(directoryPath)
  } catch {
    return null
  }
}

function getPreferredFaviconPath(entries: DesktopDirEntry[]): string | null {
  const matchingFile = entries
    .filter((entry) => entry.isFile)
    .sort((left, right) => getFilePriority(left.name) - getFilePriority(right.name))[0]

  if (matchingFile && Number.isFinite(getFilePriority(matchingFile.name))) {
    return matchingFile.path
  }

  return null
}

async function searchDirectoryForFavicon(directoryPath: string): Promise<string | null> {
  const entries = await readDirectoryEntries(directoryPath)
  if (!entries) {
    return null
  }

  return getPreferredFaviconPath(entries)
}

async function searchProjectRootForFavicon(projectPath: string): Promise<string | null> {
  const rootEntries = await readDirectoryEntries(projectPath)
  if (!rootEntries) {
    return null
  }

  const rootFaviconPath = getPreferredFaviconPath(rootEntries)
  if (rootFaviconPath) {
    return rootFaviconPath
  }

  const nextDirectories = rootEntries
    .filter((entry) => entry.isDirectory && !shouldIgnoreFileSystemEntry(entry.name))
    .sort(compareDirectoryEntries)

  for (const entry of nextDirectories) {
    if (!Number.isFinite(getDirectoryPriority(entry.name))) {
      continue
    }

    const nestedFaviconPath = await searchDirectoryForFavicon(entry.path)
    if (nestedFaviconPath) {
      return nestedFaviconPath
    }
  }

  return null
}

export async function findProjectFaviconPath(
  projectPath: string | null | undefined
): Promise<string | null> {
  const normalizedPath = projectPath?.trim()
  if (!normalizedPath) {
    return null
  }

  return searchProjectRootForFavicon(normalizedPath)
}
