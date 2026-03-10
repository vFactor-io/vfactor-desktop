import { useState, useCallback, type ReactNode } from "react"
import { SidebarContext } from "./sidebar-context"

const SIDEBAR_STORAGE_KEY = "nucleus:left-sidebar-width"
const SIDEBAR_COLLAPSED_STORAGE_KEY = "nucleus:left-sidebar-collapsed"
const DEFAULT_SIDEBAR_WIDTH = 300
const MIN_SIDEBAR_WIDTH = 240
const MAX_SIDEBAR_WIDTH = 420

function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsedState] = useState(() => {
    if (typeof window === "undefined") {
      return false
    }

    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
  })
  const [width, setWidthState] = useState(() => {
    if (typeof window === "undefined") {
      return DEFAULT_SIDEBAR_WIDTH
    }

    const storedWidth = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    const parsedWidth = storedWidth ? Number(storedWidth) : NaN

    return Number.isFinite(parsedWidth)
      ? clampSidebarWidth(parsedWidth)
      : DEFAULT_SIDEBAR_WIDTH
  })

  const setIsCollapsed = useCallback((nextCollapsed: boolean) => {
    setIsCollapsedState(nextCollapsed)

    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(nextCollapsed))
    }
  }, [])
  const toggle = useCallback(() => {
    setIsCollapsedState((prev) => {
      const nextCollapsed = !prev

      if (typeof window !== "undefined") {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(nextCollapsed))
      }

      return nextCollapsed
    })
  }, [])
  const expand = useCallback(() => setIsCollapsed(false), [setIsCollapsed])
  const collapse = useCallback(() => setIsCollapsed(true), [setIsCollapsed])
  const setWidth = useCallback((nextWidth: number) => {
    const clampedWidth = clampSidebarWidth(nextWidth)
    setWidthState(clampedWidth)

    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(clampedWidth))
    }
  }, [])

  return (
    <SidebarContext.Provider value={{ isCollapsed, width, toggle, expand, collapse, setWidth }}>
      {children}
    </SidebarContext.Provider>
  )
}
