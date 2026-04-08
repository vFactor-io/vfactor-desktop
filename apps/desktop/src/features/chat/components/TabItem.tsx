import { GitDiff, Terminal, X } from "@/components/icons"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/shared/components/ui/tooltip"
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
      <span className="flex size-4 items-center justify-center">
        <LoadingDots
          variant={activityStatus === "connecting" ? "connecting" : "loading"}
          className="text-current"
        />
      </span>
    )
  }

  if (activityStatus === "error" || hasUnread) {
    return (
      <span className="flex size-4 items-center justify-center">
        <span
          className={cn(
            "block rounded-full",
            activityStatus === "error"
              ? "size-2 bg-destructive"
              : "size-2 bg-amber-400"
          )}
          aria-hidden="true"
        />
      </span>
    )
  }

  switch (type) {
    case "file": {
      const FileIcon = getFileIcon(title)
      return <FileIcon size={15} />
    }
    case "diff":
      return <GitDiff size={15} />
    case "chat-session": {
      const logoKind = harnessId ? getHarnessLogoKind(harnessId) : "default"
      return <ModelLogo kind={logoKind} className="size-4" />
    }
    case "terminal":
      return <Terminal size={15} />
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
  onClick,
  onClose,
}: TabItemProps) {
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClose?.()
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="tab"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => e.key === "Enter" && onClick()}
          className={cn(
            "group relative flex items-center gap-1.5 rounded-md px-2 py-1 text-xs cursor-pointer transition-colors",
            isActive
              ? "text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          )}
        >
          {isActive && (
            <motion.div
              layoutId="activeTab"
              className="absolute inset-0 rounded-md bg-sidebar-accent"
              transition={{ type: "spring", stiffness: 500, damping: 35, mass: 0.5 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-1.5">
            <TabIcon
              type={type}
              title={title}
              harnessId={harnessId}
              activityStatus={activityStatus}
              hasUnread={hasUnread}
            />
            <span className="truncate max-w-28">{title}</span>
          </span>
          {onClose && (
            <button
              type="button"
              onClick={handleClose}
              className="relative z-10 ml-0.5 -mr-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted/60 transition-opacity"
              aria-label={`Close ${title}`}
            >
              <X size={10} />
            </button>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{title}</TooltipContent>
    </Tooltip>
  )
}
