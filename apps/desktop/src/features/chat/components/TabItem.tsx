import { ChatCircle, GitDiff, Terminal, X } from "@/components/icons"
import { cn } from "@/lib/utils"
import { LoadingDots } from "@/features/shared/components/ui/loading-dots"
import { getFileIcon } from "@/features/editor/utils/fileIcons"
import { ModelLogo, getHarnessLogoKind } from "./ModelLogo"
import type { ChatStatus, HarnessId, TabType } from "../types"

interface TabItemProps {
  type: TabType
  title: string
  harnessId?: HarnessId
  activityStatus?: ChatStatus | null
  hasUnread?: boolean
  isActive: boolean
  showActiveIndicator?: boolean
  onClick: () => void
  onClose?: () => void
}

function TabIcon({
  type,
  title,
  harnessId,
  activityStatus,
  hasUnread,
}: {
  type: TabType
  title: string
  harnessId?: HarnessId
  activityStatus?: ChatStatus | null
  hasUnread?: boolean
}) {
  if (activityStatus === "connecting" || activityStatus === "streaming") {
    return (
      <span className="flex size-3.5 items-center justify-center">
        <LoadingDots
          variant={activityStatus === "connecting" ? "connecting" : "loading"}
          className="text-current"
        />
      </span>
    )
  }

  if (activityStatus === "error" || hasUnread) {
    return (
      <span className="flex size-3.5 items-center justify-center">
        <span
          className={cn(
            "block rounded-full",
            activityStatus === "error"
              ? "size-2 bg-destructive"
              : "size-2 bg-[color:var(--color-warning)]"
          )}
          aria-hidden="true"
        />
      </span>
    )
  }

  switch (type) {
    case "file": {
      const FileIcon = getFileIcon(title)
      return <FileIcon size={14} />
    }
    case "diff":
      return <GitDiff size={14} />
    case "chat-session": {
      if (!harnessId) {
        return <ChatCircle size={14} />
      }

      const logoKind = harnessId ? getHarnessLogoKind(harnessId) : "default"
      return <ModelLogo kind={logoKind} className="size-3.5" />
    }
    case "terminal":
      return <Terminal size={14} />
    default:
      return null
  }
}

export function TabItem({
  type,
  title,
  harnessId,
  activityStatus,
  hasUnread,
  isActive,
  showActiveIndicator = true,
  onClick,
  onClose,
}: TabItemProps) {
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClose?.()
  }

  const showHoverClose = Boolean(onClose)

  return (
    <div
      role="tab"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={cn(
        "group relative isolate flex min-h-7 min-w-[5rem] max-w-[13rem] items-center gap-1.5 overflow-hidden rounded-md px-2 py-0.5 text-xs leading-none cursor-pointer transition-colors",
        isActive
          ? "text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
      )}
    >
      {isActive && showActiveIndicator ? (
        <div
          className="absolute inset-0 z-0 rounded-md bg-[var(--sidebar-item-active)]"
        />
      ) : null}
      <span className="relative z-10 flex min-w-0 flex-1 items-center gap-1.5">
        {showHoverClose ? (
          <span className="relative flex size-3.5 shrink-0 items-center justify-center">
            <span className="transition-opacity duration-150 group-hover:opacity-0">
              <TabIcon
                type={type}
                title={title}
                harnessId={harnessId}
                activityStatus={activityStatus}
                hasUnread={hasUnread}
              />
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="pointer-events-none absolute inset-0 flex items-center justify-center rounded opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-muted/60 focus-visible:pointer-events-auto focus-visible:opacity-100"
              aria-label={`Close ${title}`}
            >
              <X size={9} />
            </button>
          </span>
        ) : (
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            <TabIcon
              type={type}
              title={title}
              harnessId={harnessId}
              activityStatus={activityStatus}
              hasUnread={hasUnread}
            />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </span>
    </div>
  )
}
