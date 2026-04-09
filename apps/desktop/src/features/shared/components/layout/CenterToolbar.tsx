import { Sidebar } from "@/components/icons"
import { SourceControlActionGroup } from "./AppHeader"
import { BranchTargetSelector } from "./BranchTargetSelector"
import { useSidebar } from "./useSidebar"
import { useRightSidebar } from "./useRightSidebar"
import { Button } from "@/features/shared/components/ui/button"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/features/workspace/store"
import { ProjectActionsControl } from "@/features/workspace/components/ProjectActionsControl"
import { prewarmProjectData } from "@/features/shared/utils/prewarmProjectData"

interface CenterToolbarProps {
  activeView?: "chat" | "settings" | "automations"
}

const WINDOW_CONTROLS_GUTTER_WIDTH = 80
const DESKTOP_LEFT_TOGGLE_OFFSET = WINDOW_CONTROLS_GUTTER_WIDTH + 12
const COLLAPSED_LEFT_TOGGLE_WIDTH = 28
const COLLAPSED_BRANCH_GAP = 8
const COLLAPSED_BRANCH_OFFSET =
  DESKTOP_LEFT_TOGGLE_OFFSET + COLLAPSED_LEFT_TOGGLE_WIDTH + COLLAPSED_BRANCH_GAP - 16

export function CenterToolbar({ activeView = "chat" }: CenterToolbarProps) {
  const { isCollapsed, toggle: toggleLeft } = useSidebar()
  const {
    isAvailable: isRightSidebarAvailable,
    isCollapsed: isRightCollapsed,
    activeTab: rightSidebarActiveTab,
    toggle: toggleRight,
  } = useRightSidebar()
  const newWorkspaceSetupProjectId = useProjectStore((state) => state.newWorkspaceSetupProjectId)
  const { focusedProjectId, activeWorktreeId, activeWorktreePath, targetBranch } = useCurrentProjectWorktree()
  const isNewWorkspaceSetupActive =
    activeView === "chat" &&
    focusedProjectId != null &&
    newWorkspaceSetupProjectId === focusedProjectId

  const canToggleRightSidebar =
    activeView === "chat" && isRightSidebarAvailable && !isNewWorkspaceSetupActive
  const showRightSidebar = canToggleRightSidebar && !isRightCollapsed
  const collapsedBranchOffset = isCollapsed && activeView === "chat" ? COLLAPSED_BRANCH_OFFSET : 0
  const handleRightSidebarIntent = () => {
    void prewarmProjectData(activeWorktreeId, activeWorktreePath, rightSidebarActiveTab)
  }

  return (
    <div
      className={cn(
        "relative flex h-11 shrink-0 select-none border-b border-sidebar-border/70 bg-sidebar",
        activeView === "chat" && "text-foreground",
      )}
    >
      {/* Desktop: left sidebar toggle when the left sidebar is collapsed */}
      {isCollapsed ? (
        <div
          className="absolute top-1/2 z-10 hidden -translate-y-1/2 items-center gap-2 md:flex"
          style={{ left: DESKTOP_LEFT_TOGGLE_OFFSET }}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={toggleLeft}
            className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            aria-label="Toggle left sidebar"
          >
            <Sidebar size={14} />
          </Button>
        </div>
      ) : null}

      {/* Center content */}
      <div className="flex h-full min-w-0 flex-1 items-center">
        <div
          className={cn(
            "hidden h-full min-w-0 shrink-0 items-center gap-3 pl-4 md:flex",
          )}
          style={collapsedBranchOffset > 0 ? { marginLeft: collapsedBranchOffset } : undefined}
        >
          {activeView === "chat" && !isNewWorkspaceSetupActive ? (
            <BranchTargetSelector
              projectId={focusedProjectId}
              projectTargetBranch={targetBranch}
              worktreePath={activeWorktreePath}
            />
          ) : null}
        </div>
        <div className="drag-region min-w-0 flex-1 self-stretch" />
        {activeView === "chat" && !isNewWorkspaceSetupActive ? (
          <div className="hidden shrink-0 items-center gap-2 pr-3 md:flex">
            {activeWorktreePath ? <ProjectActionsControl /> : null}
            {activeWorktreePath && !showRightSidebar ? <SourceControlActionGroup /> : null}
            {canToggleRightSidebar && !showRightSidebar ? (
              <Button
                type="button"
                onClick={toggleRight}
                onPointerEnter={handleRightSidebarIntent}
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                aria-label="Toggle right sidebar"
              >
                <Sidebar size={14} className="scale-x-[-1]" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Mobile controls */}
      <div className="flex shrink-0 items-center gap-1 px-3 md:hidden">
        <Button
          type="button"
          onClick={toggleLeft}
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground md:hidden"
          aria-label="Toggle left sidebar"
        >
          <Sidebar size={14} />
        </Button>
        {canToggleRightSidebar ? (
          <Button
            type="button"
            onClick={toggleRight}
            onPointerEnter={handleRightSidebarIntent}
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            aria-label="Toggle right sidebar"
          >
            <Sidebar size={14} className="scale-x-[-1]" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
