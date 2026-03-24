import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { FileTreeViewer } from "@/features/version-control/components"
import { useProjectStore } from "@/features/workspace/store"
import { useTabStore } from "@/features/editor/store"
import { useChatStore } from "@/features/chat/store"
import { SkillsSidebarPanel } from "@/features/skills/components/SkillsPage"
import {
  loadProjectSecrets,
  saveProjectSecret,
  type ProjectSecretFieldDefinition,
} from "@/features/workspace/utils/envFiles"
import { readProjectFiles } from "@/features/workspace/utils/fileSystem"
import { useRightSidebar } from "./useRightSidebar"
import type { FileTreeItem } from "@/features/version-control/types"
import { Button, Input } from "@/features/shared/components/ui"
import { cn } from "@/lib/utils"
import { BookOpen, Eye, Folder, Plus } from "@/components/icons"

interface RightSidebarProps {
  activeView?: "chat" | "settings" | "automations"
}

type RightSidebarTab = "files" | "skills" | "secrets"

const RIGHT_SIDEBAR_TABS: Array<{
  key: RightSidebarTab
  label: string
  icon: typeof Folder
}> = [
  { key: "files", label: "Files", icon: Folder },
  { key: "skills", label: "Skills", icon: BookOpen },
  { key: "secrets", label: "Secrets", icon: Eye },
]

interface SecretFieldState {
  key: string
  label: string
  placeholder: string
  value: string
  savedValue: string
  isVisible: boolean
  sourceFile: string | null
  writeTargetFile: string
}

interface DraftSecretState {
  key: string
  value: string
  isVisible: boolean
}

function createSecretState(definition: ProjectSecretFieldDefinition): SecretFieldState {
  return {
    ...definition,
    value: definition.savedValue,
    isVisible: false,
  }
}

export function RightSidebar({ activeView = "chat" }: RightSidebarProps) {
  const [fileTreeData, setFileTreeData] = useState<Record<string, FileTreeItem>>({})
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [activeTab, setActiveTab] = useState<RightSidebarTab>("files")
  const [isSecretsLoading, setIsSecretsLoading] = useState(false)
  const [savingSecretKey, setSavingSecretKey] = useState<string | null>(null)
  const [secretsError, setSecretsError] = useState<string | null>(null)
  const [secretsByProject, setSecretsByProject] = useState<Record<string, SecretFieldState[]>>({})
  const [draftSecretByProject, setDraftSecretByProject] = useState<Record<string, DraftSecretState | null>>({})
  const { isCollapsed, width, setWidth } = useRightSidebar()
  const { projects, selectedProjectId } = useProjectStore()
  const { openFile, switchProject } = useTabStore()
  const { onFileChange } = useChatStore()
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  // Get the selected project
  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const selectedProjectSecrets = useMemo(() => {
    if (!selectedProjectId) {
      return []
    }

    return secretsByProject[selectedProjectId] ?? []
  }, [secretsByProject, selectedProjectId])
  const selectedProjectDraftSecret = useMemo(() => {
    if (!selectedProjectId) {
      return null
    }

    return draftSecretByProject[selectedProjectId] ?? null
  }, [draftSecretByProject, selectedProjectId])
  
  // Track refresh timeout for debouncing
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const secretsRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sidebarWidth = isCollapsed ? 0 : width

  // Load files function (showLoading only for initial load)
  const loadFiles = useCallback(async (isInitial = false) => {
    if (!selectedProject?.path) {
      setFileTreeData({})
      setIsInitialLoad(false)
      return
    }

    // Only show loading state on initial load
    if (isInitial) {
      setIsInitialLoad(true)
    }

    try {
      const data = await readProjectFiles(selectedProject.path)
      setFileTreeData(data)
    } catch (error) {
      console.error("Failed to load project files:", error)
      // Only clear on initial load failure, preserve existing data on refresh failure
      if (isInitial) {
        setFileTreeData({})
      }
    } finally {
      setIsInitialLoad(false)
    }
  }, [selectedProject?.path])

  // Debounced refresh (silent, no loading indicator)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current)
    }
    refreshTimeoutRef.current = setTimeout(() => {
      loadFiles(false) // Silent refresh
    }, 300) // Debounce 300ms to batch rapid changes
  }, [loadFiles])

  const loadSecrets = useCallback(async () => {
    if (!selectedProject?.path || !selectedProjectId) {
      setIsSecretsLoading(false)
      setSecretsError(null)
      return
    }

    setIsSecretsLoading(true)
    setSecretsError(null)

    try {
      const definitions = await loadProjectSecrets(selectedProject.path)
      setSecretsByProject((current) => ({
        ...current,
        [selectedProjectId]: definitions.map(createSecretState),
      }))
    } catch (error) {
      console.error("Failed to load project secrets:", error)
      setSecretsError("Couldn't read env files for this project.")
    } finally {
      setIsSecretsLoading(false)
    }
  }, [selectedProject?.path, selectedProjectId])

  const scheduleSecretsRefresh = useCallback(() => {
    if (secretsRefreshTimeoutRef.current) {
      clearTimeout(secretsRefreshTimeoutRef.current)
    }
    secretsRefreshTimeoutRef.current = setTimeout(() => {
      void loadSecrets()
    }, 300)
  }, [loadSecrets])

  // Switch project tabs and load files when selected project changes
  useEffect(() => {
    switchProject(selectedProjectId ?? null)
    loadFiles(true) // Initial load with loading indicator
    void loadSecrets()
  }, [selectedProjectId, switchProject, loadFiles, loadSecrets])

  const stopResizing = useCallback(() => {
    resizeStateRef.current = null
    document.documentElement.style.removeProperty("cursor")
    document.documentElement.style.removeProperty("user-select")
    document.documentElement.style.removeProperty("-webkit-user-select")
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
    document.body.style.removeProperty("-webkit-user-select")
  }, [])

  useEffect(() => {
    return () => {
      stopResizing()
    }
  }, [stopResizing])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) {
        return
      }

      const nextWidth = resizeState.startWidth - (event.clientX - resizeState.startX)
      setWidth(nextWidth)
    }

    const handlePointerUp = () => {
      stopResizing()
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [setWidth, stopResizing])

  // Subscribe to file change events from the active harness
  useEffect(() => {
    if (!selectedProject?.path) return

    const unsubscribe = onFileChange((event) => {
      // Check if the changed file is within the current project
      // Handle both absolute paths and relative paths
      const isAbsoluteMatch = event.file.startsWith(selectedProject.path)
      const isRelativePath = !event.file.startsWith("/")
      
      if (isAbsoluteMatch || isRelativePath) {
        scheduleRefresh()
      }

      const changedFileName = event.file.split("/").pop() ?? event.file
      if (changedFileName.startsWith(".env")) {
        scheduleSecretsRefresh()
      }
    })

    return () => {
      unsubscribe()
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
      }
      if (secretsRefreshTimeoutRef.current) {
        clearTimeout(secretsRefreshTimeoutRef.current)
      }
    }
  }, [selectedProject?.path, onFileChange, scheduleRefresh, scheduleSecretsRefresh])

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isCollapsed) {
      return
    }

    event.preventDefault()

    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
    }

    window.getSelection()?.removeAllRanges()
    document.documentElement.style.cursor = "col-resize"
    document.documentElement.style.userSelect = "none"
    document.documentElement.style.setProperty("-webkit-user-select", "none")
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.style.setProperty("-webkit-user-select", "none")
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const updateSecretField = useCallback((
    fieldKey: string,
    updater: (current: SecretFieldState) => SecretFieldState
  ) => {
    if (!selectedProjectId) {
      return
    }

    setSecretsByProject((current) => {
      const projectSecrets = current[selectedProjectId] ?? []

      return {
        ...current,
        [selectedProjectId]: projectSecrets.map((field) =>
          field.key === fieldKey ? updater(field) : field
        ),
      }
    })
  }, [selectedProjectId])

  const startDraftSecret = useCallback(() => {
    if (!selectedProjectId) {
      return
    }

    setDraftSecretByProject((current) => ({
      ...current,
      [selectedProjectId]: current[selectedProjectId] ?? {
        key: "",
        value: "",
        isVisible: true,
      },
    }))
    setSecretsError(null)
  }, [selectedProjectId])

  const updateDraftSecret = useCallback((
    updater: (current: DraftSecretState) => DraftSecretState
  ) => {
    if (!selectedProjectId) {
      return
    }

    setDraftSecretByProject((current) => {
      const draft = current[selectedProjectId]
      if (!draft) {
        return current
      }

      return {
        ...current,
        [selectedProjectId]: updater(draft),
      }
    })
  }, [selectedProjectId])

  const clearDraftSecret = useCallback(() => {
    if (!selectedProjectId) {
      return
    }

    setDraftSecretByProject((current) => ({
      ...current,
      [selectedProjectId]: null,
    }))
    setSecretsError(null)
  }, [selectedProjectId])

  const handleSaveSecret = useCallback(
    async (fieldKey: string) => {
      if (!selectedProject?.path || !selectedProjectId) {
        return
      }

      const field = selectedProjectSecrets.find((candidate) => candidate.key === fieldKey)
      if (!field) {
        return
      }

      const nextValue = field.value.trim()
      if (nextValue.length === 0 || nextValue === field.savedValue.trim()) {
        return
      }

      setSavingSecretKey(fieldKey)
      setSecretsError(null)

      try {
        await saveProjectSecret(selectedProject.path, fieldKey, nextValue)
        const definitions = await loadProjectSecrets(selectedProject.path)
        setSecretsByProject((current) => ({
          ...current,
          [selectedProjectId]: definitions.map(createSecretState),
        }))
      } catch (error) {
        console.error("Failed to save project secret:", error)
        setSecretsError(`Couldn't save ${field.label}.`)
      } finally {
        setSavingSecretKey(null)
      }
    },
    [selectedProject?.path, selectedProjectId, selectedProjectSecrets],
  )

  const handleSaveDraftSecret = useCallback(async () => {
    if (!selectedProject?.path || !selectedProjectId || !selectedProjectDraftSecret) {
      return
    }

    const draftKey = selectedProjectDraftSecret.key.trim().toUpperCase()
    const draftValue = selectedProjectDraftSecret.value.trim()

    if (!/^[A-Z_][A-Z0-9_]*$/.test(draftKey)) {
      setSecretsError("Secret keys must use letters, numbers, and underscores.")
      return
    }

    if (selectedProjectSecrets.some((field) => field.key === draftKey)) {
      setSecretsError(`${draftKey} already exists in this project.`)
      return
    }

    if (draftValue.length === 0) {
      setSecretsError("Enter a value before saving the secret.")
      return
    }

    setSavingSecretKey(draftKey)
    setSecretsError(null)

    try {
      await saveProjectSecret(selectedProject.path, draftKey, draftValue)
      const definitions = await loadProjectSecrets(selectedProject.path)
      setSecretsByProject((current) => ({
        ...current,
        [selectedProjectId]: definitions.map(createSecretState),
      }))
      setDraftSecretByProject((current) => ({
        ...current,
        [selectedProjectId]: null,
      }))
    } catch (error) {
      console.error("Failed to save project secret:", error)
      setSecretsError(`Couldn't save ${draftKey}.`)
    } finally {
      setSavingSecretKey(null)
    }
  }, [selectedProject?.path, selectedProjectId, selectedProjectDraftSecret, selectedProjectSecrets])

  if (isCollapsed || activeView !== "chat") {
    return null
  }

  return (
    <aside
      style={{ width: sidebarWidth }}
      className="relative min-w-[300px] max-w-[560px] shrink-0 border-l border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col"
    >
      {/* Header */}
      <div className="border-b border-sidebar-border px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-sidebar-accent p-1">
            {RIGHT_SIDEBAR_TABS.map(({ key, label, icon: Icon }) => {
              const isActive = activeTab === key

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-medium transition-colors cursor-pointer",
                    isActive
                      ? "bg-card text-card-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div
        className={cn(
          "flex-1",
          activeTab === "skills" ? "min-h-0" : "overflow-y-auto px-1.5 py-1.5"
        )}
      >
        {activeTab === "files" ? (
          isInitialLoad ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-sm text-muted-foreground">Loading files...</span>
            </div>
          ) : !selectedProject ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-sm text-muted-foreground">Select an agent to view files</span>
            </div>
          ) : Object.keys(fileTreeData).length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-sm text-muted-foreground">No files found</span>
            </div>
          ) : (
            <FileTreeViewer
              data={fileTreeData}
              initialExpanded={["root"]}
              onFileClick={openFile}
            />
          )
        ) : activeTab === "skills" ? (
          <SkillsSidebarPanel />
        ) : (
          <div className="space-y-2 px-1.5 py-1">
            {!selectedProject ? (
              <div className="flex items-center justify-center py-8">
                <span className="text-sm text-muted-foreground">Select an agent to manage secrets</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-2.5 py-2">
                  <p className="text-xs leading-5 text-muted-foreground">
                    Pulls secret-like keys from repo env files and saves edits into local overrides.
                  </p>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="shrink-0"
                    onClick={startDraftSecret}
                    disabled={selectedProjectDraftSecret != null}
                  >
                    <Plus className="size-3.5" />
                    Add secret
                  </Button>
                </div>

                {secretsError ? (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs leading-5 text-destructive">
                    {secretsError}
                  </div>
                ) : null}

                {isSecretsLoading && selectedProjectSecrets.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <span className="text-sm text-muted-foreground">Loading secrets...</span>
                  </div>
                ) : null}

                {selectedProjectDraftSecret ? (
                  <div className="rounded-xl border border-border bg-card px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">New secret</p>
                        <p className="mt-1 text-xs text-muted-foreground">Saves to .env.local</p>
                      </div>
                    </div>

                    <div className="mt-2 space-y-2">
                      <Input
                        value={selectedProjectDraftSecret.key}
                        placeholder="SECRET_KEY"
                        onChange={(event) =>
                          updateDraftSecret((current) => ({
                            ...current,
                            key: event.target.value,
                          }))
                        }
                      />
                      <div className="flex items-center gap-2">
                        <Input
                          type={selectedProjectDraftSecret.isVisible ? "text" : "password"}
                          value={selectedProjectDraftSecret.value}
                          placeholder="Enter value"
                          onChange={(event) =>
                            updateDraftSecret((current) => ({
                              ...current,
                              value: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateDraftSecret((current) => ({
                              ...current,
                              isVisible: !current.isVisible,
                            }))
                          }
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label={selectedProjectDraftSecret.isVisible ? "Hide secret" : "Show secret"}
                        >
                          <Eye className="size-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button type="button" size="xs" variant="ghost" onClick={clearDraftSecret}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          disabled={
                            savingSecretKey !== null ||
                            selectedProjectDraftSecret.key.trim().length === 0 ||
                            selectedProjectDraftSecret.value.trim().length === 0
                          }
                          onClick={() => void handleSaveDraftSecret()}
                        >
                          {savingSecretKey === selectedProjectDraftSecret.key.trim().toUpperCase()
                            ? "Saving..."
                            : "Add"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {!isSecretsLoading &&
                selectedProjectSecrets.length === 0 &&
                selectedProjectDraftSecret == null ? (
                  <div className="rounded-xl border border-dashed border-border bg-card px-2.5 py-4 text-center">
                    <p className="text-sm font-medium text-foreground">No secrets found yet</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Add the first secret and it will be written to `.env.local`.
                    </p>
                  </div>
                ) : null}

                {selectedProjectSecrets.map((state) => {
                  const hasSavedValue = state.savedValue.trim().length > 0
                  const isDirty = state.value.trim() !== state.savedValue.trim()
                  const syncHint =
                    state.sourceFile == null
                      ? `Saves to ${state.writeTargetFile}`
                      : state.sourceFile.endsWith(".example")
                        ? `Discovered in ${state.sourceFile} · saves to ${state.writeTargetFile}`
                      : state.sourceFile === state.writeTargetFile
                        ? `Stored in ${state.sourceFile}`
                        : `Read from ${state.sourceFile} · saves to ${state.writeTargetFile}`

                  return (
                    <div
                      key={state.key}
                      className="rounded-xl border border-border bg-card px-2.5 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{state.label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{syncHint}</p>
                        </div>
                        {hasSavedValue ? (
                          <button
                            type="button"
                            onClick={() =>
                              updateSecretField(state.key, (current) => ({
                                ...current,
                                isVisible: !current.isVisible,
                              }))
                            }
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            aria-label={state.isVisible ? "Hide secret" : "Show secret"}
                          >
                            <Eye className="size-4" />
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          type={hasSavedValue && !state.isVisible ? "password" : "text"}
                          value={state.value}
                          placeholder={state.placeholder}
                          onChange={(event) =>
                            updateSecretField(state.key, (current) => ({
                              ...current,
                              value: event.target.value,
                            }))
                          }
                        />
                        <Button
                          type="button"
                          disabled={state.value.trim().length === 0 || !isDirty || savingSecretKey === state.key}
                          onClick={() => void handleSaveSecret(state.key)}
                        >
                          {savingSecretKey === state.key ? "Saving..." : "Save"}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right sidebar"
        onPointerDown={handleResizeStart}
        className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize"
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent hover:bg-sidebar-border/90" />
      </div>
    </aside>
  )
}
