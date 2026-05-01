import { cn } from "@/lib/utils"
import { useResizablePanel } from "./useResizablePanel"
import {
  LEFT_SIDEBAR_WIDTH_CSS_VAR,
  RIGHT_SIDEBAR_WIDTH_CSS_VAR,
  SIDEBAR_CLOSE_DURATION_S,
  SIDEBAR_OPEN_DURATION_S,
} from "./layoutSizing"

interface SidebarShellProps {
  width: number
  setWidth: (width: number) => void
  persistWidth?: () => void
  clampWidth?: (width: number) => number
  isCollapsed: boolean
  side: "left" | "right"
  sizeConstraintClass: string
  collapsedWidth?: number
  animateWidth?: boolean
  children: React.ReactNode | ((state: { isResizing: boolean }) => React.ReactNode)
  className?: string
}

export function SidebarShell({
  width,
  setWidth,
  persistWidth,
  clampWidth,
  isCollapsed,
  side,
  sizeConstraintClass,
  collapsedWidth = 0,
  animateWidth = true,
  children,
  className,
}: SidebarShellProps) {
  const { handleResizeStart, isResizing } = useResizablePanel({
    width,
    setWidth,
    persistWidth,
    clampWidth,
    isCollapsed,
    widthCssVariable: side === "left" ? LEFT_SIDEBAR_WIDTH_CSS_VAR : RIGHT_SIDEBAR_WIDTH_CSS_VAR,
    side,
  })
  const content = typeof children === "function" ? children({ isResizing }) : children
  const isLeftSidebar = side === "left"
  const widthCssVariable = isLeftSidebar ? LEFT_SIDEBAR_WIDTH_CSS_VAR : RIGHT_SIDEBAR_WIDTH_CSS_VAR
  const resolvedWidth = `var(${widthCssVariable}, ${width}px)`
  const transitionDuration = isCollapsed ? `${SIDEBAR_CLOSE_DURATION_S}s` : `${SIDEBAR_OPEN_DURATION_S}s`
  const transitionTiming = isCollapsed
    ? "cubic-bezier(0.23, 1, 0.32, 1)"
    : "cubic-bezier(0.22, 1, 0.36, 1)"

  return (
    <aside
      data-resizing={isResizing ? "true" : "false"}
      style={animateWidth ? {
        width: isCollapsed ? `${collapsedWidth}px` : resolvedWidth,
        "--sidebar-resize-duration": transitionDuration,
        "--sidebar-resize-easing": transitionTiming,
      } : { width: "100%" }}
      className={cn(
        "sidebar-resize-transition relative flex h-full min-h-0 shrink-0 self-stretch flex-col overflow-hidden bg-sidebar text-sidebar-foreground",
        !isCollapsed && sizeConstraintClass,
        className,
      )}
    >
      <div
        style={{ width: animateWidth ? resolvedWidth : width }}
        className="flex h-full min-h-0 flex-1 shrink-0 flex-col"
      >
        {content}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 z-20 w-px bg-sidebar-border/70 transition-opacity",
          isCollapsed ? "opacity-0" : "opacity-100",
          isLeftSidebar ? "right-0" : "left-0"
        )}
      />
      {!isCollapsed ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${side} sidebar`}
          onPointerDown={handleResizeStart}
          className={cn(
            "absolute inset-y-0 z-10 w-2 cursor-col-resize",
            side === "left" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
          )}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent hover:bg-sidebar-border/90" />
        </div>
      ) : null}
    </aside>
  )
}
