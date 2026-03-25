import { desktop } from "@/desktop/client"
import type { FileTreeItem } from "@/features/version-control/types"

/**
 * Directories to skip when reading project files.
 * These are typically hidden, cache, or build directories that:
 * - Users don't need to see
 * - May have permission issues
 * - Can be very large and slow down the tree
 */
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  ".ruff_cache",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  ".venv",
  "venv",
  ".env",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  ".nyc_output",
  "target", // Rust
  ".cargo",
])

/**
 * Check if a file/directory should be ignored.
 */
export function shouldIgnoreFileSystemEntry(name: string): boolean {
  // Ignore entries in the ignore list
  if (IGNORED_DIRECTORIES.has(name)) {
    return true
  }
  // Ignore hidden files/folders starting with . (except common config files)
  if (name.startsWith(".") && !isCommonConfigFile(name)) {
    return true
  }
  return false
}

/**
 * Common config files that start with . but should be visible.
 */
function isCommonConfigFile(name: string): boolean {
  const commonConfigs = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".gitignore",
    ".dockerignore",
    ".editorconfig",
    ".prettierrc",
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.json",
    ".babelrc",
    ".npmrc",
    ".nvmrc",
    ".python-version",
    ".ruby-version",
    ".tool-versions",
  ]
  return commonConfigs.includes(name) || name.startsWith(".env")
}

/**
 * Reads a project directory and returns data in FileTreeViewer format.
 * The format is a flat record where keys are unique IDs and values contain
 * the item name and optional children IDs.
 */
export async function readProjectFiles(
  projectPath: string
): Promise<Record<string, FileTreeItem>> {
  const result: Record<string, FileTreeItem> = {
    root: {
      name: projectPath.split("/").pop() || "root",
      isDirectory: true,
      children: [],
    },
  }

  async function processDirectory(dirPath: string, parentId: string) {
    let entries
    try {
      entries = await desktop.fs.readDir(dirPath)
    } catch (error) {
      // Silently skip directories we can't read (permissions, etc.)
      // This prevents one bad directory from breaking the whole tree
      console.warn(`Skipping unreadable directory ${dirPath}`)
      return
    }

    // Filter out ignored entries, then sort: directories first, then files, alphabetically
    const filtered = entries.filter((e) => !shouldIgnoreFileSystemEntry(e.name))
    const sorted = filtered.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

    const childIds: string[] = []

    for (const entry of sorted) {
      // Create unique ID using full path
      const entryPath = `${dirPath}/${entry.name}`
      const id = entryPath

      childIds.push(id)

      if (entry.isDirectory) {
        // Process directory recursively
        result[id] = {
          name: entry.name,
          isDirectory: true,
          children: [], // Will be populated by recursive call
        }
        await processDirectory(entryPath, id)
      } else {
        // File entry (no children)
        result[id] = {
          name: entry.name,
          isDirectory: false,
        }
      }
    }

    // Update parent's children if it exists
    if (result[parentId]) {
      result[parentId].children = childIds
    }
  }

  await processDirectory(projectPath, "root")

  return result
}

export async function readProjectSubtree(
  entryPath: string
): Promise<Record<string, FileTreeItem>> {
  const result: Record<string, FileTreeItem> = {
    [entryPath]: {
      name: entryPath.split("/").pop() || entryPath,
      isDirectory: true,
      children: [],
    },
  }

  async function processDirectory(dirPath: string, parentId: string) {
    let entries
    try {
      entries = await desktop.fs.readDir(dirPath)
    } catch (error) {
      console.warn(`Skipping unreadable directory ${dirPath}`)
      return
    }

    const filtered = entries.filter((entry) => !shouldIgnoreFileSystemEntry(entry.name))
    const sorted = filtered.sort((left, right) => {
      if (left.isDirectory && !right.isDirectory) return -1
      if (!left.isDirectory && right.isDirectory) return 1
      return left.name.localeCompare(right.name)
    })

    const childIds: string[] = []

    for (const entry of sorted) {
      const childPath = `${dirPath}/${entry.name}`
      childIds.push(childPath)

      if (entry.isDirectory) {
        result[childPath] = {
          name: entry.name,
          isDirectory: true,
          children: [],
        }
        await processDirectory(childPath, childPath)
      } else {
        result[childPath] = {
          name: entry.name,
          isDirectory: false,
        }
      }
    }

    if (result[parentId]) {
      result[parentId].children = childIds
    }
  }

  await processDirectory(entryPath, entryPath)

  return result
}
