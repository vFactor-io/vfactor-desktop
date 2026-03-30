import { Plus } from "@/components/icons"
import { useChatStore } from "@/features/chat/store"
import { useTabStore } from "@/features/editor/store"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { cn } from "@/lib/utils"
import { TabItem } from "./TabItem"
import type { Tab } from "../types"

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string
  onTabChange: (tabId: string) => void
  onTabClose?: (tabId: string) => void
}

export function TabBar({ tabs, activeTabId, onTabChange, onTabClose }: TabBarProps) {
  const { selectedProjectId, selectedWorktreePath } = useCurrentProjectWorktree()
  const createOptimisticSession = useChatStore((state) => state.createOptimisticSession)
  const openChatSession = useTabStore((state) => state.openChatSession)

  return (
    <div className="h-12 bg-sidebar border-b border-sidebar-border flex items-center px-2 gap-1">
      <div className="flex items-center flex-1 overflow-x-auto h-full">
        {tabs.map((tab) => {
          const isClosable = Boolean(onTabClose)

          return (
            <TabItem
              key={tab.id}
              type={tab.type}
              title={tab.title}
              isActive={tab.id === activeTabId}
              onClick={() => onTabChange(tab.id)}
              onClose={isClosable ? () => onTabClose?.(tab.id) : undefined}
            />
          )
        })}
      </div>

      <button
        type="button"
        aria-label="Add new tab"
        disabled={!selectedProjectId || !selectedWorktreePath}
        onClick={() => {
          if (!selectedProjectId || !selectedWorktreePath) {
            return
          }

          const session = createOptimisticSession(selectedProjectId, selectedWorktreePath)
          if (session) {
            openChatSession(session.id, session.title)
          }
        }}
        className={cn(
          "p-1.5 rounded-md transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
