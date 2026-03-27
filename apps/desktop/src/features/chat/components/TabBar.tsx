import { Plus } from "@/components/icons"
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
  return (
    <div className="h-12 bg-sidebar border-b border-sidebar-border flex items-center px-2 gap-1">
      <div className="flex items-center flex-1 overflow-x-auto h-full">
        {tabs.map((tab) => {
          const isClosable = tab.type !== "chat" && onTabClose

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
        className={cn(
          "p-1.5 rounded-md transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
