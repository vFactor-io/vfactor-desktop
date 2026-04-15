import { useState } from "react"
import { LeftSidebar } from "./LeftSidebar"
import { MainContent } from "./MainContent"
import { RightSidebar } from "./RightSidebar"
import { SidebarProvider } from "./SidebarContext"
import { RightSidebarProvider } from "./RightSidebarContext"
import { CenterToolbar } from "./CenterToolbar"
import type { SettingsSectionId } from "@/features/settings/config"
import { AppUpdateBootstrap } from "@/features/updates/components/AppUpdateBootstrap"
import { UpdateBlockedDialog } from "@/features/updates/components/UpdateBlockedDialog"
import { UpdateReadyToast } from "@/features/updates/components/UpdateReadyToast"
import { HarnessBootstrap } from "@/features/chat/components/HarnessBootstrap"
import { MIN_MAIN_CONTENT_WIDTH } from "./layoutSizing"

export function AppLayout() {
  const [activeView, setActiveView] = useState<"chat" | "settings" | "automations">("chat")
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("git")

  return (
    <SidebarProvider>
      <RightSidebarProvider>
        <HarnessBootstrap />
        <AppUpdateBootstrap />
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <LeftSidebar
            activeView={activeView}
            activeSettingsSection={activeSettingsSection}
            onOpenChat={() => setActiveView("chat")}
            onOpenAutomations={() => setActiveView("automations")}
            onOpenSettings={() => setActiveView("settings")}
            onSelectSettingsSection={setActiveSettingsSection}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <CenterToolbar activeView={activeView} />
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex flex-1 flex-col" style={{ minWidth: `${MIN_MAIN_CONTENT_WIDTH}px` }}>
                <MainContent
                  activeView={activeView}
                  activeSettingsSection={activeSettingsSection}
                />
              </div>
              <RightSidebar activeView={activeView} />
            </div>
          </div>
        </div>
        <UpdateReadyToast />
        <UpdateBlockedDialog />
      </RightSidebarProvider>
    </SidebarProvider>
  )
}
