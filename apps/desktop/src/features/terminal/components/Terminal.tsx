import { useEffect, useRef, useCallback, useState } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebglAddon } from "@xterm/addon-webgl"
import {
  desktop,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type TerminalStartResponse,
} from "@/desktop/client"
import { cn } from "@/lib/utils"
import { shouldRecoverTerminal, type TerminalRenderState } from "./terminalRecovery"
import "@xterm/xterm/css/xterm.css"

interface TerminalProps {
  sessionId: string | null
  cwd: string | null
  emptyStateMessage?: string
  className?: string
  padded?: boolean
}

const INACTIVE_MESSAGE = "\x1b[90mSelect a project to open a terminal.\x1b[0m"
let preferDomTerminalRenderer = false

function getTerminalRenderState(container: HTMLDivElement | null): TerminalRenderState {
  if (!container) {
    return {
      isConnected: false,
      display: "none",
      visibility: "hidden",
      width: 0,
      height: 0,
    }
  }

  const style = getComputedStyle(container)
  const rect = container.getBoundingClientRect()

  return {
    isConnected: container.isConnected,
    display: style.display,
    visibility: style.visibility,
    width: rect.width,
    height: rect.height,
  }
}

function resolveThemeColor(variableName: string, fallback: string) {
  const probe = document.createElement("div")
  probe.style.position = "absolute"
  probe.style.pointerEvents = "none"
  probe.style.opacity = "0"
  probe.style.backgroundColor = `var(${variableName})`
  document.body.appendChild(probe)

  const resolved = getComputedStyle(probe).backgroundColor.trim()
  probe.remove()

  return resolved || fallback
}

function getTerminalTheme() {
  return {
    background: resolveThemeColor("--terminal", "#111111"),
    foreground: resolveThemeColor("--terminal-foreground", "#d4d4d4"),
    cursor: resolveThemeColor("--terminal-cursor", "#f5f5f5"),
    cursorAccent: resolveThemeColor("--terminal", "#111111"),
    selectionBackground: resolveThemeColor("--terminal-selection", "rgba(110, 110, 110, 0.4)"),
    scrollbarSliderBackground: "transparent",
    scrollbarSliderHoverBackground: "transparent",
    scrollbarSliderActiveBackground: "transparent",
    overviewRulerBorder: "transparent",
  }
}

function getTerminalFontFamily() {
  const style = getComputedStyle(document.documentElement)
  return (
    style.getPropertyValue("--terminal-font-family").trim() ||
    'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
  )
}

function applyTerminalSurfaceStyles(container: HTMLDivElement, background: string, foreground: string) {
  container.style.backgroundColor = background
  container.style.color = foreground

  const xtermRoot = container.querySelector<HTMLElement>(".xterm")
  const xtermScrollable = container.querySelector<HTMLElement>(".xterm-scrollable-element")
  const xtermViewport = container.querySelector<HTMLElement>(".xterm-viewport")
  const xtermScreen = container.querySelector<HTMLElement>(".xterm-screen")

  for (const element of [xtermRoot, xtermScrollable, xtermViewport, xtermScreen]) {
    if (!element) {
      continue
    }

    element.style.backgroundColor = background
    element.style.color = foreground
  }
}

export function Terminal({
  sessionId,
  cwd,
  emptyStateMessage = INACTIVE_MESSAGE,
  className,
  padded = true,
}: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<WebglAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const isSessionReadyRef = useRef(false)
  const isRestoringBufferRef = useRef(false)
  const lastSyncedSizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const repaintFrameRef = useRef<number | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  const updateTheme = useCallback(() => {
    const resolvedBackground = resolveThemeColor("--terminal", "#111111")
    const resolvedForeground = resolveThemeColor("--terminal-foreground", "#d4d4d4")

    if (terminalRef.current) {
      applyTerminalSurfaceStyles(terminalRef.current, resolvedBackground, resolvedForeground)
    }

    if (xtermRef.current) {
      xtermRef.current.options.theme = {
        ...getTerminalTheme(),
        background: resolvedBackground,
        foreground: resolvedForeground,
        cursorAccent: resolvedBackground,
      }
      xtermRef.current.refresh(0, Math.max(0, xtermRef.current.rows - 1))
    }
  }, [])

  const pushTerminalSize = useCallback((cols: number, rows: number, force = false) => {
    const term = xtermRef.current
    const sessionId = sessionIdRef.current

    if (!term || !sessionId || !isSessionReadyRef.current) {
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
    void desktop.terminal.resize(sessionId, nextCols, nextRows).catch((error) => {
      lastSyncedSizeRef.current = null
      console.error("Failed to resize terminal session:", error)
    })
  }, [])

  const fitTerminal = useCallback((forceResizeSync = false) => {
    const fitAddon = fitAddonRef.current
    const term = xtermRef.current

    if (!fitAddon || !term) {
      return
    }

    fitAddon.fit()
    pushTerminalSize(term.cols, term.rows, forceResizeSync)
  }, [pushTerminalSize])

  const repaintTerminal = useCallback(() => {
    const term = xtermRef.current
    if (!term) {
      return
    }

    ;(webglAddonRef.current as (WebglAddon & { clearTextureAtlas?: () => void }) | null)?.clearTextureAtlas?.()
    term.refresh(0, Math.max(0, term.rows - 1))
  }, [])

  const scheduleTerminalRepaint = useCallback((forceResizeSync = false) => {
    if (repaintFrameRef.current != null) {
      cancelAnimationFrame(repaintFrameRef.current)
    }

    // Wait until the current layout pass settles so xterm redraws against the final size.
    repaintFrameRef.current = requestAnimationFrame(() => {
      repaintFrameRef.current = null
      if (!shouldRecoverTerminal(document.visibilityState, getTerminalRenderState(terminalRef.current))) {
        return
      }

      fitTerminal(forceResizeSync)
      repaintTerminal()
    })
  }, [fitTerminal, repaintTerminal])

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return

    const term = new XTerm({
      theme: getTerminalTheme(),
      fontFamily: getTerminalFontFamily(),
      fontSize: 13,
      overviewRuler: { width: 0.1 },
      cursorBlink: true,
      cursorStyle: "block",
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(terminalRef.current)

    let webglAddon: WebglAddon | null = null
    const webglLoadFrame = requestAnimationFrame(() => {
      if (preferDomTerminalRenderer) {
        return
      }

      try {
        webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          try {
            webglAddon?.dispose()
          } catch {
            // Ignore renderer teardown errors and fall back to the default renderer.
          }

          webglAddon = null
          webglAddonRef.current = null
          repaintTerminal()
        })
        term.loadAddon(webglAddon)
        webglAddonRef.current = webglAddon
        scheduleTerminalRepaint()
      } catch {
        preferDomTerminalRenderer = true
        webglAddon = null
        webglAddonRef.current = null
      }
    })

    fitAddon.fit()
    updateTheme()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    const terminalInputDisposable = term.onData((data) => {
      const sessionId = sessionIdRef.current
      if (!sessionId || isRestoringBufferRef.current) {
        return
      }

      void desktop.terminal.write(sessionId, data).catch((error) => {
        console.error("Failed to write to terminal session:", error)
      })
    })

    const terminalResizeDisposable = term.onResize(({ cols, rows }) => {
      pushTerminalSize(cols, rows)
    })

    const resizeObserver = new ResizeObserver(() => {
      scheduleTerminalRepaint()
    })
    resizeObserver.observe(terminalRef.current)

    return () => {
      terminalInputDisposable.dispose()
      terminalResizeDisposable.dispose()
      resizeObserver.disconnect()
      cancelAnimationFrame(webglLoadFrame)
      if (repaintFrameRef.current != null) {
        cancelAnimationFrame(repaintFrameRef.current)
        repaintFrameRef.current = null
      }
      try {
        webglAddon?.dispose()
      } catch {
        // Ignore renderer teardown errors during terminal disposal.
      }
      webglAddonRef.current = null
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [fitTerminal, pushTerminalSize, repaintTerminal, scheduleTerminalRepaint, updateTheme])

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "class" || mutation.attributeName === "style") {
          updateTheme()
          scheduleTerminalRepaint()
        }
      }
    })

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })

    return () => observer.disconnect()
  }, [scheduleTerminalRepaint, updateTheme])

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      scheduleTerminalRepaint(true)
    }

    document.addEventListener("visibilitychange", handleVisibilityOrFocus)
    window.addEventListener("focus", handleVisibilityOrFocus)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus)
      window.removeEventListener("focus", handleVisibilityOrFocus)
    }
  }, [scheduleTerminalRepaint])

  useEffect(() => {
    let isActive = true

    const attachTerminal = async () => {
      const term = xtermRef.current
      if (!term) {
        return
      }

      term.reset()
      setConnectionError(null)

      if (!sessionId || !cwd) {
        sessionIdRef.current = null
        isSessionReadyRef.current = false
        isRestoringBufferRef.current = false
        lastSyncedSizeRef.current = null
        term.writeln(emptyStateMessage)
        return
      }

      sessionIdRef.current = sessionId
      isSessionReadyRef.current = false
      isRestoringBufferRef.current = false
      lastSyncedSizeRef.current = null

      try {
        const response = await desktop.terminal.createSession(
          sessionId,
          cwd,
          term.cols,
          term.rows
        )

        if (!isActive || sessionIdRef.current !== sessionId) {
          return
        }

        term.reset()
        if (response.initialData.length > 0) {
          // Replaying buffered PTY output can contain old terminal capability probes.
          // Ignore any xterm-generated replies while we restore the visual buffer.
          isRestoringBufferRef.current = true
          term.write(response.initialData, () => {
            if (!isActive || sessionIdRef.current !== sessionId) {
              return
            }

            isRestoringBufferRef.current = false
            isSessionReadyRef.current = true
            scheduleTerminalRepaint(true)
          })
          return
        }

        isSessionReadyRef.current = true
        scheduleTerminalRepaint(true)
      } catch (error) {
        if (!isActive || sessionIdRef.current !== sessionId) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)
        setConnectionError(message)
        isSessionReadyRef.current = false
        isRestoringBufferRef.current = false
        lastSyncedSizeRef.current = null
        term.reset()
        term.writeln("\x1b[31mUnable to start terminal session.\x1b[0m")
        term.writeln(`\x1b[90m${message}\x1b[0m`)
      }
    }

    void attachTerminal()

    return () => {
      isActive = false
      isSessionReadyRef.current = false
      isRestoringBufferRef.current = false
      lastSyncedSizeRef.current = null
    }
  }, [cwd, emptyStateMessage, scheduleTerminalRepaint, sessionId])

  useEffect(() => {
    let isDisposed = false
    const cleanupCallbacks: Array<() => void> = []

    const bindTerminalEvents = async () => {
      const [unlistenData, unlistenExit] = await Promise.all([
        Promise.resolve(
          desktop.terminal.onData((event: TerminalDataEvent) => {
            if (event.sessionId !== sessionIdRef.current) {
              return
            }

            xtermRef.current?.write(event.data)
          })
        ),
        Promise.resolve(
          desktop.terminal.onExit((event: TerminalExitEvent) => {
            if (event.sessionId !== sessionIdRef.current) {
              return
            }

            isSessionReadyRef.current = false
            xtermRef.current?.writeln("")
            xtermRef.current?.writeln("\x1b[90mTerminal session ended. Reopen the project terminal to start a new shell.\x1b[0m")
          })
        ),
      ])

      if (isDisposed) {
        unlistenData()
        unlistenExit()
        return
      }

      cleanupCallbacks.push(unlistenData, unlistenExit)
    }

    void bindTerminalEvents()

    return () => {
      isDisposed = true
      for (const cleanup of cleanupCallbacks.splice(0)) {
        cleanup()
      }
    }
  }, [])

  return (
    <div
      className={cn(
        "border-t border-terminal-border bg-terminal text-terminal-foreground",
        padded && "px-3 py-2",
        className
      )}
    >
      <div ref={terminalRef} className="h-full min-h-0 bg-terminal" />
      {connectionError ? <span className="sr-only">{connectionError}</span> : null}
    </div>
  )
}
