import { useEffect } from "react"
import { Archive, GearSix, Plus } from "@/components/icons"
import { Button } from "@/features/shared/components/ui/button"
import { useLocalChatStore } from "../store"
import { cn } from "@/lib/utils"

interface LocalChatSidebarProps {
  activeThreadId: string | null
  onOpenSettings?: () => void
}

function formatThreadTime(value: number): string {
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })
}

export function LocalChatSidebar({ activeThreadId, onOpenSettings }: LocalChatSidebarProps) {
  const {
    threads,
    isLoading,
    initialize,
    selectThread,
    archiveThread,
  } = useLocalChatStore()

  useEffect(() => {
    void initialize()
  }, [initialize])

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-sidebar-foreground/40">
            Chat
          </div>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="h-7 w-7 rounded-md text-sidebar-foreground/56 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
          onClick={() => void selectThread(null)}
          aria-label="New chat"
        >
          <Plus size={14} />
        </Button>
      </div>

      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={() => void selectThread(null)}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium",
            activeThreadId == null
              ? "bg-[var(--sidebar-item-active)] text-sidebar-accent-foreground"
              : "text-sidebar-foreground/68 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
          )}
        >
          <Plus size={14} className="shrink-0" />
          <span className="truncate">New chat</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {isLoading ? (
          <div className="px-2 py-3 text-sm text-sidebar-foreground/48">Loading chats...</div>
        ) : null}

        {!isLoading && threads.length === 0 ? (
          <div className="px-2 py-3 text-sm leading-5 text-sidebar-foreground/48">
            Local threads will appear here.
          </div>
        ) : null}

        <div className="space-y-0.5">
          {threads.map((thread) => {
            const isActive = activeThreadId === thread.id

            return (
              <div
                key={thread.id}
                className={cn(
                  "group/thread relative rounded-md",
                  isActive && "bg-[var(--sidebar-item-active)]"
                )}
              >
                <button
                  type="button"
                  onClick={() => void selectThread(thread.id)}
                  className={cn(
                    "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 pr-8 text-left",
                    isActive
                      ? "text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/64 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/88"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {thread.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-sidebar-foreground/34">
                    {formatThreadTime(thread.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void archiveThread(thread.id)
                  }}
                  className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/36 opacity-0 transition hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/76 group-hover/thread:opacity-100"
                  aria-label={`Archive ${thread.title}`}
                >
                  <Archive size={13} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-sidebar-border/50 px-2 py-2">
        <button
          type="button"
          onClick={() => onOpenSettings?.()}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-sidebar-foreground/56 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
        >
          <GearSix size={14} className="shrink-0" />
          <span className="truncate">Settings</span>
        </button>
      </div>
    </div>
  )
}
