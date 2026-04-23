import { useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { RightSidebarContext, type RightSidebarTab } from "./right-sidebar-context"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { useSidebar } from "./useSidebar"
import { MIN_MAIN_CONTENT_WIDTH, RIGHT_SIDEBAR_WIDTH_CSS_VAR } from "./layoutSizing"

const RIGHT_SIDEBAR_STORAGE_KEY = "nucleus:right-sidebar-width"
const RIGHT_SIDEBAR_PREFERRED_WIDTH_STORAGE_KEY = "nucleus:right-sidebar-preferred-width"
const RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY = "nucleus:right-sidebar-collapsed"
const RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY = "nucleus:right-sidebar-active-tab"
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 400
const MIN_RIGHT_SIDEBAR_WIDTH = 300
const BROWSER_RIGHT_SIDEBAR_MIN_WIDTH = 180
const BROWSER_RIGHT_SIDEBAR_TARGET_WIDTH = 520
const DEFAULT_RIGHT_SIDEBAR_TAB: RightSidebarTab = "files"

function getDefaultRightSidebarWidth(activeTab: RightSidebarTab) {
  return activeTab === "browser" ? BROWSER_RIGHT_SIDEBAR_TARGET_WIDTH : DEFAULT_RIGHT_SIDEBAR_WIDTH
}

function persistRightSidebarWidths(width: number, preferredWidth: number) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(RIGHT_SIDEBAR_STORAGE_KEY, String(width))
  window.localStorage.setItem(RIGHT_SIDEBAR_PREFERRED_WIDTH_STORAGE_KEY, String(preferredWidth))
}

function getMinRightSidebarWidth(activeTab: RightSidebarTab) {
  return activeTab === "browser" ? BROWSER_RIGHT_SIDEBAR_MIN_WIDTH : MIN_RIGHT_SIDEBAR_WIDTH
}

function getMaxRightSidebarWidth(
  viewportWidth: number,
  leftSidebarWidth: number,
  activeTab: RightSidebarTab
) {
  return Math.max(getMinRightSidebarWidth(activeTab), viewportWidth - leftSidebarWidth - MIN_MAIN_CONTENT_WIDTH)
}

function clampRightSidebarWidth(width: number, maxWidth: number, activeTab: RightSidebarTab) {
  return Math.min(maxWidth, Math.max(getMinRightSidebarWidth(activeTab), width))
}

export function RightSidebarProvider({ children }: { children: ReactNode }) {
  const { activeWorktreePath } = useCurrentProjectWorktree()
  const { isCollapsed: isLeftSidebarCollapsed, width: leftSidebarWidth } = useSidebar()
  const isAvailable = Boolean(activeWorktreePath)
  const effectiveLeftSidebarWidth = isLeftSidebarCollapsed
    ? 0
    : leftSidebarWidth
  const [activeTab, setActiveTabState] = useState<RightSidebarTab>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_RIGHT_SIDEBAR_TAB
    }

    const storedTab = window.localStorage.getItem(RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY)
    return storedTab === "files" || storedTab === "changes" || storedTab === "checks" || storedTab === "browser"
      ? storedTab
      : DEFAULT_RIGHT_SIDEBAR_TAB
  })
  const [isCollapsed, setIsCollapsedState] = useState(() => {
    if (typeof window === "undefined") {
      return true
    }

    const storedCollapsed = window.localStorage.getItem(RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY)
    return storedCollapsed === null ? true : storedCollapsed === "true"
  })
  const [preferredWidth, setPreferredWidthState] = useState(() => {
    if (typeof window === "undefined") {
      return getDefaultRightSidebarWidth(activeTab)
    }

    const storedWidth = window.localStorage.getItem(RIGHT_SIDEBAR_PREFERRED_WIDTH_STORAGE_KEY)
    const parsedWidth = storedWidth ? Number(storedWidth) : NaN

    return Number.isFinite(parsedWidth)
      ? parsedWidth
      : getDefaultRightSidebarWidth(activeTab)
  })
  const [width, setWidthState] = useState(() => {
    if (typeof window === "undefined") {
      return getDefaultRightSidebarWidth(activeTab)
    }

    const maxWidth = getMaxRightSidebarWidth(window.innerWidth, effectiveLeftSidebarWidth, activeTab)
    return clampRightSidebarWidth(preferredWidth, maxWidth, activeTab)
  })
  const preferredWidthRef = useRef(preferredWidth)
  const widthRef = useRef(width)

  useEffect(() => {
    preferredWidthRef.current = preferredWidth
  }, [preferredWidth])

  useEffect(() => {
    widthRef.current = width
  }, [width])

  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    document.documentElement.style.setProperty(RIGHT_SIDEBAR_WIDTH_CSS_VAR, `${width}px`)
  }, [width])

  useEffect(() => {
    if (!isAvailable) {
      setIsCollapsedState(true)

      if (typeof window !== "undefined") {
        window.localStorage.setItem(RIGHT_SIDEBAR_COLLAPSED_STORAGE_KEY, "true")
      }
    }
  }, [isAvailable])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const syncWidthToViewport = () => {
      const maxWidth = getMaxRightSidebarWidth(window.innerWidth, effectiveLeftSidebarWidth, activeTab)
      const clampedWidth = clampRightSidebarWidth(preferredWidthRef.current, maxWidth, activeTab)

      if (clampedWidth === widthRef.current) {
        return
      }

      widthRef.current = clampedWidth
      setWidthState(clampedWidth)
      window.localStorage.setItem(RIGHT_SIDEBAR_STORAGE_KEY, String(clampedWidth))
    }

    syncWidthToViewport()
    window.addEventListener("resize", syncWidthToViewport)

    return () => {
      window.removeEventListener("resize", syncWidthToViewport)
    }
  }, [activeTab, effectiveLeftSidebarWidth])

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
  const clampWidth = useCallback((nextWidth: number) => {
    if (typeof window === "undefined") {
      return Math.max(getMinRightSidebarWidth(activeTab), nextWidth)
    }

    const maxWidth = getMaxRightSidebarWidth(window.innerWidth, effectiveLeftSidebarWidth, activeTab)
    return clampRightSidebarWidth(nextWidth, maxWidth, activeTab)
  }, [activeTab, effectiveLeftSidebarWidth])
  const setWidth = useCallback((nextWidth: number) => {
    const minWidth = getMinRightSidebarWidth(activeTab)
    const maxWidth =
      typeof window === "undefined"
        ? Number.POSITIVE_INFINITY
        : getMaxRightSidebarWidth(window.innerWidth, effectiveLeftSidebarWidth, activeTab)
    const nextPreferredWidth = Math.max(minWidth, nextWidth)
    const clampedWidth = clampRightSidebarWidth(nextWidth, maxWidth, activeTab)

    if (preferredWidthRef.current === nextPreferredWidth && widthRef.current === clampedWidth) {
      return
    }

    preferredWidthRef.current = nextPreferredWidth
    widthRef.current = clampedWidth
    setPreferredWidthState((currentWidth) => (
      currentWidth === nextPreferredWidth ? currentWidth : nextPreferredWidth
    ))
    setWidthState((currentWidth) => (
      currentWidth === clampedWidth ? currentWidth : clampedWidth
    ))

  }, [activeTab, effectiveLeftSidebarWidth])
  const persistWidth = useCallback(() => {
    persistRightSidebarWidths(widthRef.current, preferredWidthRef.current)
  }, [])
  const setActiveTab = useCallback((nextTab: RightSidebarTab) => {
    setActiveTabState(nextTab)

    if (typeof window !== "undefined") {
      window.localStorage.setItem(RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY, nextTab)
    }
  }, [])

  return (
    <RightSidebarContext.Provider
      value={{
        isAvailable,
        isCollapsed,
        width,
        activeTab,
        toggle,
        expand,
        collapse,
        clampWidth,
        setWidth,
        persistWidth,
        setActiveTab,
      }}
    >
      {children}
    </RightSidebarContext.Provider>
  )
}
