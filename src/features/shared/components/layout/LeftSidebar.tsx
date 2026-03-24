import { useState, useEffect, useRef, useCallback } from "react"
import { Reorder } from "framer-motion"
import {
  CaretDown,
  CaretRight,
  Folder,
  FolderOpen,
  FolderSimplePlus,
  GearSix,
  Archive,
  DotsThree,
  PencilSimple,
} from "@/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/features/shared/components/ui/tooltip"
import {
  ProjectSettingsModal,
  QuickStartModal,
  RemoveProjectModal,
} from "@/features/workspace/components/modals"
import { useProjectStore } from "@/features/workspace/store"
import { openFolderPicker } from "@/features/workspace/utils/folderDialog"
import { useChatStore } from "@/features/chat/store"
import { hasProjectChatSession } from "@/features/chat/store/sessionState"
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
  activeView?: "chat" | "settings" | "automations"
  activeSettingsSection?: SettingsSectionId
  onOpenChat?: () => void
  onOpenAutomations?: () => void
  onOpenSettings?: () => void
  onSelectSettingsSection?: (section: SettingsSectionId) => void
}

function haveProjectsChangedOrder(nextProjects: Project[], currentProjects: Project[]) {
  return nextProjects.some((project, index) => project.id !== currentProjects[index]?.id)
}

export function LeftSidebar({
  activeView = "chat",
  activeSettingsSection = "general",
  onOpenChat,
  onOpenAutomations,
  onOpenSettings,
  onSelectSettingsSection,
}: LeftSidebarProps) {
  const [quickStartOpen, setQuickStartOpen] = useState(false)
  const [projectSettingsProject, setProjectSettingsProject] = useState<Project | null>(null)
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<Project | null>(null)
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null)
  const [confirmArchiveSessionId, setConfirmArchiveSessionId] = useState<string | null>(null)
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([])
  const pendingSessionSelectionRef = useRef<{ projectId: string; sessionId: string } | null>(null)
  const { isCollapsed, width, setWidth } = useSidebar()
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const {
    projects,
    selectedProjectId,
    isLoading,
    loadProjects,
    addProject,
    selectProject,
    setProjectOrder,
  } = useProjectStore()
  const [projectOrderPreview, setProjectOrderPreview] = useState<Project[] | null>(null)
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null)
  const projectOrderPreviewRef = useRef<Project[] | null>(null)

  const {
    getProjectChat,
    selectSession,
    archiveSession,
    initialize: initializeChat,
    loadSessionsForProject,
    openDraftSession,
    currentSessionId,
    status,
    activePromptBySession,
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
    const pendingSessionSelection = pendingSessionSelectionRef.current
    void loadSessionsForProject(selectedProjectId, project.path)

    if (pendingSessionSelection?.projectId === selectedProjectId) {
      return
    }

    if (!projectChat.activeSessionId) {
      if (currentSessionId !== null) {
        void openDraftSession(selectedProjectId, project.path)
      }
      return
    }

    if (!hasProjectChatSession(projectChat, projectChat.activeSessionId)) {
      void openDraftSession(selectedProjectId, project.path)
      return
    }

    if (currentSessionId !== projectChat.activeSessionId) {
      void selectSession(selectedProjectId, projectChat.activeSessionId)
    }
  }, [
    currentSessionId,
    getProjectChat,
    loadSessionsForProject,
    openDraftSession,
    projects,
    selectSession,
    selectedProjectId,
  ])

  useEffect(() => {
    setExpandedProjectIds((currentIds) => {
      const validProjectIds = new Set(projects.map((project) => project.id))
      const nextIds = currentIds.filter((projectId) => validProjectIds.has(projectId))

      const hasChanged =
        nextIds.length !== currentIds.length ||
        nextIds.some((projectId, index) => projectId !== currentIds[index])

      return hasChanged ? nextIds : currentIds
    })
  }, [projects])

  const handleOpenProject = async () => {
    const folderPath = await openFolderPicker()
    if (folderPath) {
      await addProject(folderPath)
    }
  }

  const handleSelectSession = async (projectId: string, sessionId: string) => {
    pendingSessionSelectionRef.current = { projectId, sessionId }
    setConfirmArchiveSessionId(null)
    onOpenChat?.()

    try {
      void selectProject(projectId)
      await selectSession(projectId, sessionId)
    } finally {
      if (
        pendingSessionSelectionRef.current?.projectId === projectId &&
        pendingSessionSelectionRef.current?.sessionId === sessionId
      ) {
        pendingSessionSelectionRef.current = null
      }
    }
  }

  const handleCreateProjectThread = async (
    event: React.MouseEvent<HTMLButtonElement>,
    project: Project,
  ) => {
    event.stopPropagation()
    setConfirmArchiveSessionId(null)
    onOpenChat?.()
    await selectProject(project.id)
    await openDraftSession(project.id, project.path)
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
  const expandedRowClass =
    "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium"
  const expandedRowIdleClass =
    "text-sidebar-foreground/56 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
  const expandedRowActiveClass =
    "bg-[var(--sidebar-item-active)] text-sidebar-accent-foreground"
  const sidebarSurfaceClass = "bg-sidebar"
  const sectionLabelClass =
    "text-[11px] font-medium uppercase tracking-[0.08em] text-sidebar-foreground/40"
  const orderedProjects = projectOrderPreview ?? projects

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

  const handleToggleProjectExpanded = async (project: Project) => {
    const isExpanded = expandedProjectIds.includes(project.id)

    setExpandedProjectIds((currentIds) =>
      isExpanded
        ? currentIds.filter((projectId) => projectId !== project.id)
        : [...currentIds, project.id]
    )

    if (!isExpanded) {
      await loadSessionsForProject(project.id, project.path)
    }
  }

  useEffect(() => {
    if (!draggedProjectId) {
      setProjectOrderPreview(null)
      projectOrderPreviewRef.current = null
    }
  }, [draggedProjectId, projects])

  const clearProjectDragState = () => {
    setDraggedProjectId(null)
    setProjectOrderPreview(null)
    projectOrderPreviewRef.current = null
  }

  const handleProjectReorder = (nextProjects: Project[]) => {
    setProjectOrderPreview(nextProjects)
    projectOrderPreviewRef.current = nextProjects
  }

  const commitProjectOrder = async () => {
    const nextProjects = projectOrderPreviewRef.current
    if (!nextProjects || !haveProjectsChangedOrder(nextProjects, projects)) {
      clearProjectDragState()
      return
    }

    try {
      await setProjectOrder(nextProjects)
    } finally {
      clearProjectDragState()
    }
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
          sidebarSurfaceClass,
          isCollapsed ? "w-12" : "min-w-[240px] max-w-[420px]",
        )}
      >
        <div className="flex-1 overflow-y-auto">
          <div
            className={cn("px-2 pb-2", isCollapsed ? "space-y-1.5" : "space-y-2")}
            style={{ paddingTop: sidebarTopPadding }}
          >
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onOpenChat?.()}
                    className="flex h-8 w-full items-center justify-center rounded-lg text-sidebar-foreground/68 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
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

            <nav aria-label="Settings navigation" className="space-y-1">
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
                          "flex h-8 w-full items-center justify-center rounded-lg",
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
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent  hover:bg-sidebar-border/90" />
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
          sidebarSurfaceClass,
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
          sidebarSurfaceClass,
          isCollapsed ? "w-12" : "min-w-[240px] max-w-[420px]"
        )}
      >
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-2 pb-2" style={{ paddingTop: sidebarTopPadding }}>
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            <span className={sectionLabelClass}>Workspaces</span>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-6 w-6 items-center justify-center rounded text-sidebar-foreground/40 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/68"
                aria-label="Add workspace"
              >
                <FolderSimplePlus size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" className="w-48">
                <DropdownMenuItem onClick={handleOpenProject}>
                  <span>Open workspace</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setQuickStartOpen(true)}>
                  <span>Quick start</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {projects.length === 0 ? (
            !isCollapsed && (
              <div className="rounded-xl border border-sidebar-border/55 bg-background px-2 py-2 text-center text-sm text-muted-foreground">
                No workspaces yet.
                <br />
                <button
                  type="button"
                  onClick={handleOpenProject}
                  className="mt-1.5 text-primary hover:underline"
                >
                  Add a workspace
                </button>
              </div>
            )
          ) : isCollapsed ? null : (
            <Reorder.Group
              as="div"
              axis="y"
              values={orderedProjects}
              onReorder={handleProjectReorder}
              layoutScroll
              className="flex flex-col gap-1"
            >
              {orderedProjects.map((project) => {
                const projectChat = getProjectChat(project.id)
                const archivedSessionIds = new Set(projectChat.archivedSessionIds ?? [])
                const projectSessions = projectChat.sessions.filter(
                  (session): session is Session =>
                    session != null &&
                    typeof session.id === "string" &&
                    !archivedSessionIds.has(session.id)
                )
                const isExpanded = expandedProjectIds.includes(project.id)
                const isProjectMenuOpen = openProjectMenuId === project.id
                const isDraggingProject = draggedProjectId === project.id

                return (
                  <Reorder.Item
                    as="div"
                    key={project.id}
                    value={project}
                    layout={draggedProjectId ? "position" : false}
                    transition={{
                      layout: {
                        type: "spring",
                        stiffness: 520,
                        damping: 38,
                        mass: 0.5,
                      },
                    }}
                    whileDrag={{
                      zIndex: 20,
                      scale: 1.01,
                    }}
                    className={cn(
                      "space-y-1 rounded-xl",
                      isDraggingProject && "opacity-65"
                    )}
                    onDragStart={() => {
                      setDraggedProjectId(project.id)
                    }}
                    onDragEnd={() => {
                      void commitProjectOrder()
                    }}
                  >
                    <div className="group/project-row relative">
                      <button
                        type="button"
                        onClick={() => void handleToggleProjectExpanded(project)}
                        className={cn(
                          "group/project flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 pr-14 text-left",
                          "text-sidebar-foreground/48 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/72",
                          "group-hover/project-row:bg-[var(--sidebar-item-hover)] group-hover/project-row:text-sidebar-foreground/72",
                        )}
                        aria-label={isExpanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
                        aria-expanded={isExpanded}
                      >
                        <span className="relative flex size-5 shrink-0 items-center justify-center">
                          {isExpanded ? (
                            <FolderOpen size={16} className="text-sidebar-foreground/50" />
                          ) : (
                            <Folder size={16} className="text-sidebar-foreground/50" />
                          )}
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <span className="truncate text-sm font-medium">{project.name}</span>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={(event) => void handleCreateProjectThread(event, project)}
                        className={cn(
                          "absolute top-1/2 right-7 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-sidebar-foreground/30 transition",
                          "hover:text-sidebar-foreground/72 focus-visible:text-sidebar-foreground/72",
                          "opacity-0 group-hover/project-row:opacity-100 focus-visible:opacity-100",
                        )}
                        aria-label={`New thread in ${project.name}`}
                      >
                        <PencilSimple size={14} />
                      </button>

                      <DropdownMenu
                        onOpenChange={(open) => setOpenProjectMenuId(open ? project.id : null)}
                      >
                        <DropdownMenuTrigger
                          className={cn(
                            "absolute top-1/2 right-2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-sidebar-foreground/30 transition",
                            "hover:text-sidebar-foreground/72 focus-visible:text-sidebar-foreground/72",
                            isProjectMenuOpen
                              ? "text-sidebar-foreground/72 opacity-100"
                              : "opacity-0 group-hover/project-row:opacity-100",
                          )}
                          aria-label={`${project.name} settings menu`}
                        >
                          <DotsThree size={14} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="end" className="w-40">
                          <DropdownMenuItem onClick={() => setProjectSettingsProject(project)}>
                            <span>Settings</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setProjectPendingRemoval(project)}
                          >
                            <span>Remove project</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {(() => {
                      if (!isExpanded) return null

                      if (projectSessions.length === 0) {
                        return (
                          <div className="pt-1">
                            <div className="px-2 py-1.5 text-[13px] text-sidebar-foreground/36">
                              No threads yet.
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div className="space-y-0.5 pt-0.5">
                          {projectSessions.map((session) => {
                            const activePromptState = activePromptBySession[session.id]
                            const isAwaitingResponse = activePromptState?.status === "active"
                            const isActiveSession = currentSessionId === session.id
                            const isRunningSession =
                              session.id === currentSessionId &&
                              (status === "streaming" ||
                                status === "connecting" ||
                                isAwaitingResponse)
                            const isConfirmingArchive = confirmArchiveSessionId === session.id

                            return (
                              <div
                                key={session.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => void handleSelectSession(project.id, session.id)}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" && event.key !== " ") {
                                    return
                                  }

                                  event.preventDefault()
                                  void handleSelectSession(project.id, session.id)
                                }}
                                onMouseLeave={() => {
                                  if (confirmArchiveSessionId === session.id) {
                                    setConfirmArchiveSessionId(null)
                                  }
                                }}
                                className={cn(
                                  "group/session flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
                                  "text-sidebar-foreground/48 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/72",
                                  isActiveSession && "bg-[var(--sidebar-item-active)]",
                                )}
                              >
                                {isRunningSession ? (
                                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                    <span className="size-3 rounded-full border border-sidebar-foreground/18 border-t-sidebar-foreground/62 animate-spin" />
                                  </span>
                                ) : (
                                  <span className="h-4 w-4 shrink-0" />
                                )}

                                <div className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
                                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-none">
                                    {formatSessionTitle(session)}
                                  </span>
                                  {isAwaitingResponse ? (
                                    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-emerald-500/14 px-2 text-[11px] font-medium text-emerald-400">
                                      Awaiting response
                                    </span>
                                  ) : null}
                                </div>

                                <div
                                  className={cn(
                                    "flex shrink-0 items-center justify-end",
                                    isConfirmingArchive ? "min-w-[4.75rem]" : "w-7"
                                  )}
                                >
                                  {isConfirmingArchive ? (
                                    <button
                                      type="button"
                                      onClick={(event) =>
                                        void handleArchiveIntent(event, project.id, session.id)
                                      }
                                      className="rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-sm font-medium tracking-tight text-destructive hover:bg-muted/80"
                                      aria-label="Confirm archive session"
                                    >
                                      Confirm
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(event) =>
                                        void handleArchiveIntent(event, project.id, session.id)
                                      }
                                      className="rounded p-1 opacity-0  hover:bg-[var(--sidebar-item-hover)] focus-visible:opacity-100 group-hover/session:opacity-100"
                                      aria-label="Archive session"
                                    >
                                      <Archive size={14} className="text-muted-foreground" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </Reorder.Item>
                )
              })}
            </Reorder.Group>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-sidebar-border/50 px-2 py-2">
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onOpenSettings?.()}
                className={cn(
                  "flex h-8 w-full items-center justify-center rounded-lg",
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
      <ProjectSettingsModal
        open={projectSettingsProject !== null}
        project={projectSettingsProject}
        onOpenChange={(open) => {
          if (!open) {
            setProjectSettingsProject(null)
          }
        }}
      />
      <RemoveProjectModal
        open={projectPendingRemoval !== null}
        project={projectPendingRemoval}
        onOpenChange={(open) => {
          if (!open) {
            setProjectPendingRemoval(null)
          }
        }}
      />

      {!isCollapsed ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={handleResizeStart}
          className="absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent  hover:bg-sidebar-border/90" />
        </div>
      ) : null}

    </aside>
  )
}
