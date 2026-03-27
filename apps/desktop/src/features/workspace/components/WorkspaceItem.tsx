import { Archive, GitBranch, PushPin } from "@/components/icons"
import type { Workspace } from "../types"
import { formatRelativeTime } from "@/lib/utils/time"
import { cn } from "@/lib/utils"
import { LoadingDots } from "@/features/shared/components/ui/loading-dots"

interface WorkspaceItemProps {
  workspace: Workspace
  selected?: boolean
  onClick?: () => void
}

export function WorkspaceItem({ workspace, selected, onClick }: WorkspaceItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={cn(
        "group w-full text-left px-2 py-1.5 rounded-md cursor-pointer",
        selected
          ? "bg-sidebar-accent"
          : "hover:bg-sidebar-accent/50"
      )}
    >
      <div className="flex items-start gap-2">
        {workspace.isLoading ? (
          <LoadingDots className="mt-0.5 shrink-0 text-sidebar-foreground/50" />
        ) : workspace.needsAttention ? (
          <LoadingDots className="mt-0.5 shrink-0" variant="attention" />
        ) : (
          <GitBranch
            size={16}
            className="mt-0.5 shrink-0 text-sidebar-foreground/50"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm truncate">{workspace.branchName}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-sidebar-foreground/50">
            <span>{workspace.name}</span>
            <span>·</span>
            <span>{formatRelativeTime(workspace.lastActive)}</span>
          </div>
        </div>
        {/* Diff badge - hidden on hover */}
        {workspace.diffCount && (
          <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium group-hover:hidden">
            +{workspace.diffCount.toLocaleString()}
          </span>
        )}
        {/* Hover actions */}
        <div className="shrink-0 flex items-center gap-1 hidden group-hover:flex">
          <button
            type="button"
            className="p-1 rounded hover:bg-sidebar-foreground/10"
            onClick={(e) => {
              e.stopPropagation()
              // TODO: pin action
            }}
          >
            <PushPin size={14} className="text-sidebar-foreground/50" />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-sidebar-foreground/10"
            onClick={(e) => {
              e.stopPropagation()
              // TODO: archive action
            }}
          >
            <Archive size={14} className="text-sidebar-foreground/50" />
          </button>
        </div>
      </div>
    </div>
  )
}
