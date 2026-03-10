import { useState, useEffect, useRef, useCallback } from "react"
import {
  CaretDown,
  CaretUp,
  CircleDashed,
  FolderSimple,
  FolderSimplePlus,
  GearSix,
  PlusSquare,
  X,
  Plus,
  Archive,
} from "@/components/icons"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/features/shared/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/features/shared/components/ui/tooltip"
import { QuickStartModal } from "@/features/workspace/components/modals"
import { useProjectStore } from "@/features/workspace/store"
import { getAgentAvatarUrl } from "@/features/workspace/utils/avatar"
import { openFolderPicker } from "@/features/workspace/utils/folderDialog"
import { useChatStore } from "@/features/chat/store"
import { useSidebar } from "./useSidebar"
import { cn } from "@/lib/utils"
import type { Session } from "@/features/chat/types"
import type { Project } from "@/features/workspace/types"
import {
  SETTINGS_BACK_ICON,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "@/features/settings/config"

interface LeftSidebarProps {
  activeView?: "chat" | "settings"
  activeSettingsSection?: SettingsSectionId
  onOpenChat?: () => void
  onOpenSettings?: () => void
  onSelectSettingsSection?: (section: SettingsSectionId) => void
}

export function LeftSidebar({
  activeView = "chat",
  activeSettingsSection = "general",
  onOpenChat,
  onOpenSettings,
  onSelectSettingsSection,
}: LeftSidebarProps) {
  const [quickStartOpen, setQuickStartOpen] = useState(false)
  const [projectToRemove, setProjectToRemove] = useState<{ id: string; name: string } | null>(null)
  const [confirmArchiveSessionId, setConfirmArchiveSessionId] = useState<string | null>(null)
  const { isCollapsed, width, setWidth } = useSidebar()
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const {
    projects,
    selectedProjectId,
    isLoading,
    loadProjects,
    addProject,
    removeProject,
    selectProject,
  } = useProjectStore()

  const {
    getProjectChat,
    selectSession,
    archiveSession,
    initialize: initializeChat,
    loadSessionsForProject,
    openDraftSession,
    currentSessionId,
    status,
  } = useChatStore()

  // Load projects on mount
  useEffect(() => {
    loadProjects()
    initializeChat()
  }, [loadProjects, initializeChat])

  // Sync project paths and restore the persisted active session for the selected workspace
  useEffect(() => {
    if (!selectedProjectId) {
      return
    }

    const project = projects.find((candidate) => candidate.id === selectedProjectId)
    if (!project?.path) {
      return
    }

    const projectChat = getProjectChat(selectedProjectId)
    void loadSessionsForProject(selectedProjectId, project.path)

    if (projectChat.activeSessionId && currentSessionId !== projectChat.activeSessionId) {
      void selectSession(selectedProjectId, projectChat.activeSessionId)
    }
  }, [
    currentSessionId,
    getProjectChat,
    loadSessionsForProject,
    projects,
    selectSession,
    selectedProjectId,
  ])

  const handleOpenProject = async () => {
    const folderPath = await openFolderPicker()
    if (folderPath) {
      await addProject(folderPath)
    }
  }

  const handleRemoveClick = (e: React.MouseEvent, project: { id: string; name: string }) => {
    e.stopPropagation()
    setProjectToRemove(project)
  }

  const handleConfirmRemove = async () => {
    if (projectToRemove) {
      await removeProject(projectToRemove.id)
      setProjectToRemove(null)
    }
  }

  const handleSelectSession = async (projectId: string, sessionId: string) => {
    setConfirmArchiveSessionId(null)
    onOpenChat?.()
    // First select the project
    selectProject(projectId)
    // Then select the session
    await selectSession(projectId, sessionId)
  }

  const handleArchiveIntent = async (
    e: React.MouseEvent,
    projectId: string,
    sessionId: string,
  ) => {
    e.stopPropagation()

    if (confirmArchiveSessionId === sessionId) {
      setConfirmArchiveSessionId(null)
      await archiveSession(projectId, sessionId)
      return
    }

    setConfirmArchiveSessionId(sessionId)
  }

  const formatSessionTitle = (session: Session | null | undefined): string => {
    if (!session) return "New Session"
    if (session.title) return session.title
    const date = new Date(session.createdAt)
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const BackIcon = SETTINGS_BACK_ICON
  const sidebarWidth = isCollapsed ? 48 : width
  const sidebarTopPadding = isCollapsed ? 12 : 16
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const selectedProjectChat = selectedProject ? getProjectChat(selectedProject.id) : null
  const archivedSessionIds = new Set(selectedProjectChat?.archivedSessionIds ?? [])
  const selectedProjectSessions =
    selectedProjectChat?.sessions.filter((session) => !archivedSessionIds.has(session.id)) ?? []
  const expandedRowClass =
    "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-medium"
  const expandedRowIdleClass =
    "text-sidebar-foreground/68 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
  const expandedRowActiveClass =
    "bg-[var(--sidebar-item-active)] text-sidebar-accent-foreground"
  const glassSidebarClass =
    "bg-[var(--sidebar-glass)] supports-[backdrop-filter]:bg-[var(--sidebar-glass-strong)]"

  const stopResizing = useCallback(() => {
    resizeStateRef.current = null
    document.documentElement.style.removeProperty("cursor")
    document.documentElement.style.removeProperty("user-select")
    document.documentElement.style.removeProperty("-webkit-user-select")
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
    document.body.style.removeProperty("-webkit-user-select")
  }, [])

  useEffect(() => {
    return () => {
      stopResizing()
    }
  }, [stopResizing])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) {
        return
      }

      const nextWidth = resizeState.startWidth + (event.clientX - resizeState.startX)
      setWidth(nextWidth)
    }

    const handlePointerUp = () => {
      stopResizing()
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [setWidth, stopResizing])

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isCollapsed) {
      return
    }

    event.preventDefault()

    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
    }

    window.getSelection()?.removeAllRanges()
    document.documentElement.style.cursor = "col-resize"
    document.documentElement.style.userSelect = "none"
    document.documentElement.style.setProperty("-webkit-user-select", "none")
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.style.setProperty("-webkit-user-select", "none")
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleCreateThreadFromSelectedProject = async () => {
    if (!selectedProject) {
      return
    }

    setConfirmArchiveSessionId(null)
    onOpenChat?.()
    await selectProject(selectedProject.id)
    await openDraftSession(selectedProject.id, selectedProject.path)
  }

  const handleOpenAutomations = () => {
    onOpenChat?.()
  }

  const handleSelectWorkspace = async (project: Project) => {
    setConfirmArchiveSessionId(null)
    onOpenChat?.()
    await selectProject(project.id)
    await loadSessionsForProject(project.id, project.path)

    const projectChat = getProjectChat(project.id)
    if (projectChat.activeSessionId) {
      await selectSession(project.id, projectChat.activeSessionId)
      return
    }

    await openDraftSession(project.id, project.path)
  }

  if (isCollapsed) {
    return null
  }

  if (activeView === "settings") {
    return (
      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          "relative text-sidebar-foreground border-r border-sidebar-border/70 flex flex-col overflow-hidden shrink-0",
          glassSidebarClass,
          isCollapsed ? "w-12" : "min-w-[240px] max-w-[420px]",
        )}
      >
        <div className="flex-1 overflow-y-auto">
          <div
            className={cn("px-2 pb-2", isCollapsed ? "space-y-1" : "space-y-2")}
            style={{ paddingTop: sidebarTopPadding }}
          >
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onOpenChat?.()}
                    className="flex h-9 w-full items-center justify-center rounded-xl text-sidebar-foreground/68 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
                    aria-label="Back to app"
                  >
                    <BackIcon size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Back to app</TooltipContent>
              </Tooltip>
            ) : (
              <button
                type="button"
                onClick={() => onOpenChat?.()}
                className={cn(expandedRowClass, expandedRowIdleClass)}
              >
                <BackIcon size={16} className="shrink-0" />
                <span className="truncate">Back to app</span>
              </button>
            )}

            <nav aria-label="Settings navigation" className="space-y-0.5">
              {SETTINGS_SECTIONS.map((section) => {
                const Icon = section.icon
                const isActive = activeSettingsSection === section.id

                return isCollapsed ? (
                  <Tooltip key={section.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onSelectSettingsSection?.(section.id)}
                        className={cn(
                          "flex h-9 w-full items-center justify-center rounded-xl",
                          isActive
                            ? "bg-[var(--sidebar-item-active)] text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/62 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground",
                        )}
                        aria-label={section.label}
                      >
                        <Icon size={16} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{section.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => onSelectSettingsSection?.(section.id)}
                    className={cn(
                      expandedRowClass,
                      isActive ? expandedRowActiveClass : expandedRowIdleClass,
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="truncate">{section.label}</span>
                  </button>
                )
              })}
            </nav>
          </div>
        </div>
        {!isCollapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={handleResizeStart}
            className="absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize"
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors hover:bg-sidebar-border/90" />
          </div>
        ) : null}
      </aside>
    )
  }

  if (isLoading) {
    return (
      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          "relative text-sidebar-foreground border-r border-sidebar-border/70 flex flex-col shrink-0",
          glassSidebarClass,
          isCollapsed ? "w-12" : "min-w-[240px] max-w-[420px]"
        )}
      >
        {/* Loading state */}
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </aside>
    )
  }

  return (
      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          "relative text-sidebar-foreground border-r border-sidebar-border/70 flex flex-col overflow-hidden shrink-0",
          glassSidebarClass,
          isCollapsed ? "w-12" : "min-w-[240px] max-w-[420px]"
        )}
      >
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-2 pb-2" style={{ paddingTop: sidebarTopPadding }}>
          {isCollapsed ? (
            <div className="mb-3 space-y-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => void handleCreateThreadFromSelectedProject()}
                    disabled={!selectedProject}
                    className={cn(
                      "flex h-9 w-full items-center justify-center rounded-xl",
                      selectedProject
                        ? "text-sidebar-foreground/76 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
                        : "cursor-not-allowed text-sidebar-foreground/28",
                    )}
                    aria-label="New thread"
                  >
                    <Plus size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">New thread</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="flex h-9 w-full items-center justify-center rounded-xl text-sidebar-foreground/68 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground cursor-pointer">
                      <FolderSimplePlus size={16} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="end" className="w-48">
                      <DropdownMenuItem onClick={handleOpenProject}>
                        <span>Open workspace</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setQuickStartOpen(true)}>
                        <span>Quick start</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TooltipTrigger>
                <TooltipContent side="right">Add workspace</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleOpenAutomations}
                    className="flex h-9 w-full items-center justify-center rounded-xl text-sidebar-foreground/68 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
                    aria-label="Automations"
                  >
                    <CircleDashed size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Automations</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="mb-3 space-y-2">
              {selectedProject ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left",
                      "text-sidebar-foreground/76 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground",
                    )}
                  >
                    <img
                      src={getAgentAvatarUrl(selectedProject.avatarSeed)}
                      alt=""
                      className="size-8 shrink-0 rounded-[28%] border border-sidebar-border/55 bg-background/10 object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[19px] leading-none tracking-[0.06em]"
                        style={{ fontFamily: "var(--font-pixel)" }}
                      >
                        {selectedProject.name}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-center justify-center text-sidebar-foreground/34">
                      <CaretUp size={10} />
                      <CaretDown size={10} className="-mt-0.5" />
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="start" className="w-[260px]">
                    {projects.map((project) => {
                      const isActive = project.id === selectedProjectId

                      return (
                        <DropdownMenuItem
                          key={project.id}
                          onClick={() => void handleSelectWorkspace(project)}
                          className="flex items-center gap-3 px-2 py-2.5"
                        >
                          <img
                            src={getAgentAvatarUrl(project.avatarSeed)}
                            alt=""
                            className="size-7 shrink-0 rounded-[28%] border border-border/60 bg-background/10 object-cover"
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className="block truncate text-[14px] leading-none"
                              style={{ fontFamily: "var(--font-pixel)" }}
                            >
                              {project.name}
                            </span>
                          </span>
                          {isActive ? (
                            <span className="text-[11px] text-muted-foreground">Current</span>
                          ) : null}
                        </DropdownMenuItem>
                      )
                    })}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleOpenProject}>
                      <FolderSimplePlus size={16} />
                      <span>Open workspace</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setQuickStartOpen(true)}>
                      <PlusSquare size={16} />
                      <span>Quick start</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenProject}
                  className={cn(expandedRowClass, expandedRowIdleClass)}
                >
                  <FolderSimplePlus size={15} className="shrink-0" />
                  <span className="truncate">Open workspace</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleCreateThreadFromSelectedProject()}
                disabled={!selectedProject}
                className={cn(
                  expandedRowClass,
                  selectedProject
                    ? expandedRowIdleClass
                    : "cursor-not-allowed text-sidebar-foreground/32",
                )}
              >
                <Plus size={15} className="shrink-0" />
                <span className="truncate">New thread</span>
              </button>

              <button
                type="button"
                onClick={handleOpenAutomations}
                className={cn(expandedRowClass, expandedRowIdleClass)}
              >
                <CircleDashed size={15} className="shrink-0" />
                <span className="truncate">Automations</span>
              </button>
            </div>
          )}

          {projects.length === 0 ? (
            !isCollapsed && (
              <div className="px-2.5 py-4 text-sm text-muted-foreground text-center">
                No workspaces yet.
                <br />
                <button
                  type="button"
                  onClick={handleOpenProject}
                  className="text-primary hover:underline mt-1"
                >
                  Add a workspace
                </button>
              </div>
            )
          ) : isCollapsed ? (
            <div className="space-y-0.5">
              {projects.map((project) => {
                const isSelected = selectedProjectId === project.id

                return (
                  <Tooltip key={project.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => void handleSelectWorkspace(project)}
                        className={cn(
                          "w-full flex items-center justify-center p-1.5 rounded-lg",
                          isSelected
                            ? "bg-[var(--sidebar-item-active)]"
                            : "hover:bg-[var(--sidebar-item-hover)]"
                        )}
                      >
                        <img
                          src={getAgentAvatarUrl(project.avatarSeed)}
                          alt=""
                          className="size-6 rounded-[28%] object-cover"
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{project.name}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <section className="space-y-1">
                <div className="flex items-center justify-between px-2.5 pb-0.5">
                  <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-sidebar-foreground/52">
                    Threads
                  </span>
                </div>

                {selectedProject ? (
                  <div className="space-y-0.5">
                    {selectedProjectSessions.length === 0 ? (
                      <div className="px-2.5 py-3 text-[12px] text-sidebar-foreground/50">
                        No threads in this workspace yet.
                      </div>
                    ) : (
                      selectedProjectSessions
                        .filter(
                          (session): session is Session =>
                            session != null && typeof session.id === "string"
                        )
                        .map((session) => {
                          const isActiveSession = selectedProjectChat?.activeSessionId === session.id
                          const isRunningSession =
                            session.id === currentSessionId &&
                            (status === "streaming" || status === "connecting")
                          const isConfirmingArchive = confirmArchiveSessionId === session.id

                          return (
                            <div
                              key={session.id}
                              onMouseLeave={() => {
                                if (confirmArchiveSessionId === session.id) {
                                  setConfirmArchiveSessionId(null)
                                }
                              }}
                              className={cn(
                                "group/session flex h-9 items-center gap-2 rounded-lg px-2.5",
                                isActiveSession
                                  ? "bg-[var(--sidebar-item-active)] text-sidebar-foreground"
                                  : "text-sidebar-foreground/68 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground",
                              )}
                            >
                              {isRunningSession ? (
                                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                  <span className="size-3 rounded-full border border-sidebar-foreground/18 border-t-sidebar-foreground/62 animate-spin" />
                                </span>
                              ) : null}

                              <button
                                type="button"
                                onClick={() => handleSelectSession(selectedProject.id, session.id)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <span className="block truncate text-[13px] font-medium leading-none">
                                  {formatSessionTitle(session)}
                                </span>
                              </button>

                              {isConfirmingArchive ? (
                                <button
                                  type="button"
                                  onClick={(event) =>
                                    void handleArchiveIntent(event, selectedProject.id, session.id)
                                  }
                                  className="rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-[11px] font-medium tracking-tight text-destructive hover:bg-muted/80"
                                  aria-label="Confirm archive session"
                                >
                                  Confirm
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(event) =>
                                    void handleArchiveIntent(event, selectedProject.id, session.id)
                                  }
                                  className="rounded p-1 opacity-0 transition-opacity hover:bg-[var(--sidebar-item-hover)] group-hover/session:opacity-100"
                                  aria-label="Archive session"
                                >
                                  <Archive size={14} className="text-muted-foreground" />
                                </button>
                              )}
                            </div>
                          )
                        })
                    )}
                  </div>
                ) : (
                  <div className="px-2.5 py-3 text-[12px] text-sidebar-foreground/50">
                    Select a workspace to see its threads.
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 p-2">
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onOpenSettings?.()}
                className={cn(
                  "flex w-full items-center justify-center rounded-lg p-2",
                  activeView === "settings"
                    ? "bg-[var(--sidebar-item-active)] text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/62 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
                )}
                aria-label="Open settings"
              >
                <GearSix size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => onOpenSettings?.()}
            className={cn(
              expandedRowClass,
              activeView === "settings"
                ? expandedRowActiveClass
                : expandedRowIdleClass
            )}
          >
            <GearSix size={16} className="shrink-0" />
            <span className="truncate">Settings</span>
          </button>
        )}
      </div>

      <QuickStartModal open={quickStartOpen} onOpenChange={setQuickStartOpen} />

      {!isCollapsed ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={handleResizeStart}
          className="absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors hover:bg-sidebar-border/90" />
        </div>
      ) : null}

      <AlertDialog open={!!projectToRemove} onOpenChange={(open) => !open && setProjectToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will only remove <strong>{projectToRemove?.name}</strong> from Nucleus.
              The folder and its contents will not be deleted from your computer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
