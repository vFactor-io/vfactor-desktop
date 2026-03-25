import { useEffect, useMemo, useState } from "react"
import { desktop } from "@/desktop/client"
import { CaretDown, CaretUp, Plus, X } from "@/components/icons"
import { Separator } from "@/features/shared/components/ui"
import { cn } from "@/lib/utils"
import { Terminal } from "./Terminal"

interface TerminalPanelProps {
  projectId: string | null
  projectPath: string | null
  className?: string
}

interface TerminalTab {
  id: string
}

interface ProjectTerminalState {
  tabs: TerminalTab[]
  activeTabId: string | null
  isCollapsed: boolean
}

const EMPTY_MESSAGE = "\x1b[90mSelect a project to open a terminal.\x1b[0m"
let cachedTerminalStateByProject: Record<string, ProjectTerminalState> = {}

function createTerminalTab(projectId: string): TerminalTab {
  return {
    id: `${projectId}:${crypto.randomUUID()}`,
  }
}

function getTerminalLabel(index: number, totalTabs: number) {
  return totalTabs <= 1 ? "Terminal" : `Terminal ${index + 1}`
}

function createProjectTerminalState(projectId: string) {
  const firstTab = createTerminalTab(projectId)

  return {
    tabs: [firstTab],
    activeTabId: firstTab.id,
    isCollapsed: false,
  }
}

export function TerminalPanel({ projectId, projectPath, className }: TerminalPanelProps) {
  const [terminalStateByProject, setTerminalStateByProject] = useState<Record<string, ProjectTerminalState>>(
    () => cachedTerminalStateByProject
  )

  useEffect(() => {
    cachedTerminalStateByProject = terminalStateByProject
  }, [terminalStateByProject])

  useEffect(() => {
    if (!projectId) {
      return
    }

    setTerminalStateByProject((current) => {
      if (current[projectId]) {
        return current
      }

      return {
        ...current,
        [projectId]: createProjectTerminalState(projectId),
      }
    })
  }, [projectId])

  const currentProjectState = useMemo(() => {
    if (!projectId) {
      return null
    }

    return terminalStateByProject[projectId] ?? null
  }, [projectId, terminalStateByProject])

  const activeTab = useMemo(() => {
    if (!currentProjectState) {
      return null
    }

    return currentProjectState.tabs.find((tab) => tab.id === currentProjectState.activeTabId) ?? null
  }, [currentProjectState])

  const handleAddTerminal = () => {
    if (!projectId) {
      return
    }

    setTerminalStateByProject((current) => {
      const projectState = current[projectId] ?? createProjectTerminalState(projectId)
      const nextTab = createTerminalTab(projectId)

      return {
        ...current,
        [projectId]: {
          ...projectState,
          tabs: [...projectState.tabs, nextTab],
          activeTabId: nextTab.id,
          isCollapsed: false,
        },
      }
    })
  }

  const handleSelectTerminal = (tabId: string) => {
    if (!projectId) {
      return
    }

    setTerminalStateByProject((current) => {
      const projectState = current[projectId]
      if (!projectState) {
        return current
      }

      return {
        ...current,
        [projectId]: {
          ...projectState,
          activeTabId: tabId,
          isCollapsed: false,
        },
      }
    })
  }

  const handleToggleCollapsed = () => {
    if (!projectId) {
      return
    }

    setTerminalStateByProject((current) => {
      const projectState = current[projectId] ?? createProjectTerminalState(projectId)

      return {
        ...current,
        [projectId]: {
          ...projectState,
          isCollapsed: !projectState.isCollapsed,
        },
      }
    })
  }

  const handleCloseTerminal = (tabId: string) => {
    if (!projectId) {
      return
    }

    void desktop.terminal.closeSession(`project-terminal:${tabId}`).catch((error) => {
      console.error("Failed to close terminal session:", error)
    })

    setTerminalStateByProject((current) => {
      const projectState = current[projectId] ?? createProjectTerminalState(projectId)
      const nextTabs = projectState.tabs.filter((tab) => tab.id !== tabId)

      if (nextTabs.length === 0) {
        return {
          ...current,
          [projectId]: {
            ...projectState,
            tabs: [],
            activeTabId: null,
          },
        }
      }

      const currentIndex = projectState.tabs.findIndex((tab) => tab.id === tabId)
      const fallbackTab = nextTabs[Math.max(0, currentIndex - 1)] ?? nextTabs[0]
      const nextActiveTabId =
        projectState.activeTabId === tabId ? fallbackTab.id : projectState.activeTabId

      return {
        ...current,
        [projectId]: {
          ...projectState,
          tabs: nextTabs,
          activeTabId: nextActiveTabId,
        },
      }
    })
  }

  const isCollapsed = currentProjectState?.isCollapsed ?? false

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col bg-sidebar",
        isCollapsed ? "h-auto" : "h-1/2 min-h-0",
        className
      )}
    >
      <Separator />
      <div className="relative shrink-0">
        <div className="flex h-8 min-w-0 items-center gap-0.5 overflow-x-auto px-2 no-scrollbar">
          <button
            type="button"
            onClick={handleToggleCollapsed}
            aria-label={isCollapsed ? "Expand terminal panel" : "Collapse terminal panel"}
            className="inline-flex h-7 shrink-0 items-center justify-center px-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            {isCollapsed ? <CaretUp className="size-3.5" /> : <CaretDown className="size-3.5" />}
          </button>

          {(currentProjectState?.tabs ?? []).map((tab, index, tabs) => {
            const isActive = tab.id === currentProjectState?.activeTabId
            const label = getTerminalLabel(index, tabs.length)

            return (
              <div
                key={tab.id}
                className={cn(
                  "group relative flex h-7 shrink-0 items-center overflow-hidden",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSelectTerminal(tab.id)}
                  className={cn(
                    "inline-flex h-full min-w-0 items-center px-2 text-xs font-medium transition-colors",
                    isActive ? "text-foreground" : "hover:text-foreground"
                  )}
                >
                  <span className="max-w-[88px] truncate">
                    {label}
                  </span>
                </button>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-6 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  style={{ background: "linear-gradient(to left, var(--sidebar) 60%, transparent)" }}
                />
                <button
                  type="button"
                  aria-label={`Close ${label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    handleCloseTerminal(tab.id)
                  }}
                  className="pointer-events-none absolute right-1 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-sm bg-sidebar text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
                <span
                  className={cn(
                    "absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground/70 transition-opacity",
                    isActive ? "opacity-100" : "opacity-0"
                  )}
                />
              </div>
            )
          })}

          <button
            type="button"
            onClick={() => {
              handleAddTerminal()
            }}
            disabled={!projectId}
            aria-label="New terminal"
            className="inline-flex h-7 shrink-0 items-center justify-center px-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <Separator />
      </div>
      {!isCollapsed ? (
        <Terminal
          sessionId={activeTab ? `project-terminal:${activeTab.id}` : null}
          cwd={projectPath}
          emptyStateMessage={EMPTY_MESSAGE}
          className="min-h-0 flex-1"
        />
      ) : null}
    </div>
  )
}
