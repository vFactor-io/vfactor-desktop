import { useEffect, useMemo, useRef, useState } from "react"
import { AutomationsPage } from "@/features/automations/components/AutomationsPage"
import { ChatContainer, NewWorkspaceSetupView, TabBar } from "@/features/chat/components"
import { FileViewer, ProjectDiffViewer } from "@/features/editor/components"
import { SettingsPage } from "@/features/settings/components/SettingsPage"
import { useTabStore } from "@/features/editor/store"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { useChatStore } from "@/features/chat/store"
import { desktop } from "@/desktop/client"
import asciiArtBackground from "@/assets/backgrounds/ascii-art.png"
import { Button } from "@/features/shared/components/ui/button"
import { useProjectStore } from "@/features/workspace/store"
import { openFolderPicker } from "@/features/workspace/utils/folderDialog"
import { Terminal } from "@/features/terminal/components"
import { getTerminalSessionId } from "@/features/terminal/utils/terminalTabs"
import type { Tab } from "@/features/chat/types"
import type { SettingsSectionId } from "@/features/settings/config"
import { QuickStartModal } from "@/features/workspace/components/modals/QuickStartModal"
import { getVisibleTab } from "./mainContentTabs"

interface DiffTabContentProps {
  tab: Tab
}

function DiffTabContent({ tab }: DiffTabContentProps) {
  const { selectedWorktreePath } = useCurrentProjectWorktree()

  return (
    <ProjectDiffViewer
      filename={tab.title}
      projectPath={selectedWorktreePath}
      filePath={tab.filePath}
      previousFilePath={tab.previousFilePath}
    />
  )
}

function TerminalTabContent({ tab }: DiffTabContentProps) {
  const { selectedWorktreePath } = useCurrentProjectWorktree()

  return (
    <Terminal
      sessionId={getTerminalSessionId(tab.id)}
      cwd={selectedWorktreePath}
      className="h-full min-h-0 flex-1 border-t-0"
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
}

function NoWorkspaceSelectedState({
  onOpenProject,
  onCreateProject,
}: {
  onOpenProject: () => void
  onCreateProject: () => void
}) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center px-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={asciiArtBackground}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover object-center opacity-88"
          draggable={false}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,8,23,0.22)_44%,rgba(2,6,23,0.82)_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/58 via-black/28 to-background/72" />
      </div>
      <div className="relative z-10 flex flex-col items-center">
        <h1 className="text-center font-pixel text-4xl tracking-tight text-foreground">
          Build cool sh*t
        </h1>
        <div className="mt-8 flex items-center gap-3">
          <Button type="button" className="cursor-pointer hover:bg-primary/80" onClick={onOpenProject}>
            Open project
          </Button>
          <Button type="button" variant="secondary" className="cursor-pointer hover:bg-muted" onClick={onCreateProject}>
            Create project
          </Button>
        </div>
      </div>
    </div>
  )
}

export function MainContent({ activeView, activeSettingsSection }: MainContentProps) {
  const { focusedProjectId, activeWorktreeId, activeWorktreePath } = useCurrentProjectWorktree()
  const { getProjectChat, openDraftSession, createOptimisticSession, selectSession } = useChatStore()
  const chatStoreInitialized = useChatStore((state) => state.isInitialized)
  const worktreeChat = useChatStore((state) =>
    activeWorktreeId ? state.chatByWorktree[activeWorktreeId] ?? null : null
  )
  const addProject = useProjectStore((state) => state.addProject)
  const newWorkspaceSetupProjectId = useProjectStore((state) => state.newWorkspaceSetupProjectId)
  const [quickStartOpen, setQuickStartOpen] = useState(false)
  const {
    initialize,
    isInitialized,
    switchProject,
    tabs,
    activeTabId,
    openTerminalTab,
    setActiveTab,
    closeTab,
    openChatSession,
    updateChatSessionTitle,
  } = useTabStore()
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

      if (!currentTabs.some((tab) => tab.type === "terminal")) {
        openTerminalTab(activeWorktreeId, false)
      }

      if (!hasChatTab) {
        if (activeSession && !activeChatTab) {
          openChatSession(activeSession.id, activeSession.title)
          return
        }

        if (!activeSession) {
          const optimisticSession = createOptimisticSession(activeWorktreeId, activeWorktreePath)
          if (optimisticSession) {
            lastOpenedSessionIdRef.current = optimisticSession.id
            openChatSession(optimisticSession.id, optimisticSession.title)
          }
        }
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
    createOptimisticSession,
    focusedProjectId,
    activeWorktreePath,
    activeWorktreeId,
    worktreeChat,
    tabs,
    updateChatSessionTitle,
    openTerminalTab,
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
      void desktop.terminal.closeSession(getTerminalSessionId(closingTab.id)).catch((error) => {
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

    if (!nextActiveTab) {
      const optimisticSession = createOptimisticSession(activeWorktreeId, activeWorktreePath)
      if (optimisticSession) {
        openChatSession(optimisticSession.id, optimisticSession.title)
        return
      }
    }

    void openDraftSession(activeWorktreeId, activeWorktreePath)
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
      <main className="flex-1 min-w-80 bg-main-content text-main-content-foreground overflow-hidden flex flex-col">
        <NewWorkspaceSetupView />
      </main>
    )
  }

  if (!activeWorktreeId) {
    return (
      <main className="flex-1 min-w-80 bg-main-content text-main-content-foreground overflow-hidden flex flex-col">
        <NoWorkspaceSelectedState
          onOpenProject={async () => {
            const folderPath = await openFolderPicker()
            if (folderPath) {
              await addProject(folderPath)
            }
          }}
          onCreateProject={() => setQuickStartOpen(true)}
        />
        <QuickStartModal open={quickStartOpen} onOpenChange={setQuickStartOpen} />
      </main>
    )
  }

  return (
    <main className="flex-1 min-w-80 bg-main-content text-main-content-foreground overflow-hidden flex flex-col">
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
