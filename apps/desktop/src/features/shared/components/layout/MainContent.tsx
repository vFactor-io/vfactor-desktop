import { useEffect, useMemo, useRef } from "react"
import { AutomationsPage } from "@/features/automations/components/AutomationsPage"
import { ChatContainer, TabBar } from "@/features/chat/components"
import { FileViewer, ProjectDiffViewer } from "@/features/editor/components"
import { SettingsPage } from "@/features/settings/components/SettingsPage"
import { useTabStore } from "@/features/editor/store"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { useChatStore } from "@/features/chat/store"
import type { Tab } from "@/features/chat/types"
import type { SettingsSectionId } from "@/features/settings/config"
import { UpdateBanner } from "@/features/updates/components/UpdateBanner"

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

interface TabContentProps {
  tab: Tab | undefined
}

function TabContent({ tab }: TabContentProps) {
  if (!tab || tab.type === "chat-session") {
    return <ChatContainer />
  }

  if (tab.type === "file") {
    return <FileViewer filename={tab.title} filePath={tab.filePath} />
  }

  return <DiffTabContent tab={tab} />
}
interface MainContentProps {
  activeView: "chat" | "settings" | "automations"
  activeSettingsSection: SettingsSectionId
}

export function MainContent({ activeView, activeSettingsSection }: MainContentProps) {
  const { selectedProjectId, selectedWorktreeId, selectedWorktreePath } = useCurrentProjectWorktree()
  const { getProjectChat, openDraftSession, selectSession } = useChatStore()
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
  const lastInitializedWorktreeIdRef = useRef<string | null>(null)
  const lastOpenedSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    if (!isInitialized) {
      return
    }

    switchProject(selectedWorktreeId)
  }, [isInitialized, selectedWorktreeId, switchProject])

  useEffect(() => {
    if (!isInitialized || !selectedProjectId || !selectedWorktreePath) {
      lastInitializedWorktreeIdRef.current = null
      lastOpenedSessionIdRef.current = null
      return
    }

    const worktreeChat = getProjectChat(selectedProjectId)
    const currentTabs = useTabStore.getState().tabs
    const activeSession =
      worktreeChat.sessions.find((session) => session.id === worktreeChat.activeSessionId) ??
      worktreeChat.sessions[0] ??
      null

    const activeChatTab = useTabStore
      .getState()
      .tabs.find((tab) => tab.type === "chat-session" && tab.sessionId === activeSession?.id)

    if (lastInitializedWorktreeIdRef.current !== selectedWorktreeId) {
      lastInitializedWorktreeIdRef.current = selectedWorktreeId
      lastOpenedSessionIdRef.current = activeSession?.id ?? null

      if (!currentTabs.length && activeSession && !activeChatTab) {
        openChatSession(activeSession.id, activeSession.title)
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

      const matchingSession = worktreeChat.sessions.find((session) => session.id === tab.sessionId)
      const nextTitle = matchingSession?.title?.trim() || "New chat"
      if (matchingSession && nextTitle !== tab.title) {
        updateChatSessionTitle(tab.sessionId, matchingSession.title)
      }
    }
  }, [
    getProjectChat,
    isInitialized,
    openChatSession,
    selectedProjectId,
    selectedWorktreePath,
    selectedWorktreeId,
    tabs,
    updateChatSessionTitle,
  ])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs]
  )

  useEffect(() => {
    if (!selectedProjectId || activeTab?.type !== "chat-session" || !activeTab.sessionId) {
      return
    }

    void selectSession(selectedProjectId, activeTab.sessionId)
  }, [activeTab, selectSession, selectedProjectId])

  const handleTabClose = (tabId: string) => {
    const closingTab = tabs.find((tab) => tab.id === tabId)
    const remainingTabs = tabs.filter((tab) => tab.id !== tabId)
    closeTab(tabId)

    if (!selectedProjectId || !selectedWorktreePath || closingTab?.type !== "chat-session") {
      return
    }

    if (activeTabId !== tabId) {
      return
    }

    const nextActiveTab = remainingTabs[remainingTabs.length - 1] ?? null
    if (nextActiveTab?.type === "chat-session" && nextActiveTab.sessionId) {
      void selectSession(selectedProjectId, nextActiveTab.sessionId)
      return
    }

    void openDraftSession(selectedProjectId, selectedWorktreePath)
  }

  if (activeView === "settings") {
    return (
      <main className="flex-1 min-w-80 bg-main-content text-main-content-foreground overflow-hidden flex flex-col">
        <UpdateBanner />
        <SettingsPage activeSection={activeSettingsSection} />
      </main>
    )
  }

  if (activeView === "automations") {
    return (
      <main className="flex-1 min-w-80 bg-main-content text-main-content-foreground overflow-hidden flex flex-col">
        <UpdateBanner />
        <AutomationsPage />
      </main>
    )
  }
  return (
    <main className="flex-1 min-w-80 bg-main-content text-main-content-foreground overflow-hidden flex flex-col">
      <UpdateBanner />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId ?? tabs[0]?.id ?? ""}
        onTabChange={setActiveTab}
        onTabClose={handleTabClose}
      />
      <div className="flex-1 overflow-hidden">
        <TabContent tab={activeTab} />
      </div>
    </main>
  )
}
