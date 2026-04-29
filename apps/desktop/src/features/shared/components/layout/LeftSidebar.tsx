import { useState, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react"
import { useShallow } from "zustand/react/shallow"
import { Reorder } from "framer-motion"
import { desktop } from "@/desktop/client"
import {
  GearSix,
  DotsThree,
  GitBranch,
  GitPullRequest,
  Plus,
  FolderSimplePlus,
} from "@/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import { LoadingDots } from "@/features/shared/components/ui/loading-dots"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/features/shared/components/ui/tooltip"
import {
  NewWorkspaceModal,
  ProjectSettingsModal,
  RemoveProjectModal,
  RemoveWorktreeModal,
  WorkspaceSettingsModal,
} from "@/features/workspace/components/modals"
import { ProjectIcon } from "@/features/workspace/components/ProjectIcon"
import { useChatStore } from "@/features/chat/store"
import { useProjectStore } from "@/features/workspace/store"
import { useProjectGitStore } from "@/features/shared/hooks/projectGitStore"
import { openFolderPicker } from "@/features/workspace/utils/folderDialog"
import { useSidebar } from "./useSidebar"
import { useRightSidebar } from "./useRightSidebar"
import { SidebarShell } from "./SidebarShell"
import { cn } from "@/lib/utils"
import type { Project, ProjectWorktree } from "@/features/workspace/types"
import {
  SETTINGS_BACK_ICON,
  SETTINGS_SECTION_GROUPS,
  type SettingsSectionId,
} from "@/features/settings/config"
import { ModelLogo } from "@/features/chat/components/ModelLogo"
import { isWorktreeReady } from "@/features/workspace/utils/worktrees"
import { prewarmProjectData } from "@/features/shared/utils/prewarmProjectData"
import { getVisibleWorktreeActivityById } from "./worktreeActivity"
import {
  resolveSidebarBranchIndicator,
  resolveSidebarPullRequestIndicator,
} from "./sidebarGitIndicators"
import { LEFT_SIDEBAR_WIDTH_CSS_VAR } from "./layoutSizing"

const OPEN_PROJECT_SETTINGS_EVENT = "vfactor:open-project-settings"
const LEFT_SIDEBAR_MIN_WIDTH = 240
const LEFT_SIDEBAR_MAX_WIDTH = 420

interface LeftSidebarProps {
  activeView?: "chat" | "settings" | "automations"
  activeSettingsSection?: SettingsSectionId
  onOpenChat?: () => void
  onOpenAutomations?: () => void
  onOpenSettings?: () => void
  onSelectSettingsSection?: (section: SettingsSectionId) => void
}

const COLLAPSED_HOVER_TRIGGER_WIDTH = 12

function haveProjectIdsChangedOrder(nextProjectIds: string[], currentProjects: Project[]) {
  return nextProjectIds.some((projectId, index) => projectId !== currentProjects[index]?.id)
}

function clampLeftSidebarWidth(width: number) {
  return Math.min(LEFT_SIDEBAR_MAX_WIDTH, Math.max(LEFT_SIDEBAR_MIN_WIDTH, width))
}

function getWorktreeRemovalDisabledReason({
  worktree,
}: {
  worktree: ProjectWorktree
}) {
  if (worktree.status !== "ready") {
    return "This workspace isn't ready to remove yet."
  }

  return null
}

function TruncatedWorkspaceLabel({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  const labelRef = useRef<HTMLSpanElement | null>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  const updateOverflowState = () => {
    const label = labelRef.current
    if (!label) {
      setIsOverflowing(false)
      return
    }

    setIsOverflowing(label.scrollWidth > label.clientWidth + 1)
  }

  useLayoutEffect(() => {
    updateOverflowState()
  }, [children])

  useEffect(() => {
    const label = labelRef.current
    if (!label || typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(updateOverflowState)
    observer.observe(label)
    return () => observer.disconnect()
  }, [])

  const label = (
    <span ref={labelRef} className={className}>
      {children}
    </span>
  )

  if (!isOverflowing) {
    return label
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side="right" align="center" className="max-w-72 text-sm leading-5">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

function ReorderableProjectItem(props: {
  project: Project
  isDraggingProject: boolean
  enableLayoutAnimation: boolean
  children: ReactNode
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const { project, isDraggingProject, enableLayoutAnimation, children, onDragStart, onDragEnd } = props

  return (
    <Reorder.Item
      as="div"
      key={project.id}
      value={project.id}
      layout="position"
      transition={{
        layout: enableLayoutAnimation
          ? { type: "spring", stiffness: 560, damping: 42, mass: 0.55 }
          : { duration: 0 },
      }}
      whileDrag={{
        zIndex: 20,
        cursor: "grabbing",
      }}
      className={cn(
        "relative cursor-grab space-y-0.5 rounded-xl active:cursor-grabbing",
        isDraggingProject && "opacity-65"
      )}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {children}
    </Reorder.Item>
  )
}

export function LeftSidebar({
  activeView = "chat",
  activeSettingsSection = "git",
  onOpenChat,
  onOpenAutomations,
  onOpenSettings,
  onSelectSettingsSection,
}: LeftSidebarProps) {
  const [newWorkspaceModalProject, setNewWorkspaceModalProject] = useState<Project | null>(null)
  const [projectSettingsProject, setProjectSettingsProject] = useState<Project | null>(null)
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<Project | null>(null)
  const [worktreeSettingsTarget, setWorktreeSettingsTarget] = useState<{
    project: Project
    worktree: ProjectWorktree
  } | null>(null)
  const [worktreePendingRemoval, setWorktreePendingRemoval] = useState<{
    project: Project
    worktree: ProjectWorktree
  } | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([])
  const { isCollapsed, width, setWidth, expand } = useSidebar()
  const { activeTab: rightSidebarActiveTab, isCollapsed: isRightSidebarCollapsed } = useRightSidebar()
  const {
    projects,
    focusedProjectId,
    activeWorktreeId,
    newWorkspaceSetupProjectId,
    isLoading,
    loadProjects,
    addProject,
    selectProject,
    selectWorktree,
    startNewWorkspaceSetup,
    cancelNewWorkspaceSetup,
    setProjectOrder,
  } = useProjectStore()
  const setWorkspaceSetupState = useChatStore((state) => state.setWorkspaceSetupState)
  const setWorkspaceSetupIntent = useChatStore((state) => state.setWorkspaceSetupIntent)
  const requestGitRefresh = useProjectGitStore((state) => state.requestRefresh)
  const ensureGitEntry = useProjectGitStore((state) => state.ensureEntry)
  const [projectOrderPreview, setProjectOrderPreview] = useState<string[] | null>(null)
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null)
  const [isHoverPreviewOpen, setIsHoverPreviewOpen] = useState(false)
  const projectOrderPreviewRef = useRef<string[] | null>(null)

  // Load projects on mount
  useEffect(() => {
    loadProjects()
  }, [loadProjects])

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

  const BackIcon = SETTINGS_BACK_ICON
  const expandedRowClass =
    "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium"
  const expandedRowIdleClass =
    "text-sidebar-foreground/56 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
  const expandedRowActiveClass =
    "bg-[var(--sidebar-item-active)] text-sidebar-accent-foreground"
  const projectActionButtonClass =
    "absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-sm text-sidebar-foreground/52 transition hover:text-sidebar-foreground/90 focus-visible:text-sidebar-foreground/90"
  const sectionLabelClass =
    "text-xs font-medium uppercase tracking-[0.08em] text-sidebar-foreground/40"
  const hoveredWorktreePrewarmTarget =
    activeView === "chat" && !isRightSidebarCollapsed ? rightSidebarActiveTab : "changes"
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )
  const visibleWorktreeIds = useMemo(
    () => projects.flatMap((project) => project.worktrees.map((worktree) => worktree.id)),
    [projects]
  )
  const worktreeActivityById = useChatStore(
    useShallow((state) =>
      getVisibleWorktreeActivityById(
        visibleWorktreeIds,
        state.chatByWorktree,
        state.sessionActivityById
      )
    )
  )
  const orderedProjectIds = projectOrderPreview ?? projects.map((project) => project.id)

  useEffect(() => {
    const handleOpenProjectSettings = (event: Event) => {
      const projectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId
      if (!projectId) {
        return
      }

      const project = projectById.get(projectId) ?? null
      if (project) {
        setProjectSettingsProject(project)
      }
    }

    window.addEventListener(OPEN_PROJECT_SETTINGS_EVENT, handleOpenProjectSettings)
    return () => window.removeEventListener(OPEN_PROJECT_SETTINGS_EVENT, handleOpenProjectSettings)
  }, [projectById])

  const handleToggleProjectExpanded = (project: Project) => {
    const isExpanded = expandedProjectIds.includes(project.id)

    setExpandedProjectIds((currentIds) =>
      isExpanded
        ? currentIds.filter((projectId) => projectId !== project.id)
        : [...currentIds, project.id]
    )
  }

  const handleCreateWorktree = (event: React.MouseEvent<HTMLButtonElement>, project: Project) => {
    event.stopPropagation()
    setNewWorkspaceModalProject(project)
  }

  const handleContinueNewWorkspace = async ({
    project,
    prompt,
  }: {
    project: Project
    prompt: string
  }) => {
    if (newWorkspaceSetupProjectId) {
      setWorkspaceSetupState(newWorkspaceSetupProjectId, null)
      setWorkspaceSetupIntent(newWorkspaceSetupProjectId, null)
      cancelNewWorkspaceSetup()
    }

    onOpenChat?.()
    setWorkspaceSetupState(project.id, null)
    setWorkspaceSetupIntent(project.id, {
      prompt,
      autoSubmit: true,
    })
    startNewWorkspaceSetup(project.id)
    await selectProject(project.id)
  }

  const handleSelectWorktree = async (project: Project, worktree: ProjectWorktree) => {
    if (!isWorktreeReady(worktree)) {
      return
    }

    if (newWorkspaceSetupProjectId) {
      setWorkspaceSetupState(newWorkspaceSetupProjectId, null)
      setWorkspaceSetupIntent(newWorkspaceSetupProjectId, null)
      cancelNewWorkspaceSetup()
    }

    onOpenChat?.()
    void prewarmProjectData(worktree.id, worktree.path, hoveredWorktreePrewarmTarget)
    await selectWorktree(project.id, worktree.id)
  }

  const handleRemoveWorktree = (project: Project, worktree: ProjectWorktree) => {
    setWorktreePendingRemoval({ project, worktree })
  }

  useEffect(() => {
    if (!draggedProjectId) {
      setProjectOrderPreview(null)
      projectOrderPreviewRef.current = null
    }
  }, [draggedProjectId, projects])

  useEffect(() => {
    if (!isCollapsed && isHoverPreviewOpen) {
      setIsHoverPreviewOpen(false)
    }
  }, [isCollapsed, isHoverPreviewOpen])

  useEffect(() => {
    if (activeView === "settings" && isCollapsed) {
      expand()
    }
  }, [activeView, expand, isCollapsed])

  const expandedReadyWorktreePaths = useMemo(
    () =>
      projects
        .filter((project) => expandedProjectIds.includes(project.id))
        .flatMap((project) =>
          project.worktrees
            .filter((worktree) => worktree.status === "ready")
            .map((worktree) => worktree.path)
        ),
    [expandedProjectIds, projects]
  )
  const branchDataByWorktreePath = useProjectGitStore(
    useShallow((state) =>
      Object.fromEntries(
        expandedReadyWorktreePaths.map((worktreePath) => [
          worktreePath,
          state.entriesByProjectPath[worktreePath]?.branchData ?? null,
        ])
      )
    )
  )

  useEffect(() => {
    for (const worktreePath of expandedReadyWorktreePaths) {
      ensureGitEntry(worktreePath)
      void requestGitRefresh(worktreePath, {
        includeBranches: true,
        includeChanges: true,
        quietBranches: true,
        quietChanges: true,
        debounceMs: 0,
      })
    }
  }, [ensureGitEntry, expandedReadyWorktreePaths, requestGitRefresh])

  const clearProjectDragState = () => {
    setDraggedProjectId(null)
    setProjectOrderPreview(null)
    projectOrderPreviewRef.current = null
  }

  const handleProjectReorder = (nextProjectIds: string[]) => {
    setProjectOrderPreview(nextProjectIds)
    projectOrderPreviewRef.current = nextProjectIds
  }

  const commitProjectOrder = () => {
    const nextProjectIds = projectOrderPreviewRef.current
    if (!nextProjectIds || !haveProjectIdsChangedOrder(nextProjectIds, projects)) {
      clearProjectDragState()
      return
    }

    const nextProjects = nextProjectIds
      .map((projectId) => projectById.get(projectId))
      .filter((project): project is Project => project != null)

    clearProjectDragState()
    void setProjectOrder(nextProjects)
  }

  const handleWorktreeMenuOpenChange = (open: boolean, worktree: ProjectWorktree) => {
    setOpenMenuId(open ? worktree.id : null)

    if (!open || worktree.status !== "ready") {
      return
    }

    ensureGitEntry(worktree.path)
    void requestGitRefresh(worktree.path, {
      includeBranches: true,
      includeChanges: true,
      quietBranches: true,
      quietChanges: true,
      debounceMs: 0,
    })
  }

  const renderProjectRow = (project: Project) => {
    const isExpanded = expandedProjectIds.includes(project.id)
    const isProjectMenuOpen = openMenuId === project.id
    const isDraggingProject = draggedProjectId === project.id

    const content = (
      <>
        <div className="group/project-row relative">
          <button
            type="button"
            onClick={() => handleToggleProjectExpanded(project)}
            className={cn(
              "group/project flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 pr-16 text-left",
              "text-sidebar-foreground/72 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/92",
              "group-hover/project-row:bg-[var(--sidebar-item-hover)] group-hover/project-row:text-sidebar-foreground/92",
              isProjectMenuOpen && "bg-[var(--sidebar-item-hover)] text-sidebar-foreground/92",
            )}
            aria-label={isExpanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
            aria-expanded={isExpanded}
          >
            <span className="relative flex size-5 shrink-0 items-center justify-center text-sm">
              <ProjectIcon
                project={project}
                isExpanded={isExpanded}
                size="1em"
                className="text-sidebar-foreground/68"
              />
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <TruncatedWorkspaceLabel className="min-w-0 flex-1 truncate text-sm font-medium">
                {project.name}
              </TruncatedWorkspaceLabel>
            </span>
          </button>

          <button
            type="button"
            onClick={(event) => void handleCreateWorktree(event, project)}
            className={cn(
              projectActionButtonClass,
              "right-8",
              "opacity-0 group-hover/project-row:opacity-100 focus-visible:opacity-100",
            )}
            aria-label={`Create workspace in ${project.name}`}
          >
            <Plus size="1em" />
          </button>

          <DropdownMenu
            onOpenChange={(open) => setOpenMenuId(open ? project.id : null)}
          >
            <DropdownMenuTrigger
              className={cn(
                projectActionButtonClass,
                "right-0.5 h-7 w-7 text-sidebar-foreground/44 hover:text-sidebar-foreground/88 focus-visible:text-sidebar-foreground/88",
                isProjectMenuOpen
                  ? "text-sidebar-foreground opacity-100"
                  : "opacity-0 group-hover/project-row:opacity-100",
              )}
              aria-label={`${project.name} settings menu`}
            >
              <DotsThree size="1em" weight="bold" />
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

          if (project.worktrees.length === 0) {
            return (
              <div>
                <div className="px-8 py-1.5 text-sm text-sidebar-foreground/36">
                  No workspaces yet.
                </div>
              </div>
            )
          }

          return (
            <div className="space-y-0.5">
              {project.worktrees.map((worktree) => {
                const isProjectInNewWorkspaceSetup =
                  focusedProjectId === project.id && newWorkspaceSetupProjectId === project.id
                const isSelectedWorktree =
                  !isProjectInNewWorkspaceSetup &&
                  focusedProjectId === project.id &&
                  activeWorktreeId === worktree.id
                const isWorktreeMenuOpen = openMenuId === worktree.id
                const isWorktreeReadyForSelection = isWorktreeReady(worktree)
                const worktreeActivityStatus = worktreeActivityById[worktree.id] ?? null
                const isWorktreeRunning = worktreeActivityStatus != null
                const branchData = branchDataByWorktreePath[worktree.path] ?? null
                const branchIndicator = resolveSidebarBranchIndicator(branchData)
                const pullRequestIndicator = resolveSidebarPullRequestIndicator(branchData)
                const removeWorktreeDisabledReason = getWorktreeRemovalDisabledReason({
                  worktree,
                })

                return (
                  <div
                    key={worktree.id}
                    className={cn(
                      "group/worktree-row relative",
                      isSelectedWorktree && "bg-[var(--sidebar-item-active)] rounded-md",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => void handleSelectWorktree(project, worktree)}
                      onPointerEnter={() => {
                        if (!isWorktreeReadyForSelection) {
                          return
                        }

                        void prewarmProjectData(
                          worktree.id,
                          worktree.path,
                          hoveredWorktreePrewarmTarget
                        )
                      }}
                      disabled={!isWorktreeReadyForSelection}
                      className={cn(
                        "flex h-8 w-full min-w-0 items-center gap-2 rounded-md pl-8 pr-14 text-left",
                        "text-sidebar-foreground/56 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/80",
                        "group-hover/worktree-row:bg-[var(--sidebar-item-hover)] group-hover/worktree-row:text-sidebar-foreground/80",
                        isWorktreeMenuOpen && "bg-[var(--sidebar-item-hover)] text-sidebar-foreground/80",
                        !isWorktreeReadyForSelection &&
                          "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-sidebar-foreground/56",
                        isSelectedWorktree && "text-sidebar-accent-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-[1em] shrink-0 items-center justify-center text-sm",
                          isWorktreeRunning
                            ? (isSelectedWorktree ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/72")
                            : (branchIndicator?.colorClass ??
                              (isSelectedWorktree
                                ? "text-sidebar-accent-foreground/72"
                                : "text-muted-foreground"))
                        )}
                      >
                        {isWorktreeRunning ? (
                          <LoadingDots
                            variant={
                              worktreeActivityStatus === "connecting" ? "connecting" : "loading"
                            }
                            className="shrink-0"
                          />
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center justify-center text-sm">
                                <GitBranch size="1em" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-72 text-sm leading-5">
                              {branchIndicator?.tooltip ?? worktree.branchName}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                      <TruncatedWorkspaceLabel className="min-w-0 flex-1 truncate text-sm font-medium leading-none">
                        {worktree.name}
                      </TruncatedWorkspaceLabel>
                    </button>

                    {pullRequestIndicator ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "absolute top-1/2 right-8 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-xs transition hover:bg-[var(--sidebar-item-hover)]",
                              pullRequestIndicator.colorClass
                            )}
                            aria-label={pullRequestIndicator.tooltip}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              void desktop.shell.openExternal(pullRequestIndicator.url)
                            }}
                          >
                            <GitPullRequest size="1em" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-72 text-sm leading-5">
                          {pullRequestIndicator.tooltip}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}

                    <DropdownMenu
                      onOpenChange={(open) => handleWorktreeMenuOpenChange(open, worktree)}
                    >
                      <DropdownMenuTrigger
                        className={cn(
                          "absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-sm text-sidebar-foreground/42 transition hover:text-sidebar-foreground/82 focus-visible:text-sidebar-foreground/82",
                          isWorktreeMenuOpen
                            ? "text-sidebar-foreground/72 opacity-100"
                            : "opacity-0 group-hover/worktree-row:opacity-100",
                        )}
                        aria-label={`${worktree.name} settings menu`}
                      >
                        <DotsThree size="1em" weight="bold" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="bottom" align="end" className="w-44">
                        <DropdownMenuItem
                          onClick={() => setWorktreeSettingsTarget({ project, worktree })}
                        >
                          <span>Settings</span>
                        </DropdownMenuItem>
                        {removeWorktreeDisabledReason ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="block">
                                <DropdownMenuItem variant="destructive" disabled>
                                  <span>Remove workspace</span>
                                </DropdownMenuItem>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent
                              side="left"
                              align="center"
                              className="max-w-64 text-sm leading-5"
                            >
                              {removeWorktreeDisabledReason}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => void handleRemoveWorktree(project, worktree)}
                          >
                              <span>Remove workspace</span>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </>
    )

    return (
      <ReorderableProjectItem
        key={project.id}
        project={project}
        isDraggingProject={isDraggingProject}
        enableLayoutAnimation={draggedProjectId !== null}
        onDragStart={() => {
          setDraggedProjectId(project.id)
        }}
        onDragEnd={() => {
          commitProjectOrder()
        }}
      >
        {content}
      </ReorderableProjectItem>
    )
  }

  const sidebarBody = (
    <>
      {/* Body */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      ) : activeView === "settings" ? (
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-2 px-2 pb-2 pt-4">
            <button
              type="button"
              onClick={() => onOpenChat?.()}
              className={cn(expandedRowClass, expandedRowIdleClass)}
            >
              <BackIcon size="1em" className="shrink-0" />
              <span className="truncate">Back to app</span>
            </button>

            <nav aria-label="Settings navigation" className="space-y-1">
              {SETTINGS_SECTION_GROUPS.map((group) => (
                <div key={group.id} className="space-y-1">
                  {group.label ? (
                    <div className="px-2 pt-2 pb-1">
                      <span className={sectionLabelClass}>{group.label}</span>
                    </div>
                  ) : null}

                  {group.sections.map((section) => {
                    const Icon = section.icon
                    const isActive = activeSettingsSection === section.id

                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => onSelectSettingsSection?.(section.id)}
                        className={cn(
                          expandedRowClass,
                          isActive ? expandedRowActiveClass : expandedRowIdleClass,
                        )}
                      >
                        {section.logoKind ? (
                          <ModelLogo kind={section.logoKind} className="size-[1em] shrink-0" />
                        ) : Icon ? (
                          <Icon size="1em" className="shrink-0" />
                        ) : null}
                        <span className="truncate">{section.label}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </nav>
          </div>
        </div>
      ) : (
        <>
          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-2 pb-2 pt-4">
              <div className="mb-2 flex items-center justify-between gap-2 px-2">
                <span className={sectionLabelClass}>Workspaces</span>
                <button
                  type="button"
                  onClick={() => void handleOpenProject()}
                  className="flex h-6 w-6 items-center justify-center rounded text-xs text-sidebar-foreground/40 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/68"
                  aria-label="Add project"
                >
                  <FolderSimplePlus size="1em" />
                </button>
              </div>

              {projects.length === 0 ? (
                <div className="rounded-xl border border-sidebar-border/55 bg-background px-2 py-2 text-center text-sm text-muted-foreground">
                  No workspaces yet.
                  <br />
                  <button
                    type="button"
                    onClick={handleOpenProject}
                    className="mt-1.5 text-primary hover:underline"
                  >
                    Add a project
                  </button>
                </div>
              ) : (
                <Reorder.Group
                  as="div"
                  axis="y"
                  values={orderedProjectIds}
                  onReorder={handleProjectReorder}
                  className="flex flex-col gap-1"
                >
                  {orderedProjectIds.map((projectId) => {
                    const project = projectById.get(projectId)
                    return project ? renderProjectRow(project) : null
                  })}
                </Reorder.Group>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-sidebar-border/50 px-2 py-2">
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
              <GearSix size="1em" className="shrink-0" />
              <span className="truncate">Settings</span>
            </button>
          </div>
        </>
      )}
    </>
  )

  const sidebarModals = (
    <>
      <NewWorkspaceModal
        open={newWorkspaceModalProject !== null}
        project={newWorkspaceModalProject}
        onOpenChange={(open) => {
          if (!open) {
            setNewWorkspaceModalProject(null)
          }
        }}
        onContinue={async (input) => {
          if (!newWorkspaceModalProject) {
            return
          }

          await handleContinueNewWorkspace({
            project: newWorkspaceModalProject,
            prompt: input.prompt,
          })
        }}
      />
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
      <RemoveWorktreeModal
        open={worktreePendingRemoval !== null}
        project={worktreePendingRemoval?.project ?? null}
        worktree={worktreePendingRemoval?.worktree ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setWorktreePendingRemoval(null)
          }
        }}
      />
      <WorkspaceSettingsModal
        open={worktreeSettingsTarget !== null}
        project={worktreeSettingsTarget?.project ?? null}
        worktree={worktreeSettingsTarget?.worktree ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setWorktreeSettingsTarget(null)
          }
        }}
      />
    </>
  )

  return (
    <>
      {isCollapsed ? (
        <>
          <div
            className="fixed top-11 bottom-0 left-0 z-20 hidden md:block"
            style={{ width: COLLAPSED_HOVER_TRIGGER_WIDTH }}
            onMouseEnter={() => setIsHoverPreviewOpen(true)}
          />
          {(isHoverPreviewOpen || draggedProjectId !== null) && (
            <div
              className="fixed top-11 bottom-0 left-0 z-30 flex flex-col overflow-hidden border-r border-sidebar-border/70 bg-sidebar text-sidebar-foreground shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
              style={{ width: `var(${LEFT_SIDEBAR_WIDTH_CSS_VAR}, ${width}px)` }}
              onMouseEnter={() => setIsHoverPreviewOpen(true)}
              onMouseLeave={() => setIsHoverPreviewOpen(false)}
            >
              {sidebarBody}
            </div>
          )}
        </>
      ) : null}

      <SidebarShell
        width={width}
        setWidth={setWidth}
        clampWidth={clampLeftSidebarWidth}
        isCollapsed={isCollapsed}
        side="left"
        sizeConstraintClass="min-w-[240px] max-w-[420px]"
        collapsedWidth={0}
        animateWidth={false}
      >
        <>
          {sidebarBody}
        </>
      </SidebarShell>
      {sidebarModals}
    </>
  )
}
