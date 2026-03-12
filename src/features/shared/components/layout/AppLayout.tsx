import { useState } from "react"
import { LeftSidebar } from "./LeftSidebar"
import { MainContent } from "./MainContent"
import { RightSidebar } from "./RightSidebar"
import { SidebarProvider } from "./SidebarContext"
import { RightSidebarProvider } from "./RightSidebarContext"
import { TitleBar } from "./TitleBar"
import type { SettingsSectionId } from "@/features/settings/config"

export function AppLayout() {
  const [activeView, setActiveView] = useState<"chat" | "settings" | "skills" | "automations">("chat")
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("general")

  return (
    <SidebarProvider>
      <RightSidebarProvider>
        <div className="flex h-screen flex-col overflow-hidden bg-transparent">
          <TitleBar
            activeView={activeView}
            onOpenChat={() => setActiveView("chat")}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <LeftSidebar
              activeView={activeView}
              activeSettingsSection={activeSettingsSection}
              onOpenChat={() => setActiveView("chat")}
              onOpenAutomations={() => setActiveView("automations")}
              onOpenSettings={() => setActiveView("settings")}
              onOpenSkills={() => setActiveView("skills")}
              onSelectSettingsSection={setActiveSettingsSection}
            />
            <MainContent
              activeView={activeView}
              activeSettingsSection={activeSettingsSection}
            />
            <RightSidebar activeView={activeView} />
          </div>
        </div>
      </RightSidebarProvider>
    </SidebarProvider>
  )
}
