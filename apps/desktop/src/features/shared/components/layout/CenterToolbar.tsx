import { type CSSProperties } from "react"
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
import { DESKTOP_LEFT_TOGGLE_OFFSET } from "./layoutSizing"
import { iconTextClassNames } from "@/features/shared/appearance"
import type { AppMode } from "@/features/local-chat/types"

interface CenterToolbarProps {
  activeView?: "chat" | "settings" | "automations"
  appMode?: AppMode
  onSelectAppMode?: (mode: AppMode) => void
}

const noDragStyle: CSSProperties = { WebkitAppRegion: "no-drag" }
const dragStyle: CSSProperties = { WebkitAppRegion: "drag" }

export function CenterToolbar({
  activeView = "chat",
  appMode = "dev",
  onSelectAppMode,
}: CenterToolbarProps) {
  const { isCollapsed: isLeftCollapsed, toggle: toggleLeft } = useSidebar()
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
    appMode === "dev" &&
    focusedProjectId != null &&
    newWorkspaceSetupProjectId === focusedProjectId

  const canToggleRightSidebar =
    activeView === "chat" && isRightSidebarAvailable && !isNewWorkspaceSetupActive
  const handleRightSidebarIntent = () => {
    if (appMode === "chat") {
      return
    }

    void prewarmProjectData(activeWorktreeId, activeWorktreePath, rightSidebarActiveTab)
  }
  const leftToggleButton = (
    <Button
      type="button"
      onClick={toggleLeft}
      variant="ghost"
      size="icon-sm"
      className={cn(
        "transition-[background-color,color,transform] duration-150 ease-out hover:bg-sidebar-accent active:scale-[0.97]",
        iconTextClassNames.subtle,
        !isLeftCollapsed && `bg-sidebar-accent/60 ${iconTextClassNames.strong}`
      )}
      style={noDragStyle}
      aria-label="Toggle left sidebar"
    >
      <Sidebar size={14} weight={isLeftCollapsed ? "regular" : "fill"} />
    </Button>
  )

  return (
    <div
      className={cn(
        "relative flex h-11 shrink-0 select-none border-b border-sidebar-border bg-sidebar",
        activeView === "chat" && "text-foreground",
      )}
      style={{
        ...dragStyle,
        ["--desktop-left-toggle-offset" as string]: `${DESKTOP_LEFT_TOGGLE_OFFSET}px`,
      }}
    >
      <div className="pointer-events-none flex h-full w-full items-center gap-3 px-3 md:pl-[var(--desktop-left-toggle-offset)]">
        <div className="pointer-events-auto flex shrink-0 items-center" style={noDragStyle}>
          {leftToggleButton}
        </div>

        <div className="pointer-events-auto flex min-w-0 shrink-0 items-center gap-1" style={noDragStyle}>
          <div className="flex h-7 items-center rounded-md bg-sidebar-accent/45 p-0.5">
            {(["dev", "chat"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onSelectAppMode?.(mode)}
                className={cn(
                  "h-6 rounded px-2 text-xs font-medium capitalize transition",
                  appMode === mode
                    ? "bg-[var(--sidebar-item-active)] text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/54 hover:text-sidebar-foreground"
                )}
              >
                {mode}
              </button>
            ))}
          </div>

          {activeView === "chat" && appMode === "dev" && !isNewWorkspaceSetupActive ? (
            <BranchTargetSelector
              projectId={focusedProjectId}
              projectTargetBranch={targetBranch}
              worktreePath={activeWorktreePath}
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1" />

        {activeView === "chat" && !isNewWorkspaceSetupActive ? (
          <div
            className="pointer-events-auto hidden shrink-0 items-center gap-2 md:flex"
            style={noDragStyle}
          >
            {appMode === "dev" && activeWorktreePath ? <ProjectActionsControl /> : null}
            {appMode === "dev" && activeWorktreePath ? <SourceControlActionGroup /> : null}
            {canToggleRightSidebar ? (
              <Button
                type="button"
                onClick={toggleRight}
                onPointerEnter={handleRightSidebarIntent}
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "hover:bg-sidebar-accent",
                  iconTextClassNames.subtle,
                  !isRightCollapsed && `bg-sidebar-accent ${iconTextClassNames.strong}`
                )}
                style={noDragStyle}
                aria-label="Toggle right sidebar"
              >
                <Sidebar
                  size={14}
                  weight={isRightCollapsed ? "regular" : "fill"}
                  className="scale-x-[-1]"
                />
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1 md:hidden" style={noDragStyle}>
          {canToggleRightSidebar ? (
            <Button
              type="button"
              onClick={toggleRight}
              onPointerEnter={handleRightSidebarIntent}
              variant="ghost"
              size="icon-sm"
              className={cn("hover:bg-sidebar-accent", iconTextClassNames.subtle)}
              style={noDragStyle}
              aria-label="Toggle right sidebar"
            >
              <Sidebar
                size={14}
                weight={isRightCollapsed ? "regular" : "fill"}
                className="scale-x-[-1]"
              />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
