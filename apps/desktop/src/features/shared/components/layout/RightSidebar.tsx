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
import {
  getChecksTabBadgeCount,
  isActionablePullRequestChecksError,
  shouldAutoOpenChecksTab,
} from "./pullRequestChecks"
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
const FILES_TREE_PANEL_WIDTH_CSS_VAR = "--files-tree-panel-width"
const FILES_TREE_PANEL_MIN_WIDTH = 180
const FILES_PREVIEW_PANEL_MIN_WIDTH = 260

export function RightSidebar({ activeView = "chat" }: RightSidebarProps) {
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const [fileImportError, setFileImportError] = useState<string | null>(null)
  const [isImportingFiles, setIsImportingFiles] = useState(false)
  const [browserToolbarContainer, setBrowserToolbarContainer] = useState<HTMLDivElement | null>(null)
  const [selectedPreviewFile, setSelectedPreviewFile] = useState<{
    path: string
    name: string
  } | null>(null)
  const previousChecksStatusByPullRequestRef = useRef<
    Map<string, GitPullRequest["checksStatus"] | null>
  >(new Map())
  const { isAvailable, isCollapsed, width, clampWidth, setWidth, persistWidth, activeTab, setActiveTab, expand, toggle } = useRightSidebar()
  const [filesTreePanelWidth, setFilesTreePanelWidth] = useState(() =>
    Math.round(Math.max(FILES_TREE_PANEL_MIN_WIDTH, width * 0.32))
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
    commits: pullRequestCommits,
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
  const pullRequestChecksLoadError =
    !isPullRequestChecksLoading &&
    openPullRequest?.checksStatus !== "pending" &&
    isActionablePullRequestChecksError(pullRequestChecksError ?? openPullRequest?.checksError)
      ? (pullRequestChecksError ?? openPullRequest?.checksError ?? null)
      : null

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
      side: "right",
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

  const handleFilePreviewSelect = useCallback((filePath: string, fileName: string) => {
    setSelectedPreviewFile((current) =>
      current?.path === filePath && current.name === fileName
        ? current
        : { path: filePath, name: fileName }
    )
  }, [])

  const setToolbarSlotRef = useCallback(
    (node: HTMLDivElement | null) => {
      setBrowserToolbarContainer(activeTab === "browser" ? node : null)
    },
    [activeTab]
  )

  if (!isAvailable || activeView !== "chat") {
    return null
  }

  const renderSidebarBody = (isResizingTabs: boolean) => (
    <>
        <div className="flex shrink-0 flex-col">
          <div className="flex h-12 items-center px-3">
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
                        "group relative inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs leading-none",
                        !isResizingTabs && "transition-colors",
                        isActive
                          ? "text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
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
                              : "text-sidebar-foreground/72"
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
                              : "text-sidebar-foreground/72"
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

          {activeTab === "browser" ? (
            <div
              ref={setToolbarSlotRef}
              className="flex min-h-10 min-w-0 items-center border-t border-sidebar-border/70 px-3 py-1.5"
            />
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className={cn(
                "min-h-0 w-full flex-1",
                activeTab === "browser" ? "flex" : "hidden"
              )}
              aria-hidden={activeTab === "browser" ? undefined : true}
            >
              <BrowserSidebar toolbarContainer={browserToolbarContainer} />
            </div>

            {activeTab === "files" ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 border-t border-sidebar-border/70 bg-[var(--right-sidebar-content-bg)] [--right-sidebar-content-bg:var(--background)]">
                  {isInitialLoad || isFileTreeLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <span className="text-sm text-muted-foreground">Loading files...</span>
                    </div>
                  ) : !selectedWorktree ? (
                    <RightSidebarEmptyState
                      icon={Folder}
                      title="No project selected"
                      description="Choose a worktree to browse files in this panel."
                    />
                  ) : (
                    <div className="flex h-full flex-col">
                      {isImportingFiles ? (
                        <div className="px-2 py-1 text-xs leading-5 text-muted-foreground">
                          Importing dropped files into the project...
                        </div>
                      ) : null}

                      {fileImportError ? (
                        <div className="px-2 py-1 text-xs leading-5 text-destructive">
                          {fileImportError}
                        </div>
                      ) : null}

                      {!selectedWorktreePathMatchesFileTree ? (
                        <div className="flex items-center justify-center py-8">
                          <span className="text-sm text-muted-foreground">Loading files...</span>
                        </div>
                      ) : Object.keys(fileTreeData).length === 0 ? (
                        <RightSidebarEmptyState
                          icon={Folder}
                          title="No files yet"
                          description="This project folder is empty right now."
                        />
                      ) : (
                        <div className="flex min-h-0 flex-1">
                          <div className="min-h-0 min-w-0 flex-1 pr-2 pt-1.5">
                            {selectedPreviewFile ? (
                              <FilePreviewPanel
                                key={selectedPreviewFile.path}
                                fileName={selectedPreviewFile.name}
                                filePath={selectedPreviewFile.path}
                                projectPath={selectedWorktree.path}
                              />
                            ) : (
                              <RightSidebarEmptyState
                                icon={Folder}
                                title="Select a file"
                                description="Choose a file from the project tree to preview it here."
                              />
                            )}
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

                          <div
                            style={{
                              width: `var(${FILES_TREE_PANEL_WIDTH_CSS_VAR}, ${resolvedFilesTreePanelWidth}px)`,
                            }}
                            className="min-h-0 shrink-0 overflow-hidden border-l border-sidebar-border/80 pl-2 pt-1.5"
                          >
                            <FileTreeViewer
                              data={fileTreeData}
                              initialExpanded={["root"]}
                              projectPath={selectedWorktree.path}
                              onFileClick={handleFilePreviewSelect}
                              onExternalDrop={handleExternalFileDrop}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : activeTab === "browser" ? null : activeTab === "changes" ? (
              <div className="flex h-full min-h-0 flex-col">
                <div
                  className={cn(
                    "app-scrollbar-sm min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border/70 bg-background",
                    selectedWorktree &&
                      !gitMissing &&
                      !gitUninitialized &&
                      !isChangesLoading &&
                      !changesError &&
                      trackedProjectChanges.length > 0
                      ? ""
                      : "px-1.5 py-1.5"
                  )}
                >
                  {!selectedWorktree ? (
                    <RightSidebarEmptyState
                      icon={GitDiff}
                      title="No project selected"
                      description="Choose a worktree to inspect local changes."
                    />
                  ) : gitMissing ? (
                    <RightSidebarEmptyState
                      icon={GitDiff}
                      title="Git not installed"
                      description="Install Git on this machine to inspect tracked changes for this project."
                    />
                  ) : gitUninitialized ? (
                    <RightSidebarEmptyState
                      icon={GitDiff}
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
                      icon={GitDiff}
                      title="No tracked changes"
                      description="This worktree has no tracked file changes right now."
                    />
                  ) : (
                    <ChangesPanel
                      projectPath={selectedWorktree.path}
                      changes={trackedProjectChanges}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="app-scrollbar-sm min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border/70 bg-background">
                  {!selectedWorktree ? (
                    <RightSidebarEmptyState
                      icon={CheckCircle}
                      title="No project selected"
                      description="Choose a worktree to inspect pull request checks."
                    />
                  ) : gitMissing ? (
                    <RightSidebarEmptyState
                      icon={CheckCircle}
                      title="Git not installed"
                      description="Install Git on this machine to inspect pull request checks for this project."
                    />
                  ) : gitUninitialized ? (
                    <RightSidebarEmptyState
                      icon={CheckCircle}
                      title="Git not initialized"
                      description="Initialize Git for this project before checking pull request status."
                    />
                  ) : (
                    <PullRequestChecksPanel
                      pullRequest={openPullRequest}
                      checks={pullRequestChecks}
                      commits={pullRequestCommits}
                      comments={pullRequestComments}
                      reviews={pullRequestReviews}
                      reviewComments={pullRequestReviewComments}
                      isLoading={isPullRequestChecksLoading}
                      loadError={pullRequestChecksLoadError}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
    </>
  )

  return (
    <>
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
