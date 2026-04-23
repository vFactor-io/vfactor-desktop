import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { desktop, type GitPullRequest } from "@/desktop/client"
import { CheckCircle, Folder, GitDiff, Globe } from "@/components/icons"
import { BrowserSidebar } from "@/features/browser/components/BrowserSidebar"
import { ChangesPanel, FilePreviewPanel, FileTreeViewer } from "@/features/version-control/components"
import { useFileTreeStore } from "@/features/workspace/store"
import { useTabStore } from "@/features/editor/store"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import {
  useProjectGitBranches,
  useProjectGitChanges,
  useProjectGitPullRequestChecks,
} from "@/features/shared/hooks"
import { PullRequestChecksPanel } from "./PullRequestChecksPanel"
import { getChecksTabBadgeCount, shouldAutoOpenChecksTab } from "./pullRequestChecks"
import { useRightSidebar } from "./useRightSidebar"
import { SidebarShell } from "./SidebarShell"
import { RightSidebarEmptyState } from "./RightSidebarEmptyState"
import { useResizablePanel } from "./useResizablePanel"
import { HorizontalOverflowFade } from "@/features/shared/components/ui"
import { cn } from "@/lib/utils"
import { prewarmProjectData } from "@/features/shared/utils/prewarmProjectData"
import { RIGHT_SIDEBAR_WIDTH_CSS_VAR } from "./layoutSizing"

interface RightSidebarProps {
  activeView?: "chat" | "settings" | "automations"
}

const RIGHT_SIDEBAR_TABS: Array<{
  key: "files" | "changes" | "checks" | "browser"
  label: string
  icon: typeof Folder
}> = [
  { key: "files", label: "Files", icon: Folder },
  { key: "changes", label: "Changes", icon: GitDiff },
  { key: "checks", label: "Checks", icon: CheckCircle },
  { key: "browser", label: "Browser", icon: Globe },
]
const COLLAPSED_HOVER_TRIGGER_WIDTH = 12
const FILES_TREE_PANEL_WIDTH_CSS_VAR = "--files-tree-panel-width"
const FILES_TREE_PANEL_MIN_WIDTH = 180
const FILES_PREVIEW_PANEL_MIN_WIDTH = 260

export function RightSidebar({ activeView = "chat" }: RightSidebarProps) {
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [fileImportError, setFileImportError] = useState<string | null>(null)
  const [isImportingFiles, setIsImportingFiles] = useState(false)
  const [isHoverPreviewOpen, setIsHoverPreviewOpen] = useState(false)
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<{
    path: string
    name: string
  } | null>(null)
  const previousChecksStatusByPullRequestRef = useRef<
    Map<string, GitPullRequest["checksStatus"] | null>
  >(new Map())
  const { isAvailable, isCollapsed, width, clampWidth, setWidth, persistWidth, activeTab, setActiveTab, expand, toggle } = useRightSidebar()
  const [filesTreePanelWidth, setFilesTreePanelWidth] = useState(() =>
    Math.round(Math.max(FILES_TREE_PANEL_MIN_WIDTH, width / 3))
  )
  const { selectedWorktreeId, selectedWorktree, selectedWorktreePath } = useCurrentProjectWorktree()
  const {
    activeProjectPath,
    dataByProjectPath,
    loadingByProjectPath,
    initialize: initializeFileTreeStore,
    setActiveProjectPath,
    refreshActiveProject,
  } = useFileTreeStore()
  const {
    initialize: initializeTabs,
    isInitialized: isTabsInitialized,
    switchProject,
  } = useTabStore()
  const { branchData } = useProjectGitBranches(selectedWorktreePath, { enabled: Boolean(selectedWorktreePath) })
  const {
    changes: projectChanges,
    isLoading: isChangesLoading,
    loadError: changesError,
  } = useProjectGitChanges(selectedWorktreePath, {
    enabled: Boolean(selectedWorktreePath) && activeView === "chat",
  })
  const trackedProjectChanges = useMemo(
    () => projectChanges.filter((change) => change.status !== "untracked"),
    [projectChanges]
  )
  const openPullRequest = branchData?.openPullRequest ?? null
  const shouldLoadChecks = openPullRequest?.state === "open"
  const {
    checks: pullRequestChecks,
    comments: pullRequestComments,
    reviews: pullRequestReviews,
    reviewComments: pullRequestReviewComments,
    isLoading: isPullRequestChecksLoading,
    loadError: pullRequestChecksError,
  } = useProjectGitPullRequestChecks(selectedWorktreePath, {
    enabled: Boolean(selectedWorktreePath) && shouldLoadChecks,
  })
  const gitMissing = branchData != null && !branchData.isGitAvailable
  const gitUninitialized = branchData != null && branchData.isGitAvailable && !branchData.isRepo
  const checksTabBadgeCount = getChecksTabBadgeCount(openPullRequest, pullRequestChecks)

  const fileTreeData = activeProjectPath ? (dataByProjectPath[activeProjectPath] ?? {}) : {}
  const isFileTreeLoading = activeProjectPath ? (loadingByProjectPath[activeProjectPath] ?? false) : false
  const selectedWorktreePathMatchesFileTree =
    Boolean(selectedWorktreePath) && activeProjectPath === selectedWorktreePath

  const clampFilesTreePanelWidth = useCallback(
    (nextWidth: number) => {
      const maxWidth = Math.max(FILES_TREE_PANEL_MIN_WIDTH, width - FILES_PREVIEW_PANEL_MIN_WIDTH)
      return Math.min(Math.max(Math.round(nextWidth), FILES_TREE_PANEL_MIN_WIDTH), maxWidth)
    },
    [width]
  )

  const { handleResizeStart: handleFilesPanelResizeStart, isResizing: isResizingFilesPanel } =
    useResizablePanel({
      width: clampFilesTreePanelWidth(filesTreePanelWidth),
      setWidth: setFilesTreePanelWidth,
      isCollapsed: activeTab !== "files",
      widthCssVariable: FILES_TREE_PANEL_WIDTH_CSS_VAR,
      clampWidth: clampFilesTreePanelWidth,
      side: "left",
    })

  const resolvedFilesTreePanelWidth = clampFilesTreePanelWidth(filesTreePanelWidth)

  // Switch project tabs and load files when selected project changes
  useEffect(() => {
    void initializeTabs()
  }, [initializeTabs])

  useEffect(() => {
    if (!isTabsInitialized) {
      return
    }

    switchProject(selectedWorktreeId ?? null)
  }, [isTabsInitialized, selectedWorktreeId, switchProject])

  useEffect(() => {
    void initializeFileTreeStore()
  }, [initializeFileTreeStore])

  useEffect(() => {
    setFileImportError(null)
    setIsImportingFiles(false)
    setSelectedPreviewFile(null)
  }, [selectedWorktreePath])

  useEffect(() => {
    setFilesTreePanelWidth((current) => clampFilesTreePanelWidth(current))
  }, [clampFilesTreePanelWidth])

  useEffect(() => {
    if (!selectedPreviewFile) {
      return
    }

    const nextEntry = fileTreeData[selectedPreviewFile.path]
    if (!nextEntry || nextEntry.isDirectory) {
      setSelectedPreviewFile(null)
    }
  }, [fileTreeData, selectedPreviewFile])

  useEffect(() => {
    setIsInitialLoad(true)

    void setActiveProjectPath(selectedWorktreePath ?? null).finally(() => {
      setIsInitialLoad(false)
    })
  }, [selectedWorktreePath, setActiveProjectPath])

  useEffect(() => {
    const pullRequestKey =
      selectedWorktreePath && openPullRequest?.state === "open"
        ? `${selectedWorktreePath}:${openPullRequest.number}`
        : null
    const previousChecksStatus = pullRequestKey
      ? (previousChecksStatusByPullRequestRef.current.get(pullRequestKey) ?? null)
      : null
    const nextChecksStatus = openPullRequest?.checksStatus ?? null

    if (pullRequestKey && shouldAutoOpenChecksTab(previousChecksStatus, nextChecksStatus)) {
      expand()
      setActiveTab("checks")
    }

    if (pullRequestKey) {
      previousChecksStatusByPullRequestRef.current.set(pullRequestKey, nextChecksStatus)
    }
  }, [
    activeTab,
    expand,
    isCollapsed,
    openPullRequest?.checksStatus,
    openPullRequest?.number,
    openPullRequest?.state,
    selectedWorktreePath,
    setActiveTab,
  ])

  const handleExternalFileDrop = useCallback(
    async (sourcePaths: string[], targetDirectory: string) => {
      if (!selectedWorktreePath) {
        return
      }

      setIsImportingFiles(true)
      setFileImportError(null)

      try {
        await desktop.fs.copyPathsIntoDirectory(sourcePaths, targetDirectory)
        await refreshActiveProject()
      } catch (error) {
        console.error("Failed to import dropped files into project:", error)
        setFileImportError(
          error instanceof Error ? error.message : "Couldn't add those files to the project."
        )
      } finally {
        setIsImportingFiles(false)
      }
    },
    [refreshActiveProject, selectedWorktreePath]
  )

  const handleTabIntent = useCallback(
    (tab: "files" | "changes" | "checks" | "browser") => {
      void prewarmProjectData(selectedWorktreeId, selectedWorktreePath, tab)
    },
    [selectedWorktreeId, selectedWorktreePath]
  )
  const handleHoverPreviewIntent = useCallback(() => {
    void prewarmProjectData(selectedWorktreeId, selectedWorktreePath, activeTab)
  }, [activeTab, selectedWorktreeId, selectedWorktreePath])

  const handleFilePreviewSelect = useCallback((filePath: string, fileName: string) => {
    setSelectedPreviewFile((current) =>
      current?.path === filePath && current.name === fileName
        ? current
        : { path: filePath, name: fileName }
    )
  }, [])

  useEffect(() => {
    if (!isCollapsed && isHoverPreviewOpen) {
      setIsHoverPreviewOpen(false)
    }
  }, [isCollapsed, isHoverPreviewOpen])

  useEffect(() => {
    if ((!isAvailable || activeView !== "chat") && isHoverPreviewOpen) {
      setIsHoverPreviewOpen(false)
    }
  }, [activeView, isAvailable, isHoverPreviewOpen])

  if (!isAvailable || activeView !== "chat") {
    return null
  }

  const renderSidebarBody = (isResizingTabs: boolean) => (
    <>
        <div className="shrink-0 px-3 py-1.5">
          <HorizontalOverflowFade viewportClassName="w-full" contentClassName="pr-3">
            <div className="flex items-center gap-1">
            {RIGHT_SIDEBAR_TABS.map(({ key, label, icon: Icon }) => {
              const isActive = activeTab === key

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  onPointerEnter={() => handleTabIntent(key)}
                  className={cn(
                    "group relative inline-flex h-6 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-none",
                    !isResizingTabs && "transition-colors",
                    isActive
                      ? "text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/56 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
                  )}
                >
                  {isActive && (
                    <span className="absolute inset-0 rounded-lg bg-[var(--sidebar-item-active)]" />
                  )}
                  <span className="relative z-10 flex items-center gap-1">
                    <Icon className="size-3.5 shrink-0" />
                    <span>{label}</span>
                  </span>
                  {key === "changes" && trackedProjectChanges.length > 0 ? (
                    <span
                      className={cn(
                        "relative z-10 text-[9px] leading-none",
                        isActive
                          ? "text-sidebar-accent-foreground/70"
                          : "text-sidebar-foreground/40"
                      )}
                    >
                      {trackedProjectChanges.length}
                    </span>
                  ) : null}
                  {key === "checks" && checksTabBadgeCount > 0 ? (
                    <span
                      className={cn(
                        "relative z-10 text-[9px] leading-none",
                        isActive
                          ? "text-sidebar-accent-foreground/70"
                          : "text-sidebar-foreground/40"
                      )}
                    >
                      {checksTabBadgeCount}
                    </span>
                  ) : null}
                </button>
              )
            })}
            </div>
          </HorizontalOverflowFade>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col",
              activeTab === "browser" || activeTab === "files"
                ? "overflow-hidden pt-1.5"
                : "app-scrollbar-sm overflow-y-auto px-1.5 py-1.5"
            )}
          >
            <div
              className={cn(
                "min-h-0 w-full flex-1",
                activeTab === "browser" ? "flex" : "hidden"
              )}
              aria-hidden={activeTab === "browser" ? undefined : true}
            >
              <BrowserSidebar />
            </div>

            {activeTab === "files" ? (
              isInitialLoad || isFileTreeLoading ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-sm text-muted-foreground">Loading files...</span>
                </div>
              ) : !selectedWorktree ? (
                <RightSidebarEmptyState
                  title="No project selected"
                  description="Choose a worktree to browse files in this panel."
                />
              ) : (
                <div className="flex h-full flex-col gap-2">
                  {isImportingFiles ? (
                    <div className="px-0.5 py-1 text-xs leading-5 text-muted-foreground">
                      Importing dropped files into the project...
                    </div>
                  ) : null}

                  {fileImportError ? (
                    <div className="px-0.5 py-1 text-xs leading-5 text-destructive">
                      {fileImportError}
                    </div>
                  ) : null}

                  {!selectedWorktreePathMatchesFileTree ? (
                    <div className="flex items-center justify-center py-8">
                      <span className="text-sm text-muted-foreground">Loading files...</span>
                    </div>
                  ) : Object.keys(fileTreeData).length === 0 ? (
                    <RightSidebarEmptyState
                      title="No files yet"
                      description="This project folder is empty right now."
                    />
                  ) : (
                    <div className="flex h-full min-h-0">
                      <div
                        style={{
                          width: `var(${FILES_TREE_PANEL_WIDTH_CSS_VAR}, ${resolvedFilesTreePanelWidth}px)`,
                        }}
                        className="min-h-0 shrink-0 overflow-hidden pr-2"
                      >
                        <FileTreeViewer
                          data={fileTreeData}
                          initialExpanded={["root"]}
                          projectPath={selectedWorktree.path}
                          onFileClick={handleFilePreviewSelect}
                          onExternalDrop={handleExternalFileDrop}
                        />
                      </div>

                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize files panels"
                        onPointerDown={handleFilesPanelResizeStart}
                        className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize"
                      >
                        <div
                          className={cn(
                            "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-sidebar-border/70 transition-colors",
                            isResizingFilesPanel
                              ? "bg-sidebar-border"
                              : "group-hover:bg-sidebar-border/95"
                          )}
                        />
                      </div>

                      <div className="min-h-0 min-w-0 flex-1 border-l border-sidebar-border/80 pl-2">
                        {selectedPreviewFile ? (
                          <FilePreviewPanel
                            key={selectedPreviewFile.path}
                            fileName={selectedPreviewFile.name}
                            filePath={selectedPreviewFile.path}
                            projectPath={selectedWorktree.path}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                            Select a file to preview it here.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : activeTab === "browser" ? null : activeTab === "changes" ? (
              !selectedWorktree ? (
                <RightSidebarEmptyState
                  title="No project selected"
                  description="Choose a worktree to inspect local changes."
                />
              ) : gitMissing ? (
                <RightSidebarEmptyState
                  title="Git not installed"
                  description="Install Git on this machine to inspect tracked changes for this project."
                />
              ) : gitUninitialized ? (
                <RightSidebarEmptyState
                  title="Git not initialized"
                  description="Initialize Git for this project to inspect tracked changes here."
                />
              ) : isChangesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-sm text-muted-foreground">Loading changes...</span>
                </div>
              ) : changesError ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs leading-5 text-destructive">
                  {changesError}
                </div>
              ) : trackedProjectChanges.length === 0 ? (
                <RightSidebarEmptyState
                  title="No tracked changes"
                  description="This worktree has no tracked file changes right now."
                />
              ) : (
                <ChangesPanel
                  projectPath={selectedWorktree.path}
                  changes={trackedProjectChanges}
                />
              )
            ) : !selectedWorktree ? (
              <RightSidebarEmptyState
                title="No project selected"
                description="Choose a worktree to inspect pull request checks."
              />
            ) : gitMissing ? (
              <RightSidebarEmptyState
                title="Git not installed"
                description="Install Git on this machine to inspect pull request checks for this project."
              />
            ) : gitUninitialized ? (
              <RightSidebarEmptyState
                title="Git not initialized"
                description="Initialize Git for this project before checking pull request status."
              />
            ) : (
              <PullRequestChecksPanel
                pullRequest={openPullRequest}
                checks={pullRequestChecks}
                comments={pullRequestComments}
                reviews={pullRequestReviews}
                reviewComments={pullRequestReviewComments}
                isLoading={isPullRequestChecksLoading}
                loadError={pullRequestChecksError ?? openPullRequest?.checksError ?? null}
              />
            )}
          </div>
        </div>
    </>
  )

  return (
    <>
      {isCollapsed ? (
        <>
          <div
            className="fixed top-11 right-0 bottom-0 z-30"
            style={{ width: COLLAPSED_HOVER_TRIGGER_WIDTH }}
            onMouseEnter={() => {
              handleHoverPreviewIntent()
              setIsHoverPreviewOpen(true)
            }}
          />
          {isHoverPreviewOpen ? (
            <div
              className="fixed top-11 right-0 bottom-0 z-30 flex flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[-12px_0_28px_rgba(0,0,0,0.12)]"
              style={{ width: `var(${RIGHT_SIDEBAR_WIDTH_CSS_VAR}, ${width}px)` }}
              onMouseEnter={() => setIsHoverPreviewOpen(true)}
              onMouseLeave={() => setIsHoverPreviewOpen(false)}
            >
              {renderSidebarBody(false)}
            </div>
          ) : null}
        </>
      ) : null}

      <SidebarShell
        width={width}
        setWidth={setWidth}
        clampWidth={clampWidth}
        persistWidth={persistWidth}
        isCollapsed={isCollapsed}
        side="right"
        sizeConstraintClass={activeTab === "browser" ? "min-w-[180px]" : "min-w-[300px]"}
      >
        {({ isResizing }) => (
          <>
            {renderSidebarBody(isResizing)}
          </>
        )}
      </SidebarShell>
    </>
  )
}
