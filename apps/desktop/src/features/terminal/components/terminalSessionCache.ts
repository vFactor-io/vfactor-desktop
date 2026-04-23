import { WTerm } from "@wterm/dom"
import { desktop, type TerminalExitEvent } from "@/desktop/client"

export interface CachedTerminalEvent {
  type: "exit"
  event: TerminalExitEvent
}

export interface CachedTerminalSession {
  sessionId: string
  term: WTerm
  wrapper: HTMLDivElement
  initPromise: Promise<void>
  hasStartedInit: boolean
  pendingWrites: Array<string | Uint8Array>
  lastCols: number
  lastRows: number
  scrollTop: number
  isReady: boolean
  isRestoringBuffer: boolean
  cwd: string | null
  listeners: Set<(event: CachedTerminalEvent) => void>
  dispose: () => void
}

const sessions = new Map<string, CachedTerminalSession>()

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

function resolveTerminalTheme() {
  const style = getComputedStyle(document.documentElement)

  return {
    background: resolveThemeColor("--terminal", "#111111"),
    foreground: resolveThemeColor("--terminal-foreground", "#d4d4d4"),
    cursor: resolveThemeColor("--terminal-cursor", "#f5f5f5"),
    selection: resolveThemeColor("--terminal-selection", "rgba(110, 110, 110, 0.4)"),
    fontFamily:
      style.getPropertyValue("--terminal-font-family").trim() ||
      'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: style.getPropertyValue("--terminal-font-size").trim() || "13px",
    lineHeight: style.getPropertyValue("--terminal-line-height").trim() || "1.35",
  }
}

function applyTerminalSurfaceStyles(container: HTMLElement) {
  const theme = resolveTerminalTheme()

  container.style.backgroundColor = theme.background
  container.style.color = theme.foreground
  container.style.setProperty("--term-bg", theme.background)
  container.style.setProperty("--term-fg", theme.foreground)
  container.style.setProperty("--term-cursor", theme.cursor)
  container.style.setProperty("--term-font-family", theme.fontFamily)
  container.style.setProperty("--term-font-size", theme.fontSize)
  container.style.setProperty("--term-line-height", theme.lineHeight)
  container.style.setProperty("--nucleus-term-selection", theme.selection)
}

function writeToSession(session: CachedTerminalSession, data: string | Uint8Array) {
  if (!session.term.bridge) {
    session.pendingWrites.push(data)
    return
  }

  session.term.write(data)
}

function flushPendingWrites(session: CachedTerminalSession) {
  if (!session.term.bridge || session.pendingWrites.length === 0) {
    return
  }

  for (const chunk of session.pendingWrites) {
    session.term.write(chunk)
  }

  session.pendingWrites = []
}

function ensureTerminalInitialized(session: CachedTerminalSession) {
  if (session.hasStartedInit) {
    return session.initPromise
  }

  session.hasStartedInit = true
  session.initPromise = session.term.init().then(() => {
    flushPendingWrites(session)
  })

  return session.initPromise
}

function createCachedTerminalSession(sessionId: string): CachedTerminalSession {
  const wrapper = document.createElement("div")
  wrapper.className = "nucleus-wterm-shell h-full min-h-0 w-full overflow-hidden bg-terminal"

  const listeners = new Set<(event: CachedTerminalEvent) => void>()

  const term = new WTerm(wrapper, {
    autoResize: true,
    cursorBlink: true,
    onData(data) {
      const current = sessions.get(sessionId)
      if (!current || current.isRestoringBuffer) {
        return
      }

      void desktop.terminal.write(sessionId, data).catch((error) => {
        console.error("Failed to write to terminal session:", error)
      })
    },
    onResize(cols, rows) {
      const current = sessions.get(sessionId)
      if (!current) {
        return
      }

      current.lastCols = cols
      current.lastRows = rows
    },
  })

  applyTerminalSurfaceStyles(wrapper)

  const dataCleanup = desktop.terminal.onData((event) => {
    if (event.sessionId !== sessionId) {
      return
    }

    const current = sessions.get(sessionId)
    if (!current) {
      return
    }

    writeToSession(current, event.data)
  })

  const exitCleanup = desktop.terminal.onExit((event) => {
    if (event.sessionId !== sessionId) {
      return
    }

    const current = sessions.get(sessionId)
    if (!current) {
      return
    }

    current.isReady = false
    current.isRestoringBuffer = false
    writeToSession(current, "\r\n\x1b[90mTerminal session ended. Reopen the project terminal to start a new shell.\x1b[0m\r\n")

    for (const listener of current.listeners) {
      listener({ type: "exit", event })
    }
  })

  const dispose = () => {
    const current = sessions.get(sessionId)
    if (!current) {
      return
    }

    current.listeners.clear()
    dataCleanup()
    exitCleanup()
    current.wrapper.remove()
    current.term.destroy()
    sessions.delete(sessionId)
  }

  const session: CachedTerminalSession = {
    sessionId,
    term,
    wrapper,
    initPromise: Promise.resolve(),
    hasStartedInit: false,
    pendingWrites: [],
    lastCols: term.cols,
    lastRows: term.rows,
    scrollTop: 0,
    isReady: false,
    isRestoringBuffer: false,
    cwd: null,
    listeners,
    dispose,
  }

  sessions.set(sessionId, session)
  return session
}

export function getOrCreateCachedTerminalSession(sessionId: string): CachedTerminalSession {
  return sessions.get(sessionId) ?? createCachedTerminalSession(sessionId)
}

export async function attachCachedTerminalSession(
  sessionId: string,
  container: HTMLDivElement,
  onResize?: (cols: number, rows: number) => void
) {
  const session = getOrCreateCachedTerminalSession(sessionId)
  container.appendChild(session.wrapper)
  applyTerminalSurfaceStyles(session.wrapper)
  await ensureTerminalInitialized(session)

  const restoreCols = Math.max(1, session.lastCols || session.term.cols)
  const restoreRows = Math.max(1, session.lastRows || session.term.rows)
  session.term.resize(restoreCols, restoreRows)

  session.term.onResize = (cols, rows) => {
    session.lastCols = cols
    session.lastRows = rows
    onResize?.(cols, rows)
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
  session.wrapper.scrollTop = session.scrollTop
  session.term.focus()

  return session
}

export function recreateCachedTerminalSession(sessionId: string) {
  sessions.get(sessionId)?.dispose()
  return createCachedTerminalSession(sessionId)
}

export function getCachedTerminalSession(sessionId: string) {
  return sessions.get(sessionId) ?? null
}

export function updateCachedTerminalTheme(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) {
    return
  }

  applyTerminalSurfaceStyles(session.wrapper)
}

export function detachCachedTerminalSession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) {
    return
  }

  session.term.onResize = null
  session.scrollTop = session.wrapper.scrollTop
  session.wrapper.remove()
}

export function subscribeCachedTerminalSession(
  sessionId: string,
  listener: (event: CachedTerminalEvent) => void
) {
  const session = getOrCreateCachedTerminalSession(sessionId)
  session.listeners.add(listener)

  return () => {
    session.listeners.delete(listener)
  }
}

export function writeCachedTerminalData(sessionId: string, data: string | Uint8Array) {
  const session = getOrCreateCachedTerminalSession(sessionId)
  writeToSession(session, data)
}

export function disposeCachedTerminalSession(sessionId: string) {
  sessions.get(sessionId)?.dispose()
}
