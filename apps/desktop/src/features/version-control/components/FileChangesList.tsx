import { useCallback, useMemo, useState } from "react"
import { CaretDown, CaretRight, ChevronDownIcon, Square, SquareMinus, SquarePlus, type Icon } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { FileChange, FileStatus } from "../types"

interface FileChangesListProps {
  changes: FileChange[]
  onFileClick?: (file: FileChange) => void
}

const statusIndicators: Record<FileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "U",
  renamed: "R",
  copied: "C",
  ignored: "!",
}

const statusIcons: Record<FileStatus, Icon> = {
  modified: Square,
  added: SquarePlus,
  deleted: SquareMinus,
  untracked: SquarePlus,
  renamed: Square,
  copied: SquarePlus,
  ignored: Square,
}

const iconColors: Record<FileStatus, string> = {
  modified: "text-amber-400",
  added: "text-green-500",
  deleted: "text-red-500",
  untracked: "text-zinc-500",
  renamed: "text-purple-500",
  copied: "text-green-500",
  ignored: "text-zinc-500",
}

interface DirectoryGroup {
  directory: string | null
  displayPath: string | null
  files: FileChange[]
  totalAdditions: number
  totalDeletions: number
}

function groupByDirectory(changes: FileChange[]): DirectoryGroup[] {
  const dirMap = new Map<string | null, FileChange[]>()

  for (const file of changes) {
    const lastSlash = file.path.lastIndexOf("/")
    const dir = lastSlash === -1 ? null : file.path.slice(0, lastSlash)

    if (!dirMap.has(dir)) {
      dirMap.set(dir, [])
    }
    dirMap.get(dir)!.push(file)
  }

  // Find common prefix across all directory paths to trim redundancy
  const dirs = Array.from(dirMap.keys()).filter((d): d is string => d !== null)
  let commonPrefix = ""
  if (dirs.length > 1) {
    const parts = dirs[0].split("/")
    for (let i = 0; i < parts.length; i++) {
      const candidate = parts.slice(0, i + 1).join("/")
      if (dirs.every((d) => d === candidate || d.startsWith(candidate + "/"))) {
        commonPrefix = candidate
      } else {
        break
      }
    }
  }

  // Sort directories: root-level files first, then alphabetical
  const sortedKeys = Array.from(dirMap.keys()).sort((a, b) => {
    if (a === null) return -1
    if (b === null) return 1
    return a.localeCompare(b)
  })

  return sortedKeys.map((dir) => {
    const files = dirMap.get(dir)!
    let displayPath = dir
    if (dir && commonPrefix && dir.startsWith(commonPrefix)) {
      const trimmed = dir.slice(commonPrefix.length + 1)
      displayPath = trimmed || dir
    }

    return {
      directory: dir,
      displayPath,
      files,
      totalAdditions: files.reduce((sum, f) => sum + (f.additions ?? 0), 0),
      totalDeletions: files.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
    }
  })
}

function fileName(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/")
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1)
}

export interface FileChangesHandle {
  expandAll: () => void
  collapseAll: () => void
  allExpanded: boolean
  allCollapsed: boolean
  hasGroups: boolean
}

export function useFileChangesState(changes: FileChange[]): FileChangesHandle & {
  groups: DirectoryGroup[]
  collapsedSet: ReadonlySet<string>
  toggleGroup: (key: string) => void
} {
  const groups = useMemo(() => groupByDirectory(changes), [changes])
  const collapsibleGroupKeys = useMemo(
    () => groups.filter((g) => g.displayPath !== null).map((g) => g.directory ?? "__root__"),
    [groups]
  )
  const [collapsedSet, setCollapsedSet] = useState<ReadonlySet<string>>(new Set())

  const allCollapsed = collapsibleGroupKeys.length > 0 && collapsibleGroupKeys.every((k) => collapsedSet.has(k))
  const allExpanded = collapsibleGroupKeys.length === 0 || collapsibleGroupKeys.every((k) => !collapsedSet.has(k))
  const hasGroups = groups.length > 1

  const collapseAll = useCallback(() => {
    setCollapsedSet(new Set(collapsibleGroupKeys))
  }, [collapsibleGroupKeys])

  const expandAll = useCallback(() => {
    setCollapsedSet(new Set())
  }, [])

  const toggleGroup = useCallback((key: string) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  return { groups, collapsedSet, toggleGroup, expandAll, collapseAll, allExpanded, allCollapsed, hasGroups }
}

export function FileChangesToolbar({ handle }: { handle: FileChangesHandle }) {
  if (!handle.hasGroups) {
    return null
  }

  // When all expanded (or mixed) → offer collapse. When all collapsed → offer expand.
  const willExpand = handle.allCollapsed
  const action = willExpand ? handle.expandAll : handle.collapseAll
  const label = willExpand ? "Expand all" : "Collapse all"
  const Chevron = willExpand ? CaretRight : CaretDown

  return (
    <div className="flex items-center px-2.5">
      <button
        type="button"
        onClick={action}
        title={label}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        <Chevron size={12} />
        <span>{label}</span>
      </button>
    </div>
  )
}

export function FileChangesList({
  changes,
  onFileClick,
  state,
}: FileChangesListProps & {
  state: ReturnType<typeof useFileChangesState>
}) {
  const { groups, collapsedSet, toggleGroup } = state

  if (groups.length === 1) {
    const group = groups[0]
    return (
      <div className="flex flex-col font-mono">
        {group.displayPath ? (
          <div className="mb-0.5 px-1.5 py-1 text-xs font-medium text-muted-foreground/70">
            {group.displayPath}
          </div>
        ) : null}
        {group.files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            label={fileName(file.path)}
            onFileClick={onFileClick}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5 font-mono">
      {groups.map((group) => {
        const key = group.directory ?? "__root__"
        return (
          <DirectoryGroupSection
            key={key}
            group={group}
            collapsed={collapsedSet.has(key)}
            onToggle={() => toggleGroup(key)}
            onFileClick={onFileClick}
          />
        )
      })}
    </div>
  )
}

function DirectoryGroupSection({
  group,
  collapsed,
  onToggle,
  onFileClick,
}: {
  group: DirectoryGroup
  collapsed: boolean
  onToggle: () => void
  onFileClick?: (file: FileChange) => void
}) {
  const Chevron = collapsed ? CaretRight : ChevronDownIcon

  return (
    <div>
      {group.displayPath ? (
        <button
          type="button"
          onClick={onToggle}
          className="group flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:text-foreground"
        >
          <Chevron
            size={12}
            className="shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground/80 transition-colors group-hover:text-foreground/90">
            {group.displayPath}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground/50">
            {group.files.length}
          </span>
          {group.totalAdditions > 0 && (
            <span className="shrink-0 text-xs text-green-500">
              +{group.totalAdditions}
            </span>
          )}
          {group.totalDeletions > 0 && (
            <span className="shrink-0 text-xs text-red-500">
              -{group.totalDeletions}
            </span>
          )}
        </button>
      ) : null}

      {!collapsed && (
        <div className={cn(group.displayPath ? "pl-2" : "")}>
          {group.files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              label={fileName(file.path)}
              onFileClick={onFileClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileRow({
  file,
  label,
  onFileClick,
}: {
  file: FileChange
  label: string
  onFileClick?: (file: FileChange) => void
}) {
  const StatusIcon = statusIcons[file.status]

  return (
    <button
      key={file.path}
      type="button"
      onClick={() => onFileClick?.(file)}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-1.5 py-1 text-left text-sm transition-colors",
        onFileClick
          ? "cursor-pointer hover:border-border/70 hover:bg-card"
          : "cursor-default"
      )}
    >
      <span className="min-w-0 flex-1 truncate text-foreground">
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
        <span className="shrink-0 text-xs font-medium text-foreground">
          {statusIndicators[file.status]}
        </span>
        {file.additions !== undefined && file.additions > 0 && (
          <span className="text-green-500">+{file.additions}</span>
        )}
        {file.deletions !== undefined && file.deletions > 0 && (
          <span className="text-red-500">-{file.deletions}</span>
        )}
        <StatusIcon
          size={12}
          className={cn("shrink-0", iconColors[file.status])}
        />
      </div>
    </button>
  )
}
