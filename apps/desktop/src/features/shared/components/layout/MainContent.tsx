import { useEffect, useMemo, useRef, useState } from "react"
import { Reorder } from "framer-motion"
import { GearSix, GitBranch, Plus } from "@/components/icons"
import { AutomationsPage } from "@/features/automations/components/AutomationsPage"
import { ChatContainer, NewWorkspaceSetupView, TabBar } from "@/features/chat/components"
import { FileViewer, ProjectDiffViewer } from "@/features/editor/components"
import { SettingsPage } from "@/features/settings/components/SettingsPage"
import { useTabStore } from "@/features/editor/store"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { LoadingDots } from "@/features/shared/components/ui/loading-dots"
import { useChatStore } from "@/features/chat/store"
import { desktop } from "@/desktop/client"
import { Button } from "@/features/shared/components/ui/button"
import { useProjectStore } from "@/features/workspace/store"
import { ProjectIcon } from "@/features/workspace/components/ProjectIcon"
import type { Project, ProjectWorktree } from "@/features/workspace/types"
import { openFolderPicker } from "@/features/workspace/utils/folderDialog"
import { isWorktreeReady } from "@/features/workspace/utils/worktrees"
import { cn } from "@/lib/utils"
import { Terminal } from "@/features/terminal/components"
import { disposeCachedTerminalSession } from "@/features/terminal/components/terminalSessionCache"
import { getTerminalSessionId } from "@/features/terminal/utils/terminalTabs"
import type { Tab } from "@/features/chat/types"
import type { SettingsSectionId } from "@/features/settings/config"
import { getVisibleTab } from "./mainContentTabs"

interface DiffTabContentProps {
  tab: Tab
}

function useRenderedWorktreePath() {
  const currentWorktreeId = useTabStore((state) => state.currentWorktreeId)
  const projects = useProjectStore((state) => state.projects)

  return useMemo(() => {
    if (!currentWorktreeId) {
      return null
    }

    for (const project of projects) {
      const worktree = project.worktrees.find((candidate) => candidate.id === currentWorktreeId)
      if (worktree) {
        return worktree.path
      }
    }

    return null
  }, [currentWorktreeId, projects])
}

function DiffTabContent({ tab }: DiffTabContentProps) {
  const renderedWorktreePath = useRenderedWorktreePath()

  return (
    <ProjectDiffViewer
      filename={tab.title}
      projectPath={renderedWorktreePath}
      filePath={tab.filePath}
      previousFilePath={tab.previousFilePath}
    />
  )
}

function TerminalTabContent({ tab }: DiffTabContentProps) {
  const renderedWorktreePath = useRenderedWorktreePath()

  return (
    <Terminal
      sessionId={getTerminalSessionId(tab.id)}
      cwd={renderedWorktreePath}
      className="h-full min-h-0 flex-1 border-t-0"
      padded={false}
    />
  )
}

interface TabContentProps {
  tab: Tab | undefined
}

function TabContent({ tab }: TabContentProps) {
  if (!tab || tab.type === "chat-session") {
    return <ChatContainer sessionId={tab?.type === "chat-session" ? tab.sessionId ?? null : null} />
  }

  if (tab.type === "file") {
    return <FileViewer filename={tab.title} filePath={tab.filePath} />
  }

  if (tab.type === "terminal") {
    return <TerminalTabContent tab={tab} />
  }

  return <DiffTabContent tab={tab} />
}
interface MainContentProps {
  activeView: "chat" | "settings" | "automations"
  activeSettingsSection: SettingsSectionId
  onOpenSettings?: () => void
}

function haveProjectIdsChangedOrder(nextProjectIds: string[], currentProjects: Project[]) {
  return nextProjectIds.some((projectId, index) => projectId !== currentProjects[index]?.id)
}

function NoWorkspaceSelectedState({
  onOpenProject,
  projects,
  isLoading,
  onSelectWorktree,
  onReorderProjects,
  onOpenSettings,
}: {
  onOpenProject: () => void
  projects: Project[]
  isLoading: boolean
  onSelectWorktree: (projectId: string, worktreeId: string) => Promise<void>
  onReorderProjects: (projects: Project[]) => Promise<void>
  onOpenSettings?: () => void
}) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() =>
    projects.map((project) => project.id)
  )
  const [projectOrderPreview, setProjectOrderPreview] = useState<string[] | null>(null)
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null)
  const projectOrderPreviewRef = useRef<string[] | null>(null)
  const enableLayoutAnimation = draggedProjectId !== null

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  )
  const orderedProjectIds = projectOrderPreview ?? projects.map((project) => project.id)

  useEffect(() => {
    setExpandedProjectIds((currentIds) => {
      const validProjectIds = new Set(projects.map((project) => project.id))
      const nextIds = currentIds.filter((projectId) => validProjectIds.has(projectId))

      for (const project of projects) {
        if (!nextIds.includes(project.id)) {
          nextIds.push(project.id)
        }
      }

      const hasChanged =
        nextIds.length !== currentIds.length ||
        nextIds.some((projectId, index) => projectId !== currentIds[index])

      return hasChanged ? nextIds : currentIds
    })
  }, [projects])

  useEffect(() => {
    if (!draggedProjectId) {
      setProjectOrderPreview(null)
      projectOrderPreviewRef.current = null
    }
  }, [draggedProjectId, projects])

  const handleToggleProjectExpanded = (projectId: string) => {
    setExpandedProjectIds((currentIds) =>
      currentIds.includes(projectId)
        ? currentIds.filter((currentId) => currentId !== projectId)
        : [...currentIds, projectId]
    )
  }

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
    void onReorderProjects(nextProjects)
  }

  const renderWorktreeRow = (project: Project, worktree: ProjectWorktree) => {
    const isReady = isWorktreeReady(worktree)

    return (
      <button
        key={worktree.id}
        type="button"
        onClick={() => void onSelectWorktree(project.id, worktree.id)}
        disabled={!isReady}
        className={cn(
          "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition",
          "text-sidebar-foreground/60 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/88",
          !isReady && "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-sidebar-foreground/60"
        )}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center text-sidebar-foreground/48">
          {isReady ? <GitBranch size={13} /> : <LoadingDots className="shrink-0" />}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <span className="truncate text-[13px] font-medium leading-none text-sidebar-foreground/86">
            {worktree.name}
          </span>
          <span className="shrink-0 text-sidebar-foreground/24">
            •
          </span>
          <span className="truncate text-[11px] leading-none text-sidebar-foreground/42">
            {isReady ? worktree.branchName : "Workspace still getting ready"}
          </span>
        </span>
      </button>
    )
  }

  return (
    <div className="chat-start-surface flex h-full items-center justify-center px-6 py-8">
      <div className="flex h-[calc(100vh-5rem)] max-h-[720px] min-h-[420px] w-full max-w-[784px] min-w-0 flex-col text-sidebar-foreground">
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <h1 className="font-pixel text-[26px] tracking-tight text-sidebar-foreground">
              Build cool shit
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 rounded-xl text-sidebar-foreground/68 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
              onClick={onOpenSettings}
              aria-label="Open settings"
            >
              <GearSix size={16} />
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0 gap-2 rounded-xl bg-sidebar-accent px-3 text-sidebar-accent-foreground hover:bg-sidebar-accent/88"
              onClick={onOpenProject}
            >
              <Plus size={14} />
              Add project
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-sidebar-foreground/40">
            Projects
          </div>

          {isLoading ? (
            <div className="mt-4 px-1 py-6 text-sm text-sidebar-foreground/58">
              Loading projects...
            </div>
          ) : null}

          {!isLoading && projects.length === 0 ? (
            <div className="mt-4 px-1 py-6 text-sm text-sidebar-foreground/58">
              Add a project to start building.
            </div>
          ) : null}

          {!isLoading ? (
            <Reorder.Group
              axis="y"
              values={orderedProjectIds}
              onReorder={handleProjectReorder}
              className="mt-3 divide-y divide-sidebar-border/45"
            >
              {orderedProjectIds.map((projectId) => {
                const project = projectById.get(projectId)
                if (!project) {
                  return null
                }

                const isExpanded = expandedProjectIds.includes(project.id)

                return (
                  <Reorder.Item
                    key={project.id}
                    value={project.id}
                    className={cn(
                      "py-1 cursor-grab active:cursor-grabbing",
                      draggedProjectId === project.id && "opacity-65"
                    )}
                    layout="position"
                    transition={{
                      layout: enableLayoutAnimation
                        ? { type: "spring", stiffness: 560, damping: 42, mass: 0.55 }
                        : { duration: 0 },
                    }}
                    whileDrag={{ zIndex: 20 }}
                    onDragStart={() => setDraggedProjectId(project.id)}
                    onDragEnd={commitProjectOrder}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleProjectExpanded(project.id)}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition",
                        "text-sidebar-foreground/74 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/92"
                      )}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent/55">
                        <ProjectIcon
                          project={project}
                          isExpanded={isExpanded}
                          size={13}
                          className="text-sidebar-foreground/72"
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                        <span className="truncate text-[13px] font-medium leading-none text-sidebar-foreground/90">
                          {project.name}
                        </span>
                        <span className="shrink-0 text-sidebar-foreground/24">
                          •
                        </span>
                        <span className="truncate text-[11px] leading-none text-sidebar-foreground/42">
                          {project.path}
                        </span>
                      </span>
                    </button>

                    {isExpanded ? (
                      <div className="px-1 pt-0.5 pb-1">
                        {project.worktrees.length > 0 ? (
                          <div className="space-y-0.5">
                            {project.worktrees.map((worktree) => renderWorktreeRow(project, worktree))}
                          </div>
                        ) : (
                          <div className="px-2 py-1 text-sm text-sidebar-foreground/42">
                            No workspaces yet.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </Reorder.Item>
                )
              })}
            </Reorder.Group>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function MainContent({ activeView, activeSettingsSection, onOpenSettings }: MainContentProps) {
  const { focusedProjectId, activeWorktreeId, activeWorktreePath } = useCurrentProjectWorktree()
  const { getProjectChat, selectSession } = useChatStore()
  const chatStoreInitialized = useChatStore((state) => state.isInitialized)
  const worktreeChat = useChatStore((state) =>
    activeWorktreeId ? state.chatByWorktree[activeWorktreeId] ?? null : null
  )
  const addProject = useProjectStore((state) => state.addProject)
  const projects = useProjectStore((state) => state.projects)
  const projectStoreLoading = useProjectStore((state) => state.isLoading)
  const setProjectOrder = useProjectStore((state) => state.setProjectOrder)
  const selectWorktree = useProjectStore((state) => state.selectWorktree)
  const newWorkspaceSetupProjectId = useProjectStore((state) => state.newWorkspaceSetupProjectId)
  const {
    initialize,
    isInitialized,
    switchProject,
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    openChatSession,
    updateChatSessionTitle,
  } = useTabStore()
  const isWorkspaceSetupActive = focusedProjectId != null && newWorkspaceSetupProjectId === focusedProjectId
  const lastInitializedWorktreeIdRef = useRef<string | null>(null)
  const lastOpenedSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    if (!isInitialized) {
      return
    }

    switchProject(activeWorktreeId)
  }, [activeWorktreeId, isInitialized, switchProject])

  useEffect(() => {
    if (
      !isInitialized ||
      !chatStoreInitialized ||
      isWorkspaceSetupActive ||
      !focusedProjectId ||
      !activeWorktreeId ||
      !activeWorktreePath
    ) {
      lastInitializedWorktreeIdRef.current = null
      lastOpenedSessionIdRef.current = null
      return
    }

    const resolvedWorktreeChat = worktreeChat ?? getProjectChat(activeWorktreeId)
    const currentTabs = useTabStore.getState().tabs
    const hasChatTab = currentTabs.some((tab) => tab.type === "chat-session")
    const activeSession =
      resolvedWorktreeChat.sessions.find((session) => session.id === resolvedWorktreeChat.activeSessionId) ??
      resolvedWorktreeChat.sessions[0] ??
      null

    const activeChatTab = useTabStore
      .getState()
      .tabs.find((tab) => tab.type === "chat-session" && tab.sessionId === activeSession?.id)

    if (lastInitializedWorktreeIdRef.current !== activeWorktreeId) {
      lastInitializedWorktreeIdRef.current = activeWorktreeId
      lastOpenedSessionIdRef.current = activeSession?.id ?? null

      if (!hasChatTab && activeSession && !activeChatTab) {
        openChatSession(activeSession.id, activeSession.title)
        return
      }
      return
    }

    if (
      activeSession &&
      activeSession.id !== lastOpenedSessionIdRef.current &&
      !activeChatTab
    ) {
      openChatSession(activeSession.id, activeSession.title)
    }

    lastOpenedSessionIdRef.current = activeSession?.id ?? null

    for (const tab of tabs) {
      if (tab.type !== "chat-session" || !tab.sessionId) {
        continue
      }

      const matchingSession = resolvedWorktreeChat.sessions.find((session) => session.id === tab.sessionId)
      const nextTitle = matchingSession?.title?.trim() || "New chat"
      if (matchingSession && nextTitle !== tab.title) {
        updateChatSessionTitle(tab.sessionId, matchingSession.title)
      }
    }
  }, [
    getProjectChat,
    isInitialized,
    chatStoreInitialized,
    openChatSession,
    focusedProjectId,
    activeWorktreePath,
    activeWorktreeId,
    worktreeChat,
    tabs,
    updateChatSessionTitle,
    isWorkspaceSetupActive,
  ])

  const activeTab = useMemo(
    () => getVisibleTab(tabs, activeTabId),
    [activeTabId, tabs]
  )

  useEffect(() => {
    if (
      !chatStoreInitialized ||
      !activeWorktreeId ||
      activeTab?.type !== "chat-session" ||
      !activeTab.sessionId
    ) {
      return
    }

    const resolvedWorktreeChat = worktreeChat ?? getProjectChat(activeWorktreeId)
    if (!resolvedWorktreeChat.sessions.some((session) => session.id === activeTab.sessionId)) {
      return
    }

    void selectSession(activeWorktreeId, activeTab.sessionId)
  }, [activeTab, activeWorktreeId, chatStoreInitialized, getProjectChat, selectSession, worktreeChat])

  const handleTabClose = (tabId: string) => {
    const closingTab = tabs.find((tab) => tab.id === tabId)
    const remainingTabs = tabs.filter((tab) => tab.id !== tabId)

    if (closingTab?.type === "terminal") {
      const terminalSessionId = getTerminalSessionId(closingTab.id)
      disposeCachedTerminalSession(terminalSessionId)
      void desktop.terminal.closeSession(terminalSessionId).catch((error) => {
        console.error("Failed to close terminal session:", error)
      })
    }

    closeTab(tabId)

    if (!focusedProjectId || !activeWorktreeId || !activeWorktreePath || closingTab?.type !== "chat-session") {
      return
    }

    if (activeTabId !== tabId) {
      return
    }

    const nextActiveTab = remainingTabs[remainingTabs.length - 1] ?? null
    if (nextActiveTab?.type === "chat-session" && nextActiveTab.sessionId) {
      void selectSession(activeWorktreeId, nextActiveTab.sessionId)
      return
    }
  }

  if (activeView === "settings") {
    return (
      <main className="flex-1 min-w-80 bg-main-content text-main-content-foreground overflow-hidden flex flex-col">
        <SettingsPage activeSection={activeSettingsSection} />
      </main>
    )
  }

  if (activeView === "automations") {
    return (
      <main className="flex-1 min-w-80 bg-main-content text-main-content-foreground overflow-hidden flex flex-col">
        <AutomationsPage />
      </main>
    )
  }

  if (focusedProjectId && newWorkspaceSetupProjectId === focusedProjectId) {
    return (
      <main className="chat-main-surface flex-1 min-w-80 text-main-content-foreground overflow-hidden flex flex-col">
        <NewWorkspaceSetupView />
      </main>
    )
  }

  if (!activeWorktreeId) {
    return (
      <main className="chat-main-surface flex-1 min-w-80 text-main-content-foreground overflow-hidden flex flex-col">
        <NoWorkspaceSelectedState
          onOpenProject={async () => {
            const folderPath = await openFolderPicker()
            if (folderPath) {
              await addProject(folderPath)
            }
          }}
          projects={projects}
          isLoading={projectStoreLoading}
          onSelectWorktree={selectWorktree}
          onReorderProjects={setProjectOrder}
          onOpenSettings={onOpenSettings}
        />
      </main>
    )
  }

  return (
    <main className="chat-main-surface flex-1 min-w-80 text-main-content-foreground overflow-hidden flex flex-col">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId ?? ""}
        onTabChange={setActiveTab}
        onTabClose={handleTabClose}
      />
      <div className="flex-1 overflow-hidden">
        <TabContent tab={activeTab} />
      </div>
    </main>
  )
}
