import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { desktop } from "@/desktop/client"
import { CaretDown, PencilSimple, Plus } from "@/components/icons"
import {
  formatShortcutBinding,
  matchesShortcutBinding,
} from "@/features/settings/shortcuts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import { useRightSidebar } from "@/features/shared/components/layout/useRightSidebar"
import { Button } from "@/features/shared/components/ui/button"
import { useTerminalStore } from "@/features/terminal/store/terminalStore"
import { useProjectStore } from "@/features/workspace/store"
import type { ProjectAction } from "@/features/workspace/types"
import {
  getPrimaryProjectAction,
  getProjectActionCommands,
} from "@/features/workspace/utils/projectActions"
import { ProjectActionIcon } from "@/features/workspace/components/ProjectActionIcon"
import { AddProjectActionModal } from "@/features/workspace/components/modals/AddProjectActionModal"
import { cn } from "@/lib/utils"

const ACTION_TERMINAL_COLS = 120
const ACTION_TERMINAL_ROWS = 32

export function ProjectActionsControl() {
  const { projects, selectedProjectId, setPrimaryAction } = useProjectStore()
  const getOrCreateActiveTabId = useTerminalStore((state) => state.getOrCreateActiveTabId)
  const selectTerminal = useTerminalStore((state) => state.selectTerminal)
  const setProjectCollapsed = useTerminalStore((state) => state.setProjectCollapsed)
  const { expand } = useRightSidebar()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [runningActionId, setRunningActionId] = useState<string | null>(null)
  const [editingAction, setEditingAction] = useState<ProjectAction | null>(null)
  const actionGroupRef = useRef<HTMLDivElement | null>(null)
  const actionMenuRef = useRef<HTMLDivElement | null>(null)

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )
  const actions = selectedProject?.actions ?? []
  const primaryAction = getPrimaryProjectAction(selectedProject)

  const runAction = useCallback(async (action: ProjectAction, promote = false) => {
    if (!selectedProject) {
      return
    }

    setRunningActionId(action.id)
    expand()
    setProjectCollapsed(selectedProject.id, false)

    try {
      const tabId = getOrCreateActiveTabId(selectedProject.id)
      const sessionId = `project-terminal:${tabId}`
      const commandLines = getProjectActionCommands(action.command)

      if (commandLines.length === 0) {
        return
      }

      selectTerminal(selectedProject.id, tabId)

      await desktop.terminal.createSession(
        sessionId,
        selectedProject.path,
        ACTION_TERMINAL_COLS,
        ACTION_TERMINAL_ROWS,
      )
      await desktop.terminal.write(sessionId, `${commandLines.join("\n")}\n`)

      if (promote && selectedProject.primaryActionId !== action.id) {
        await setPrimaryAction(selectedProject.id, action.id)
      }
    } catch (error) {
      console.error(`Failed to run project action "${action.name}":`, error)
    } finally {
      setRunningActionId((current) => (current === action.id ? null : current))
    }
  }, [expand, getOrCreateActiveTabId, selectTerminal, selectedProject, setPrimaryAction, setProjectCollapsed])

  useEffect(() => {
    if (!selectedProject || actions.length === 0 || isModalOpen) {
      return
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return
      }

      const matchingAction = actions.find(
        (action) => action.hotkey && matchesShortcutBinding(event, action.hotkey),
      )

      if (!matchingAction) {
        return
      }

      event.preventDefault()
      void runAction(matchingAction, true)
    }

    window.addEventListener("keydown", handleWindowKeyDown)
    return () => window.removeEventListener("keydown", handleWindowKeyDown)
  }, [actions, isModalOpen, runAction, selectedProject])

  useEffect(() => {
    if (!isMenuOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) {
        return
      }

      if (actionGroupRef.current?.contains(target) || actionMenuRef.current?.contains(target)) {
        return
      }

      setIsMenuOpen(false)
    }

    window.addEventListener("pointerdown", handlePointerDown, true)
    return () => window.removeEventListener("pointerdown", handlePointerDown, true)
  }, [isMenuOpen])

  if (!selectedProject) {
    return null
  }

  const openCreateModal = () => {
    setEditingAction(null)
    setIsModalOpen(true)
  }

  const openEditModal = (action: ProjectAction) => {
    setEditingAction(action)
    setIsMenuOpen(false)
    setIsModalOpen(true)
  }

  return (
    <>
      {actions.length === 0 || !primaryAction ? (
        <Button
          type="button"
          onClick={openCreateModal}
          size="sm"
          variant="outline"
          className="h-7 rounded-lg border-border/70 bg-card px-2 text-foreground shadow-none hover:bg-accent"
        >
          <Plus size={14} className="text-muted-foreground" />
          <span>Add action</span>
        </Button>
      ) : (
        <div
          ref={actionGroupRef}
          className="inline-flex h-7 items-stretch overflow-hidden rounded-lg border border-border/70 bg-card shadow-none"
        >
          <button
            type="button"
            onClick={() => void runAction(primaryAction)}
            disabled={runningActionId === primaryAction.id}
            className={cn(
              "inline-flex h-full min-w-0 items-center gap-1.5 border-0 bg-transparent px-2 text-sm font-medium text-foreground transition-colors",
              "hover:bg-accent/80 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          >
            <ProjectActionIcon action={primaryAction} size={16} className="shrink-0 text-muted-foreground" />
            <span className="max-w-[120px] truncate">{primaryAction.name}</span>
          </button>
          <div className="w-px shrink-0 bg-border/80" aria-hidden="true" />
          <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex h-full w-8 items-center justify-center border-0 bg-transparent px-0 text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  aria-label="Open project actions menu"
                />
              }
            >
              <CaretDown size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              ref={actionMenuRef}
              align="end"
              sideOffset={8}
              className="w-48 border border-border/70 bg-card p-1 shadow-lg"
            >
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  onClick={() => {
                    setIsMenuOpen(false)
                    void runAction(action, true)
                  }}
                  className="group/action-item min-h-8 gap-2 px-2 py-1"
                >
                  <ProjectActionIcon action={action} size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">{action.name}</span>
                  {action.hotkey ? (
                    <DropdownMenuShortcut className="group-hover/action-item:hidden">
                      {formatShortcutBinding(action.hotkey)}
                    </DropdownMenuShortcut>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Edit ${action.name}`}
                    className="hidden size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent group-hover/action-item:flex"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      openEditModal(action)
                    }}
                  >
                    <PencilSimple size={14} />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="my-2" />
              <DropdownMenuItem
                onClick={() => {
                  setIsMenuOpen(false)
                  openCreateModal()
                }}
                className="min-h-8 gap-2 px-2 py-1 font-medium"
              >
                <Plus size={14} className="text-muted-foreground" />
                <span>Add action</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <AddProjectActionModal
        open={isModalOpen}
        project={selectedProject}
        action={editingAction}
        onOpenChange={(open) => {
          setIsModalOpen(open)
          if (!open) {
            setEditingAction(null)
          }
        }}
      />
    </>
  )
}
