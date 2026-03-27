import { AutomationsPage } from "@/features/automations/components/AutomationsPage"
import { ChatContainer, TabBar } from "@/features/chat/components"
import { FileViewer, ProjectDiffViewer } from "@/features/editor/components"
import { SettingsPage } from "@/features/settings/components/SettingsPage"
import { useTabStore } from "@/features/editor/store"
import type { Tab } from "@/features/chat/types"
import type { SettingsSectionId } from "@/features/settings/config"
import { UpdateBanner } from "@/features/updates/components/UpdateBanner"
import { useProjectStore } from "@/features/workspace/store"

interface DiffTabContentProps {
  tab: Tab
}

function DiffTabContent({ tab }: DiffTabContentProps) {
  const { projects, selectedProjectId } = useProjectStore()
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null

  return (
    <ProjectDiffViewer
      filename={tab.title}
      projectPath={selectedProject?.path ?? null}
      filePath={tab.filePath}
      previousFilePath={tab.previousFilePath}
    />
  )
}

interface TabContentProps {
  tab: Tab | undefined
}

function TabContent({ tab }: TabContentProps) {
  if (!tab || tab.type === "chat") {
    return <ChatContainer />
  }

  if (tab.type === "file") {
    return <FileViewer filename={tab.title} filePath={tab.filePath} />
  }

  return <DiffTabContent tab={tab} />
}

const CHAT_TAB: Tab = { id: "chat", type: "chat", title: "Chat" }

interface MainContentProps {
  activeView: "chat" | "settings" | "automations"
  activeSettingsSection: SettingsSectionId
}

export function MainContent({ activeView, activeSettingsSection }: MainContentProps) {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabStore()

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

  const tabsWithChat = [CHAT_TAB, ...tabs.filter((tab) => tab.type !== "chat")]
  const activeTab = tabsWithChat.find((tab) => tab.id === activeTabId) ?? CHAT_TAB
  const isChatTab = activeTab.type === "chat"

  return (
    <main className="flex-1 min-w-80 bg-main-content text-main-content-foreground overflow-hidden flex flex-col">
      <UpdateBanner />
      {!isChatTab && (
        <TabBar
          tabs={tabsWithChat}
          activeTabId={activeTabId ?? CHAT_TAB.id}
          onTabChange={setActiveTab}
          onTabClose={closeTab}
        />
      )}
      <div className="flex-1 overflow-hidden">
        <TabContent tab={activeTab} />
      </div>
    </main>
  )
}
