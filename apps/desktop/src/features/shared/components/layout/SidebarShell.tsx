import { useLayoutEffect, useRef } from "react"
import { useAnimate } from "framer-motion"
import { cn } from "@/lib/utils"
import { useResizablePanel } from "./useResizablePanel"

interface SidebarShellProps {
  width: number
  setWidth: (width: number) => void
  isCollapsed: boolean
  side: "left" | "right"
  sizeConstraintClass: string
  children: React.ReactNode | ((state: { isResizing: boolean }) => React.ReactNode)
  className?: string
}

export function SidebarShell({
  width,
  setWidth,
  isCollapsed,
  side,
  sizeConstraintClass,
  children,
  className,
}: SidebarShellProps) {
  const { handleResizeStart, isResizing } = useResizablePanel({ width, setWidth, isCollapsed, side })
  const [scope, animate] = useAnimate()
  const previousCollapsedRef = useRef(isCollapsed)
  const content = typeof children === "function" ? children({ isResizing }) : children

  useLayoutEffect(() => {
    const wasCollapsed = previousCollapsedRef.current
    previousCollapsedRef.current = isCollapsed

    if (!scope.current) {
      return
    }

    if (side !== "right" || isCollapsed || isResizing) {
      void animate(scope.current, { x: 0, opacity: 1 }, { duration: 0 })
      return
    }

    if (!wasCollapsed) {
      void animate(scope.current, { x: 0, opacity: 1 }, { duration: 0 })
      return
    }

    void animate(scope.current, { x: 18, opacity: 0 }, { duration: 0 })
    void animate(
      scope.current,
      { x: 0, opacity: 1 },
      { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
    )
  }, [animate, isCollapsed, isResizing, scope, side])

  return (
    <aside
      ref={scope}
      data-resizing={isResizing ? "true" : "false"}
      style={{ width: isCollapsed ? 0 : width }}
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground will-change-transform",
        side === "left" ? "border-r border-sidebar-border/70" : "border-l border-sidebar-border",
        !isCollapsed && sizeConstraintClass,
        className,
      )}
    >
      {content}
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
