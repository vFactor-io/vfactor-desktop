import { Plus } from "@/components/icons"
import { useChatStore } from "@/features/chat/store"
import { useTabStore } from "@/features/editor/store"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { cn } from "@/lib/utils"
import { TabItem } from "./TabItem"
import type { HarnessId, Tab } from "../types"

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string
  onTabChange: (tabId: string) => void
  onTabClose?: (tabId: string) => void
}

export function TabBar({ tabs, activeTabId, onTabChange, onTabClose }: TabBarProps) {
  const { selectedWorktreeId, selectedWorktreePath } = useCurrentProjectWorktree()
  const createOptimisticSession = useChatStore((state) => state.createOptimisticSession)
  const getProjectChat = useChatStore((state) => state.getProjectChat)
  const openChatSession = useTabStore((state) => state.openChatSession)

  const worktreeChat = selectedWorktreeId ? getProjectChat(selectedWorktreeId) : null

  return (
    <div className="flex h-10 items-center border-b border-sidebar-border bg-sidebar px-2 gap-0.5">
      <div className="flex items-center flex-1 overflow-x-auto h-full gap-0.5">
        {tabs.map((tab) => {
          let harnessId: HarnessId | undefined
          if (tab.type === "chat-session" && tab.sessionId && worktreeChat) {
            const session = worktreeChat.sessions.find((s) => s.id === tab.sessionId)
            harnessId = session?.harnessId
          }

          return (
            <TabItem
              key={tab.id}
              type={tab.type}
              title={tab.title}
              harnessId={harnessId}
              isActive={tab.id === activeTabId}
              onClick={() => onTabChange(tab.id)}
              onClose={onTabClose ? () => onTabClose(tab.id) : undefined}
            />
          )
        })}
      </div>

      <button
        type="button"
        aria-label="Add new tab"
        disabled={!selectedWorktreeId || !selectedWorktreePath}
        onClick={() => {
          if (!selectedWorktreeId || !selectedWorktreePath) {
            return
          }

          const session = createOptimisticSession(selectedWorktreeId, selectedWorktreePath)
          if (session) {
            openChatSession(session.id, session.title)
          }
        }}
        className={cn(
          "p-1 rounded-md transition-colors shrink-0",
          "text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
