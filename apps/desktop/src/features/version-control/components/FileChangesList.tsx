import { Square, SquareMinus, SquarePlus, type Icon } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { FileChange, FileStatus } from "../types"

interface FileChangesListProps {
  changes: FileChange[]
  onFileClick?: (file: FileChange) => void
}

const statusColors: Record<FileStatus, string> = {
  modified: "text-foreground",
  added: "text-foreground",
  deleted: "text-foreground",
  untracked: "text-foreground",
  renamed: "text-foreground",
  copied: "text-foreground",
  ignored: "text-muted-foreground",
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

function splitFilePath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, "/")
  const lastSlashIndex = normalizedPath.lastIndexOf("/")

  if (lastSlashIndex === -1) {
    return {
      directory: null,
      name: normalizedPath,
    }
  }

  return {
    directory: normalizedPath.slice(0, lastSlashIndex),
    name: normalizedPath.slice(lastSlashIndex + 1),
  }
}

export function FileChangesList({ changes, onFileClick }: FileChangesListProps) {
  return (
    <div className="flex flex-col">
      {changes.map((file) => {
        const { directory, name } = splitFilePath(file.path)
        const StatusIcon = statusIcons[file.status]

        return (
          <button
            key={file.path}
            type="button"
            onClick={() => onFileClick?.(file)}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md border border-transparent px-1.5 py-1 text-left text-sm transition-colors",
              onFileClick
                ? "cursor-pointer hover:border-border/70 hover:bg-card"
                : "cursor-default"
            )}
          >
            <div className="flex min-w-0 flex-1 items-center">
              <div className="flex min-w-0 flex-1 items-baseline text-[13px] leading-5">
                {directory ? (
                  <span className="truncate text-muted-foreground">{directory}/</span>
                ) : null}
                <span className="truncate text-foreground">{name}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium">
              <span
                className={cn(
                  "shrink-0 text-[11px] font-medium",
                  statusColors[file.status]
                )}
              >
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
      })}
    </div>
  )
}
