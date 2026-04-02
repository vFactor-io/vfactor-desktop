import { PencilSimple, Sidebar } from "@/components/icons"
import { SourceControlActionGroup } from "./AppHeader"
import { BranchTargetSelector } from "./BranchTargetSelector"
import { useSidebar } from "./useSidebar"
import { useRightSidebar } from "./useRightSidebar"
import { Button } from "@/features/shared/components/ui/button"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/features/workspace/store"
import { ProjectActionsControl } from "@/features/workspace/components/ProjectActionsControl"
import { useChatStore } from "@/features/chat/store"
import { useTabStore } from "@/features/editor/store"

interface CenterToolbarProps {
  activeView?: "chat" | "settings" | "automations"
  onOpenChat?: () => void
}

const WINDOW_CONTROLS_GUTTER_WIDTH = 80
const DESKTOP_LEFT_TOGGLE_OFFSET = WINDOW_CONTROLS_GUTTER_WIDTH + 12
const COLLAPSED_LEFT_ACTIONS_WIDTH = 64

export function CenterToolbar({ activeView = "chat", onOpenChat }: CenterToolbarProps) {
  const { isCollapsed, toggle: toggleLeft } = useSidebar()
  const {
    isAvailable: isRightSidebarAvailable,
    isCollapsed: isRightCollapsed,
    toggle: toggleRight,
  } = useRightSidebar()
  const selectProject = useProjectStore((state) => state.selectProject)
  const { createOptimisticSession, getProjectChat } = useChatStore()
  const openChatSession = useTabStore((state) => state.openChatSession)
  const { focusedProject, focusedProjectId, activeWorktreeId, activeWorktreePath, targetBranch } =
    useCurrentProjectWorktree()

  // Session title needed for mobile collapsed view
  const projectChat = activeWorktreeId ? getProjectChat(activeWorktreeId) : null
  const activeSession =
    projectChat?.sessions.find((session) => session.id === projectChat.activeSessionId) ?? null
  const activeSessionTitle = activeSession?.title?.trim() || ""

  const canToggleRightSidebar = activeView === "chat" && isRightSidebarAvailable
  const showRightSidebar = canToggleRightSidebar && !isRightCollapsed
  const collapsedBranchOffset =
    isCollapsed && activeView === "chat"
      ? DESKTOP_LEFT_TOGGLE_OFFSET + COLLAPSED_LEFT_ACTIONS_WIDTH
      : 0

  const handleCreateThread = async () => {
    if (!focusedProject || !focusedProjectId || !activeWorktreeId || !activeWorktreePath) {
      return
    }

    onOpenChat?.()
    await selectProject(focusedProject.id)
    const session = createOptimisticSession(activeWorktreeId, activeWorktreePath)
    if (session) {
      openChatSession(session.id, session.title)
    }
  }

  return (
    <div
      className={cn(
        "relative flex h-11 shrink-0 select-none border-b border-sidebar-border/70 bg-sidebar",
        activeView === "chat" && "text-foreground",
      )}
    >
      {/* Desktop: left sidebar toggle + new thread (only when left sidebar collapsed) */}
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
          {activeView === "chat" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void handleCreateThread()}
              disabled={!focusedProject || !focusedProjectId || !activeWorktreeId || !activeWorktreePath}
              className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              aria-label="New thread"
            >
              <PencilSimple size={14} />
            </Button>
          ) : null}
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
          {activeView === "chat" ? (
            <BranchTargetSelector
              projectId={focusedProjectId}
              projectTargetBranch={targetBranch}
              worktreePath={activeWorktreePath}
            />
          ) : null}
        </div>
        <div className="drag-region min-w-0 flex-1 self-stretch" />
        {activeView === "chat" ? (
          <div className="hidden shrink-0 items-center gap-2 pr-3 md:flex">
            {activeWorktreePath ? <ProjectActionsControl /> : null}
            {activeWorktreePath && !showRightSidebar ? <SourceControlActionGroup /> : null}
            {canToggleRightSidebar ? (
              <Button
                type="button"
                onClick={toggleRight}
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
        {isCollapsed && activeView === "chat" ? (
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <Button
              type="button"
              onClick={() => void handleCreateThread()}
              variant="ghost"
              size="icon-sm"
              disabled={!focusedProject || !focusedProjectId || !activeWorktreeId || !activeWorktreePath}
              className="shrink-0 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              aria-label="New thread"
            >
              <PencilSimple size={14} />
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              {activeSessionTitle ? (
                <span className="max-w-[160px] truncate text-sm font-medium text-foreground">
                  {activeSessionTitle}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
        {canToggleRightSidebar && !showRightSidebar ? (
          <Button
            type="button"
            onClick={toggleRight}
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
