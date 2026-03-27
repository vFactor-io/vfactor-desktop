import { CaretRight, CaretDown, GearSix, Plus } from "@/components/icons"
import type { Repository } from "../types"
import { WorkspaceItem } from "./WorkspaceItem"
import { cn } from "@/lib/utils"
import { getColorFromName } from "@/lib/utils/colors"

interface RepositoryGroupProps {
  repository: Repository
  onToggleCollapse: () => void
  selectedWorkspaceId?: string
  onSelectWorkspace?: (workspaceId: string) => void
}

export function RepositoryGroup({
  repository,
  onToggleCollapse,
  selectedWorkspaceId,
  onSelectWorkspace,
}: RepositoryGroupProps) {
  return (
    <div className="py-2">
      {/* Repository header */}
      <div className="group flex items-center gap-1 mx-2 px-2 py-1 rounded-md hover:bg-sidebar-accent">
        {/* Colored letter avatar */}
        <div
          className={cn(
            "size-5 rounded shrink-0 flex items-center justify-center text-xs font-semibold text-white leading-none",
            getColorFromName(repository.name)
          )}
        >
          <span className="mt-px">{repository.name.charAt(0).toUpperCase()}</span>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="group/collapse flex items-center gap-1 flex-1 min-w-0 text-sm font-medium"
        >
          <span className="truncate">{repository.name}</span>
          {repository.collapsed ? (
            <CaretRight size={12} weight="bold" className="shrink-0 opacity-0 group-hover:opacity-100 text-sidebar-foreground/50" />
          ) : (
            <CaretDown size={12} weight="bold" className="shrink-0 opacity-0 group-hover:opacity-100 text-sidebar-foreground/50" />
          )}
        </button>
        <button
          type="button"
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-sidebar-foreground/10"
          onClick={() => {
            // TODO: settings action
          }}
        >
          <GearSix size={14} weight="bold" className="text-sidebar-foreground/50" />
        </button>
      </div>

      {/* Workspaces list */}
      {!repository.collapsed && (
        <div className="mt-1 space-y-0.5 px-2 ml-2">
          {/* New workspace button */}
          <button
            type="button"
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 rounded-md"
          >
            <Plus size={14} weight="light" />
            <span>New workspace</span>
          </button>

          {/* Workspace items */}
          {repository.workspaces.map((workspace) => (
            <WorkspaceItem
              key={workspace.id}
              workspace={workspace}
              selected={workspace.id === selectedWorkspaceId}
              onClick={() => onSelectWorkspace?.(workspace.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
