import { ChatCircle, Plus, Terminal } from "@/components/icons"
import { useChatStore } from "@/features/chat/store"
import { createProjectChatSession } from "@/features/chat/store/projectChatSession"
import { useTabStore } from "@/features/editor/store"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import { HorizontalOverflowFade } from "@/features/shared/components/ui"
import { Reorder } from "framer-motion"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { getTerminalTabLabel } from "@/features/terminal/utils/terminalTabs"
import { TabItem } from "./TabItem"
import { ModelLogo, getHarnessLogoKind } from "./ModelLogo"
import { listHarnesses } from "../runtime/harnesses"
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
  const getProjectChat = useChatStore((state) => state.getProjectChat)
  const sessionActivityById = useChatStore((state) => state.sessionActivityById)
  const openTerminalTab = useTabStore((state) => state.openTerminalTab)
  const reorderTabs = useTabStore((state) => state.reorderTabs)

  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [tabOrderPreview, setTabOrderPreview] = useState<string[] | null>(null)
  const [activeIndicator, setActiveIndicator] = useState<{ x: number; width: number } | null>(null)
  const tabOrderRef = useRef<string[] | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const tabElementByIdRef = useRef(new Map<string, HTMLDivElement>())
  const enableLayoutAnimation = draggedTabId !== null
  const harnesses = useMemo(() => listHarnesses(), [])

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

  const registerTabElement = useCallback((tabId: string, element: HTMLDivElement | null) => {
    const nextMap = tabElementByIdRef.current

    if (element) {
      nextMap.set(tabId, element)
      return
    }

    nextMap.delete(tabId)
  }, [])

  const syncActiveIndicator = useCallback(() => {
    const activeElement = tabElementByIdRef.current.get(activeTabId)

    if (!activeElement) {
      setActiveIndicator(null)
      return
    }

    const nextIndicator = {
      x: activeElement.offsetLeft,
      width: activeElement.offsetWidth,
    }

    setActiveIndicator((currentIndicator) => {
      if (
        currentIndicator &&
        currentIndicator.x === nextIndicator.x &&
        currentIndicator.width === nextIndicator.width
      ) {
        return currentIndicator
      }

      return nextIndicator
    })
  }, [activeTabId])

  const commitTabOrder = () => {
    const nextTabIds = tabOrderRef.current
    if (nextTabIds && haveTabIdsChangedOrder(nextTabIds, tabs)) {
      reorderTabs(nextTabIds)
    }
    setDraggedTabId(null)
  }

  const worktreeChat = selectedWorktreeId ? getProjectChat(selectedWorktreeId) : null

  const handleCreateChatTab = (harnessId: HarnessId) => {
    if (!selectedWorktreeId || !selectedWorktreePath) {
      return
    }

    void createProjectChatSession({
      worktreeId: selectedWorktreeId,
      worktreePath: selectedWorktreePath,
      options: {
        harnessId,
      },
    })
      .then((result) => {
        if (!result.ok) {
          console.error("[TabBar] Failed to create a chat session:", result.reason)
        }
      })
      .catch((error) => {
        console.error("[TabBar] Failed to create a chat session:", error)
      })
  }

  const handleCreateTerminalTab = () => {
    if (!selectedWorktreeId) {
      return
    }

    openTerminalTab(selectedWorktreeId)
  }

  useLayoutEffect(() => {
    syncActiveIndicator()

    const frameId = requestAnimationFrame(() => {
      syncActiveIndicator()
    })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [orderedTabIds, syncActiveIndicator])

  useEffect(() => {
    const contentElement = contentRef.current
    const viewportElement = viewportRef.current
    const activeElement = tabElementByIdRef.current.get(activeTabId)

    if (!contentElement || !viewportElement || !activeElement || typeof ResizeObserver === "undefined") {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      syncActiveIndicator()
    })

    resizeObserver.observe(contentElement)
    resizeObserver.observe(viewportElement)
    resizeObserver.observe(activeElement)

    return () => {
      resizeObserver.disconnect()
    }
  }, [activeTabId, orderedTabIds, syncActiveIndicator])

  return (
    <div className="flex h-9 items-center border-b border-sidebar-border bg-sidebar px-2 gap-0.5">
      <HorizontalOverflowFade
        className="h-full flex-1"
        viewportClassName="h-full"
        contentClassName="relative flex h-full items-center pr-3"
        viewportRef={viewportRef}
        contentRef={contentRef}
      >
        {activeIndicator ? (
          <div
            aria-hidden="true"
            className="absolute inset-y-1 z-0 rounded-md bg-[var(--sidebar-item-active)]"
            style={{
              transform: `translateX(${activeIndicator.x}px)`,
              width: activeIndicator.width,
            }}
          />
        ) : null}

        <Reorder.Group
          as="div"
          axis="x"
          values={orderedTabIds}
          onReorder={handleReorder}
          className="relative z-10 flex h-full items-center gap-0.5"
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
                  layout: enableLayoutAnimation
                    ? { type: "spring", stiffness: 560, damping: 42, mass: 0.55 }
                    : { duration: 0 },
                }}
                whileDrag={{
                  zIndex: 20,
                  cursor: "grabbing",
                }}
                className={cn(
                  "relative isolate min-w-0 rounded-md cursor-grab active:cursor-grabbing",
                  draggedTabId === tab.id && "opacity-65"
                )}
                onDragStart={() => setDraggedTabId(tab.id)}
                onDragEnd={commitTabOrder}
                ref={(element) => registerTabElement(tab.id, element)}
              >
                <TabItem
                  type={tab.type}
                  title={tab.type === "terminal" ? getTerminalTabLabel(tab, tabs) : tab.title}
                  harnessId={harnessId}
                  activityStatus={sessionActivity?.status}
                  hasUnread={sessionActivity?.unread}
                  isActive={tab.id === activeTabId}
                  showActiveIndicator={false}
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
              "relative z-10 ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
              "text-muted-foreground hover:bg-muted/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            )}
            aria-label="Open new tab menu"
          >
            <Plus size={12} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="w-48 border border-border/70 bg-card p-0.5 shadow-lg"
          >
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={!selectedWorktreePath}
                className="min-h-7 gap-1.5 px-1.5 py-0.5"
              >
                <ChatCircle size={14} />
                <span>New chat</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                alignOffset={-4}
                className="w-44 border border-border/70 bg-card p-0.5 shadow-lg"
              >
                {harnesses.map((harness) => (
                  <DropdownMenuItem
                    key={harness.id}
                    onClick={() => handleCreateChatTab(harness.id)}
                    className="min-h-7 gap-1.5 px-1.5 py-0.5"
                  >
                    <ModelLogo kind={getHarnessLogoKind(harness.id)} className="size-3.5" />
                    <span>{harness.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onClick={handleCreateTerminalTab}
              className="min-h-7 gap-1.5 px-1.5 py-0.5"
            >
              <Terminal size={14} />
              <span>New terminal</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </HorizontalOverflowFade>
    </div>
  )
}
