import { ChatCircle, Plus, Terminal } from "@/components/icons"
import { useChatStore } from "@/features/chat/store"
import { useTabStore } from "@/features/editor/store"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import { Reorder } from "framer-motion"
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { getTerminalTabLabel } from "@/features/terminal/utils/terminalTabs"
import { TabItem } from "./TabItem"
import type { HarnessId, Tab } from "../types"

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string
  onTabChange: (tabId: string) => void
  onTabClose?: (tabId: string) => void
}

function haveTabIdsChangedOrder(nextTabIds: string[], currentTabs: Tab[]) {
  return nextTabIds.some((tabId, index) => tabId !== currentTabs[index]?.id)
}

export function TabBar({ tabs, activeTabId, onTabChange, onTabClose }: TabBarProps) {
  const { selectedWorktreeId, selectedWorktreePath } = useCurrentProjectWorktree()
  const createOptimisticSession = useChatStore((state) => state.createOptimisticSession)
  const getProjectChat = useChatStore((state) => state.getProjectChat)
  const sessionActivityById = useChatStore((state) => state.sessionActivityById)
  const openChatSession = useTabStore((state) => state.openChatSession)
  const openTerminalTab = useTabStore((state) => state.openTerminalTab)
  const reorderTabs = useTabStore((state) => state.reorderTabs)

  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [tabOrderPreview, setTabOrderPreview] = useState<string[] | null>(null)
  const tabOrderRef = useRef<string[] | null>(null)

  const tabById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs])
  const tabIds = tabs.map((tab) => tab.id)
  const orderedTabIds = useMemo(() => {
    if (!tabOrderPreview) {
      return tabIds
    }

    const validTabIds = new Set(tabIds)
    const previewTabIds = tabOrderPreview.filter((tabId) => validTabIds.has(tabId))
    const previewTabIdSet = new Set(previewTabIds)
    const missingTabIds = tabIds.filter((tabId) => !previewTabIdSet.has(tabId))

    return [...previewTabIds, ...missingTabIds]
  }, [tabIds, tabOrderPreview])

  useEffect(() => {
    if (!draggedTabId) {
      setTabOrderPreview(null)
      tabOrderRef.current = null
    }
  }, [draggedTabId, tabs])

  const handleReorder = (nextTabIds: string[]) => {
    setTabOrderPreview(nextTabIds)
    tabOrderRef.current = nextTabIds
  }

  const commitTabOrder = () => {
    const nextTabIds = tabOrderRef.current
    if (nextTabIds && haveTabIdsChangedOrder(nextTabIds, tabs)) {
      reorderTabs(nextTabIds)
    }
    setDraggedTabId(null)
  }

  const worktreeChat = selectedWorktreeId ? getProjectChat(selectedWorktreeId) : null

  const handleCreateChatTab = () => {
    if (!selectedWorktreeId || !selectedWorktreePath) {
      return
    }

    const session = createOptimisticSession(selectedWorktreeId, selectedWorktreePath)
    if (session) {
      openChatSession(session.id, session.title)
    }
  }

  const handleCreateTerminalTab = () => {
    if (!selectedWorktreeId) {
      return
    }

    openTerminalTab(selectedWorktreeId)
  }

  return (
    <div className="flex h-10 items-center border-b border-sidebar-border bg-sidebar px-2 gap-0.5">
      <div className="flex h-full flex-1 items-center overflow-x-auto gap-0.5">
        <Reorder.Group
          as="div"
          axis="x"
          values={orderedTabIds}
          onReorder={handleReorder}
          className="flex h-full items-center gap-0.5"
        >
          {orderedTabIds.map((tabId) => {
            const tab = tabById.get(tabId)
            if (!tab) {
              return null
            }

            let harnessId: HarnessId | undefined
            const sessionActivity =
              tab.type === "chat-session" && tab.sessionId
                ? sessionActivityById[tab.sessionId]
                : null
            if (tab.type === "chat-session" && tab.sessionId && worktreeChat) {
              const session = worktreeChat.sessions.find((s) => s.id === tab.sessionId)
              harnessId = session?.harnessId
            }

            return (
              <Reorder.Item
                as="div"
                key={tab.id}
                value={tab.id}
                layout="position"
                transition={{
                  layout: { type: "spring", stiffness: 560, damping: 42, mass: 0.55 },
                }}
                whileDrag={{
                  zIndex: 20,
                  cursor: "grabbing",
                }}
                className={cn(
                  "cursor-grab active:cursor-grabbing",
                  draggedTabId === tab.id && "opacity-65"
                )}
                onDragStart={() => setDraggedTabId(tab.id)}
                onDragEnd={commitTabOrder}
              >
                <TabItem
                  type={tab.type}
                  title={tab.type === "terminal" ? getTerminalTabLabel(tab, tabs) : tab.title}
                  harnessId={harnessId}
                  activityStatus={sessionActivity?.status}
                  hasUnread={sessionActivity?.unread}
                  isActive={tab.id === activeTabId}
                  onClick={() => onTabChange(tab.id)}
                  onClose={onTabClose ? () => onTabClose(tab.id) : undefined}
                />
              </Reorder.Item>
            )
          })}
        </Reorder.Group>

        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!selectedWorktreeId}
            className={cn(
              "ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
              "text-muted-foreground hover:bg-muted/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            )}
            aria-label="Open new tab menu"
          >
            <Plus size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="w-[180px] border border-border/70 bg-card p-1 shadow-lg"
          >
            <DropdownMenuItem
              onClick={handleCreateChatTab}
              disabled={!selectedWorktreePath}
              className="min-h-8 gap-2 px-2 py-1"
            >
              <ChatCircle size={14} />
              <span>New chat</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleCreateTerminalTab}
              className="min-h-8 gap-2 px-2 py-1"
            >
              <Terminal size={14} />
              <span>New terminal</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
