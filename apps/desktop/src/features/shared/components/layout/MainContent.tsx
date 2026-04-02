import { useEffect, useMemo, useRef, useState } from "react"
import { AutomationsPage } from "@/features/automations/components/AutomationsPage"
import { ChatContainer, TabBar } from "@/features/chat/components"
import { FileViewer, ProjectDiffViewer } from "@/features/editor/components"
import { SettingsPage } from "@/features/settings/components/SettingsPage"
import { useTabStore } from "@/features/editor/store"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { useChatStore } from "@/features/chat/store"
import { NucleusLogo } from "@/components/NucleusLogo"
import asciiArtBackground from "@/assets/backgrounds/ascii-art.png"
import { Button } from "@/features/shared/components/ui/button"
import { useProjectStore } from "@/features/workspace/store"
import { openFolderPicker } from "@/features/workspace/utils/folderDialog"
import type { Tab } from "@/features/chat/types"
import type { SettingsSectionId } from "@/features/settings/config"
import { UpdateBanner } from "@/features/updates/components/UpdateBanner"
import { QuickStartModal } from "@/features/workspace/components/modals/QuickStartModal"

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
        <NucleusLogo className="size-20" />
        <h1 className="mt-5 font-pixel text-4xl tracking-tight text-foreground">
          Nucleus
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
  const addProject = useProjectStore((state) => state.addProject)
  const [quickStartOpen, setQuickStartOpen] = useState(false)
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

    switchProject(activeWorktreeId)
  }, [activeWorktreeId, isInitialized, switchProject])

  useEffect(() => {
    if (!isInitialized || !focusedProjectId || !activeWorktreeId || !activeWorktreePath) {
      lastInitializedWorktreeIdRef.current = null
      lastOpenedSessionIdRef.current = null
      return
    }

    const worktreeChat = getProjectChat(activeWorktreeId)
    const currentTabs = useTabStore.getState().tabs
    const activeSession =
      worktreeChat.sessions.find((session) => session.id === worktreeChat.activeSessionId) ??
      worktreeChat.sessions[0] ??
      null

    const activeChatTab = useTabStore
      .getState()
      .tabs.find((tab) => tab.type === "chat-session" && tab.sessionId === activeSession?.id)

    if (lastInitializedWorktreeIdRef.current !== activeWorktreeId) {
      lastInitializedWorktreeIdRef.current = activeWorktreeId
      lastOpenedSessionIdRef.current = activeSession?.id ?? null

      if (!currentTabs.length) {
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
    createOptimisticSession,
    focusedProjectId,
    activeWorktreePath,
    activeWorktreeId,
    tabs,
    updateChatSessionTitle,
  ])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs]
  )

  useEffect(() => {
    if (!activeWorktreeId || activeTab?.type !== "chat-session" || !activeTab.sessionId) {
      return
    }

    void selectSession(activeWorktreeId, activeTab.sessionId)
  }, [activeTab, activeWorktreeId, selectSession])

  const handleTabClose = (tabId: string) => {
    const closingTab = tabs.find((tab) => tab.id === tabId)
    const remainingTabs = tabs.filter((tab) => tab.id !== tabId)
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

  if (!activeWorktreeId) {
    return (
      <main className="flex-1 min-w-80 bg-main-content text-main-content-foreground overflow-hidden flex flex-col">
        <UpdateBanner />
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
