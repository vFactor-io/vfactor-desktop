import { useState, useCallback, useEffect, type ReactNode } from "react"
import { RightSidebarContext } from "./right-sidebar-context"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"

const RIGHT_SIDEBAR_STORAGE_KEY = "nucleus:right-sidebar-width"
const RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY = "nucleus:right-sidebar-collapsed"
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 400
const MIN_RIGHT_SIDEBAR_WIDTH = 300
const MAX_RIGHT_SIDEBAR_WIDTH = 560

function clampRightSidebarWidth(width: number) {
  return Math.min(MAX_RIGHT_SIDEBAR_WIDTH, Math.max(MIN_RIGHT_SIDEBAR_WIDTH, width))
}

export function RightSidebarProvider({ children }: { children: ReactNode }) {
  const { activeWorktreePath } = useCurrentProjectWorktree()
  const isAvailable = Boolean(activeWorktreePath)
  const [isCollapsed, setIsCollapsedState] = useState(() => {
    if (typeof window === "undefined") {
      return true
    }

    const storedCollapsed = window.localStorage.getItem(RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY)
    return storedCollapsed === null ? true : storedCollapsed === "true"
  })
  const [width, setWidthState] = useState(() => {
    if (typeof window === "undefined") {
      return DEFAULT_RIGHT_SIDEBAR_WIDTH
    }

    const storedWidth = window.localStorage.getItem(RIGHT_SIDEBAR_STORAGE_KEY)
    const parsedWidth = storedWidth ? Number(storedWidth) : NaN

    return Number.isFinite(parsedWidth)
      ? clampRightSidebarWidth(parsedWidth)
      : DEFAULT_RIGHT_SIDEBAR_WIDTH
  })

  useEffect(() => {
    if (!isAvailable) {
      setIsCollapsedState(true)

      if (typeof window !== "undefined") {
        window.localStorage.setItem(RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY, "true")
      }
    }
  }, [isAvailable])

  const setIsCollapsed = useCallback((nextCollapsed: boolean) => {
    const resolvedCollapsed = isAvailable ? nextCollapsed : true
    setIsCollapsedState(resolvedCollapsed)

    if (typeof window !== "undefined") {
      window.localStorage.setItem(RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY, String(resolvedCollapsed))
    }
  }, [isAvailable])
  const toggle = useCallback(() => {
    if (!isAvailable) {
      return
    }

    setIsCollapsedState((prev) => {
      const nextCollapsed = !prev

      if (typeof window !== "undefined") {
        window.localStorage.setItem(RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY, String(nextCollapsed))
      }

      return nextCollapsed
    })
  }, [isAvailable])
  const expand = useCallback(() => setIsCollapsed(false), [setIsCollapsed])
  const collapse = useCallback(() => setIsCollapsed(true), [setIsCollapsed])
  const setWidth = useCallback((nextWidth: number) => {
    const clampedWidth = clampRightSidebarWidth(nextWidth)
    setWidthState(clampedWidth)

    if (typeof window !== "undefined") {
      window.localStorage.setItem(RIGHT_SIDEBAR_STORAGE_KEY, String(clampedWidth))
    }
  }, [])

  return (
    <RightSidebarContext.Provider
      value={{ isAvailable, isCollapsed, width, toggle, expand, collapse, setWidth }}
    >
      {children}
    </RightSidebarContext.Provider>
  )
}
