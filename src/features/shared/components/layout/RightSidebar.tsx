import { useState, useEffect, useCallback, useRef } from "react"
import { FileTreeViewer } from "@/features/version-control/components"
import { useProjectStore } from "@/features/workspace/store"
import { useTabStore } from "@/features/editor/store"
import { useChatStore } from "@/features/chat/store"
import { readProjectFiles } from "@/features/workspace/utils/fileSystem"
import { useRightSidebar } from "./useRightSidebar"
import type { FileTreeItem } from "@/features/version-control/types"

interface RightSidebarProps {
  activeView?: "chat" | "settings" | "skills" | "automations"
}

export function RightSidebar({ activeView = "chat" }: RightSidebarProps) {
  const [fileTreeData, setFileTreeData] = useState<Record<string, FileTreeItem>>({})
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const { isCollapsed } = useRightSidebar()
  const { projects, selectedProjectId } = useProjectStore()
  const { openFile, switchProject } = useTabStore()
  const { onFileChange } = useChatStore()

  // Get the selected project
  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  
  // Track refresh timeout for debouncing
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Switch project tabs and load files when selected project changes
  useEffect(() => {
    switchProject(selectedProjectId ?? null)
    loadFiles(true) // Initial load with loading indicator
  }, [selectedProjectId, switchProject, loadFiles])

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
    })

    return () => {
      unsubscribe()
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
      }
    }
  }, [selectedProject?.path, onFileChange, scheduleRefresh])

  if (isCollapsed || activeView !== "chat") {
    return null
  }

  return (
    <aside className="w-[400px] max-w-[400px] min-w-48 shrink bg-sidebar text-sidebar-foreground border-l border-sidebar-border flex flex-col">
      {/* Header */}
      <div className="h-12 bg-sidebar border-b border-sidebar-border flex items-center px-4 shrink-0">
        <span className="text-sm text-sidebar-foreground">Files</span>
        {selectedProject && (
          <span className="text-xs text-muted-foreground ml-2 truncate">
            - {selectedProject.name}
          </span>
        )}
      </div>

      {/* Content area */}
      <div className="overflow-y-auto px-2 py-2 flex-1">
        {isInitialLoad ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-muted-foreground">Loading files...</span>
          </div>
        ) : !selectedProject ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-sm text-muted-foreground">Select a project to view files</span>
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
        )}
      </div>

    </aside>
  )
}
