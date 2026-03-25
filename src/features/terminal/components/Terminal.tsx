import { useEffect, useRef, useCallback, useState } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import {
  desktop,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type TerminalStartResponse,
} from "@/desktop/client"
import { cn } from "@/lib/utils"
import "@xterm/xterm/css/xterm.css"

interface TerminalProps {
  sessionId: string | null
  cwd: string | null
  emptyStateMessage?: string
  className?: string
}

const INACTIVE_MESSAGE = "\x1b[90mSelect a project to open a terminal.\x1b[0m"

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
  }
}

function getTerminalFontFamily() {
  const style = getComputedStyle(document.documentElement)
  return (
    style.getPropertyValue("--terminal-font-family").trim() ||
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  )
}

export function Terminal({
  sessionId,
  cwd,
  emptyStateMessage = INACTIVE_MESSAGE,
  className,
}: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  const updateTheme = useCallback(() => {
    const resolvedBackground = resolveThemeColor("--terminal", "#111111")

    if (terminalRef.current) {
      terminalRef.current.style.backgroundColor = resolvedBackground
    }

    if (xtermRef.current) {
      xtermRef.current.options.theme = {
        ...getTerminalTheme(),
        background: resolvedBackground,
        cursorAccent: resolvedBackground,
      }
      xtermRef.current.refresh(0, Math.max(0, xtermRef.current.rows - 1))
    }
  }, [])

  const syncTerminalSize = useCallback(() => {
    const fitAddon = fitAddonRef.current
    const term = xtermRef.current
    const sessionId = sessionIdRef.current

    if (!fitAddon || !term || !sessionId) {
      return
    }

    fitAddon.fit()
    void desktop.terminal.resize(sessionId, term.cols, term.rows).catch((error) => {
      console.error("Failed to resize terminal session:", error)
    })
  }, [])

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return

    const term = new XTerm({
      theme: getTerminalTheme(),
      fontFamily: getTerminalFontFamily(),
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(terminalRef.current)
    fitAddon.fit()
    updateTheme()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    const terminalInputDisposable = term.onData((data) => {
      const sessionId = sessionIdRef.current
      if (!sessionId) {
        return
      }

      void desktop.terminal.write(sessionId, data).catch((error) => {
        console.error("Failed to write to terminal session:", error)
      })
    })

    const terminalResizeDisposable = term.onResize(() => {
      syncTerminalSize()
    })

    const resizeObserver = new ResizeObserver(() => {
      syncTerminalSize()
    })
    resizeObserver.observe(terminalRef.current)

    return () => {
      terminalInputDisposable.dispose()
      terminalResizeDisposable.dispose()
      resizeObserver.disconnect()
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [syncTerminalSize])

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "class" || mutation.attributeName === "style") {
          updateTheme()
        }
      }
    })

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })

    return () => observer.disconnect()
  }, [updateTheme])

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
        term.writeln(emptyStateMessage)
        return
      }

      sessionIdRef.current = sessionId

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
          term.write(response.initialData)
        }
        syncTerminalSize()
      } catch (error) {
        if (!isActive || sessionIdRef.current !== sessionId) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)
        setConnectionError(message)
        term.reset()
        term.writeln("\x1b[31mUnable to start terminal session.\x1b[0m")
        term.writeln(`\x1b[90m${message}\x1b[0m`)
      }
    }

    void attachTerminal()

    return () => {
      isActive = false
    }
  }, [cwd, emptyStateMessage, sessionId, syncTerminalSize])

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
        "border-t border-terminal-border bg-terminal px-3 py-2 text-terminal-foreground",
        className
      )}
    >
      <div ref={terminalRef} className="h-full min-h-0 bg-terminal" />
      {connectionError ? <span className="sr-only">{connectionError}</span> : null}
    </div>
  )
}
