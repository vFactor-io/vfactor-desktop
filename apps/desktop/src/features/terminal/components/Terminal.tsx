import { useEffect, useRef, useCallback, useState, type MouseEvent as ReactMouseEvent } from "react"
import { desktop } from "@/desktop/client"
import { useAppearance } from "@/features/shared/appearance"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { useRightSidebar } from "@/features/shared/components/layout/useRightSidebar"
import { useBrowserSidebarStore } from "@/features/browser/store/browserSidebarStore"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { cn } from "@/lib/utils"
import {
  attachCachedTerminalSession,
  detachCachedTerminalSession,
  recreateCachedTerminalSession,
  subscribeCachedTerminalSession,
  updateCachedTerminalTheme,
  writeCachedTerminalData,
  type CachedTerminalSession,
} from "./terminalSessionCache"
import { findTerminalUrlAtPoint } from "./terminalLinks"
import "@wterm/dom/css"

interface TerminalProps {
  sessionId: string | null
  cwd: string | null
  emptyStateMessage?: string
  className?: string
  padded?: boolean
}

const INACTIVE_MESSAGE = "\x1b[90mSelect a project to open a terminal.\x1b[0m"

export function Terminal({
  sessionId,
  cwd,
  emptyStateMessage = INACTIVE_MESSAGE,
  className,
  padded = true,
}: TerminalProps) {
  const { themeId, resolvedAppearance } = useAppearance()
  const { selectedWorktreeId } = useCurrentProjectWorktree()
  const { expand, setActiveTab } = useRightSidebar()
  const setBrowserUrl = useBrowserSidebarStore((state) => state.setUrl)
  const terminalLinkTarget = useSettingsStore((state) => state.terminalLinkTarget)
  const initializeSettings = useSettingsStore((state) => state.initialize)
  const terminalRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef<string | null>(null)
  const sessionRef = useRef<CachedTerminalSession | null>(null)
  const isSessionReadyRef = useRef(false)
  const lastSyncedSizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const hoveredLinkRowRef = useRef<HTMLElement | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  const clearHoveredLinkRow = useCallback(() => {
    hoveredLinkRowRef.current?.classList.remove("nucleus-terminal-link-hover")
    hoveredLinkRowRef.current = null
  }, [])

  const updateTheme = useCallback(() => {
    if (sessionIdRef.current) {
      updateCachedTerminalTheme(sessionIdRef.current)
    }
  }, [])

  const pushTerminalSize = useCallback((cols: number, rows: number, force = false) => {
    const activeSessionId = sessionIdRef.current
    if (!activeSessionId || !isSessionReadyRef.current) {
      return
    }

    const nextCols = Math.max(1, cols)
    const nextRows = Math.max(1, rows)
    const lastSyncedSize = lastSyncedSizeRef.current

    if (
      !force &&
      lastSyncedSize &&
      lastSyncedSize.cols === nextCols &&
      lastSyncedSize.rows === nextRows
    ) {
      return
    }

    lastSyncedSizeRef.current = { cols: nextCols, rows: nextRows }
    void desktop.terminal.resize(activeSessionId, nextCols, nextRows).catch((error) => {
      lastSyncedSizeRef.current = null
      console.error("Failed to resize terminal session:", error)
    })
  }, [])

  const attachSessionToContainer = useCallback(
    async (targetSessionId: string) => {
      if (!terminalRef.current) {
        return null
      }

      const cachedSession = await attachCachedTerminalSession(
        targetSessionId,
        terminalRef.current,
        (cols, rows) => pushTerminalSize(cols, rows)
      )

      sessionIdRef.current = targetSessionId
      sessionRef.current = cachedSession
      updateTheme()

      return cachedSession
    },
    [pushTerminalSize, updateTheme]
  )

  const recreateAttachedSession = useCallback(
    async (targetSessionId: string) => {
      recreateCachedTerminalSession(targetSessionId)
      return attachSessionToContainer(targetSessionId)
    },
    [attachSessionToContainer]
  )

  useEffect(() => {
    if (!terminalRef.current || !sessionId) {
      return
    }

    let isActive = true
    let unsubscribe = () => {}

    void (async () => {
      try {
        const cachedSession = await attachSessionToContainer(sessionId)
        if (!isActive || !cachedSession) {
          return
        }

        unsubscribe = subscribeCachedTerminalSession(sessionId, (event) => {
          if (event.type !== "exit") {
            return
          }

          isSessionReadyRef.current = false
          lastSyncedSizeRef.current = null
        })
      } catch (error) {
        if (!isActive) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)
        setConnectionError(message)
      }
    })()

    return () => {
      isActive = false
      unsubscribe()
      clearHoveredLinkRow()
      detachCachedTerminalSession(sessionId)
      sessionRef.current = null
      sessionIdRef.current = null
      isSessionReadyRef.current = false
      lastSyncedSizeRef.current = null
    }
  }, [attachSessionToContainer, clearHoveredLinkRow, sessionId])

  useEffect(() => {
    updateTheme()
  }, [resolvedAppearance, themeId, updateTheme])

  useEffect(() => {
    void initializeSettings()
  }, [initializeSettings])

  useEffect(() => {
    let isActive = true

    const attachTerminal = async () => {
      setConnectionError(null)

      if (!sessionId) {
        return
      }

      let cachedSession = sessionRef.current
      if (!cachedSession || sessionIdRef.current !== sessionId) {
        cachedSession = await attachSessionToContainer(sessionId)
      }

      if (!isActive || !cachedSession) {
        return
      }

      if (!cwd) {
        cachedSession = await recreateAttachedSession(sessionId)
        if (!isActive || !cachedSession) {
          return
        }

        cachedSession.cwd = null
        cachedSession.isReady = false
        cachedSession.isRestoringBuffer = false
        isSessionReadyRef.current = false
        lastSyncedSizeRef.current = null
        writeCachedTerminalData(sessionId, `${emptyStateMessage}\r\n`)
        return
      }

      if (cachedSession.cwd && cachedSession.cwd !== cwd) {
        cachedSession = await recreateAttachedSession(sessionId)
        if (!isActive || !cachedSession) {
          return
        }
      }

      const cols = Math.max(1, cachedSession.lastCols)
      const rows = Math.max(1, cachedSession.lastRows)

      try {
        const response = await desktop.terminal.createSession(sessionId, cwd, cols, rows)
        if (!isActive) {
          return
        }

        cachedSession.cwd = cwd
        cachedSession.isReady = true
        isSessionReadyRef.current = true

        if (response.initialData.length > 0) {
          cachedSession.isRestoringBuffer = true
          writeCachedTerminalData(sessionId, response.initialData)
          requestAnimationFrame(() => {
            if (sessionRef.current === cachedSession) {
              cachedSession.isRestoringBuffer = false
            }
          })
        }

        if (cachedSession.lastCols > 0 && cachedSession.lastRows > 0) {
          pushTerminalSize(cachedSession.lastCols, cachedSession.lastRows, true)
        }
      } catch (error) {
        if (!isActive) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)
        setConnectionError(message)
        isSessionReadyRef.current = false
        lastSyncedSizeRef.current = null

        cachedSession = await recreateAttachedSession(sessionId)
        if (!isActive || !cachedSession) {
          return
        }

        cachedSession.cwd = cwd
        cachedSession.isReady = false
        cachedSession.isRestoringBuffer = false
        writeCachedTerminalData(
          sessionId,
          `\x1b[31mUnable to start terminal session.\x1b[0m\r\n\x1b[90m${message}\x1b[0m\r\n`
        )
      }
    }

    void attachTerminal()

    return () => {
      isActive = false
      isSessionReadyRef.current = false
      lastSyncedSizeRef.current = null
    }
  }, [attachSessionToContainer, cwd, emptyStateMessage, pushTerminalSize, recreateAttachedSession, sessionId])

  const handleOpenLinkInApp = useCallback((url: string) => {
    if (!url || !selectedWorktreeId) {
      return
    }

    setBrowserUrl(selectedWorktreeId, url)
    expand()
    setActiveTab("browser")
  }, [expand, selectedWorktreeId, setActiveTab, setBrowserUrl])

  const handleOpenLinkInBrowser = useCallback((url: string) => {
    if (!url) {
      return
    }

    void desktop.shell.openExternal(url)
  }, [])

  const handleTerminalClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.defaultPrevented) {
      return
    }

    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) {
      return
    }

    const terminalElement = terminalRef.current
    if (!terminalElement) {
      return
    }

    const target = event.target
    if (!(target instanceof Element)) {
      return
    }

    const row = target.closest(".term-row")
    if (!(row instanceof HTMLElement) || !terminalElement.contains(row)) {
      return
    }

    const linkMatch = findTerminalUrlAtPoint(row, event.clientX, event.clientY)
    if (!linkMatch) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (terminalLinkTarget === "system-browser" || !selectedWorktreeId) {
      handleOpenLinkInBrowser(linkMatch.url)
      return
    }

    handleOpenLinkInApp(linkMatch.url)
  }, [handleOpenLinkInApp, handleOpenLinkInBrowser, selectedWorktreeId, terminalLinkTarget])

  const handleTerminalMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const terminalElement = terminalRef.current
    if (!terminalElement) {
      clearHoveredLinkRow()
      return
    }

    const target = event.target
    if (!(target instanceof Element)) {
      clearHoveredLinkRow()
      return
    }

    const row = target.closest(".term-row")
    if (!(row instanceof HTMLElement) || !terminalElement.contains(row)) {
      clearHoveredLinkRow()
      return
    }

    const linkMatch = findTerminalUrlAtPoint(row, event.clientX, event.clientY)
    if (!linkMatch) {
      clearHoveredLinkRow()
      return
    }

    if (hoveredLinkRowRef.current === row) {
      return
    }

    clearHoveredLinkRow()
    row.classList.add("nucleus-terminal-link-hover")
    hoveredLinkRowRef.current = row
  }, [clearHoveredLinkRow])

  return (
    <div
      className={cn(
        "border-t border-terminal-border bg-terminal text-terminal-foreground",
        padded && "px-3 py-2",
        className
      )}
      onClickCapture={handleTerminalClickCapture}
      onMouseMove={handleTerminalMouseMove}
      onMouseLeave={clearHoveredLinkRow}
    >
      <div ref={terminalRef} className="h-full min-h-0 bg-terminal" />
      {connectionError ? <span className="sr-only">{connectionError}</span> : null}
    </div>
  )
}
