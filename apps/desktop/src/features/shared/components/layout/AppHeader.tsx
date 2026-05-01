import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"

import { desktop } from "@/desktop/client"
import type {
  GitActionStep,
  GitBranchesResponse,
  GitRunStackedActionResult,
} from "@/desktop/contracts"
import {
  Archive,
  CaretDown,
  ChatCircle,
  CircleNotch,
  CloudUpload,
  GitCommit,
  GitPullRequest,
  InformationCircle,
  Refresh,
  ShieldWarning,
  X,
} from "@/components/icons"
import { normalizeGitGenerationModel, useSettingsStore } from "@/features/settings/store/settingsStore"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/features/shared/components/ui/alert-dialog"
import {
  contentTextClassNames,
  feedbackIconClassName,
  iconTextClassNames,
} from "@/features/shared/appearance"
import { Button } from "@/features/shared/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/shared/components/ui/tooltip"
import { useProjectGitBranches, useProjectGitChanges } from "@/features/shared/hooks"
import { useProjectGitStore } from "@/features/shared/hooks/projectGitStore"
import { cn } from "@/lib/utils"
import { CommitChangesDialog } from "./CommitChangesDialog"
import { RemoveWorktreeModal } from "@/features/workspace/components/modals"
import { useChatStore } from "@/features/chat/store"
import { useTabStore } from "@/features/editor/store"
import {
  buildMenuItems,
  type GitActionIconName,
  requiresDefaultBranchConfirmation,
  resolveQuickAction,
  summarizeGitResult,
} from "./gitActionsLogic"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { buildResolvePrompt } from "./gitResolve"
import { useRightSidebar } from "./useRightSidebar"

interface SourceControlActionGroupProps {
  className?: string
  projectPath?: string | null
}

interface PendingDefaultBranchAction {
  action: "commit_push" | "commit_push_pr"
  label: string
}

const STEP_LABELS: Record<GitActionStep, string> = {
  generating: "Writing",
  committing: "Committing",
  pushing: "Pushing",
  creating_pr: "Creating PR",
}

const GIT_DOWNLOADS_URL = "https://git-scm.com/downloads"

function summarizeBranchStatusForLog(branchData: GitBranchesResponse | null) {
  if (!branchData) {
    return null
  }

  return {
    currentBranch: branchData.currentBranch,
    upstreamBranch: branchData.upstreamBranch,
    aheadCount: branchData.aheadCount,
    behindCount: branchData.behindCount,
    hasUpstream: branchData.hasUpstream,
    isDefaultBranch: branchData.isDefaultBranch,
    isDetached: branchData.isDetached,
    openPullRequest: branchData.openPullRequest
      ? {
          number: branchData.openPullRequest.number,
          state: branchData.openPullRequest.state,
          checksStatus: branchData.openPullRequest.checksStatus,
          mergeStatus: branchData.openPullRequest.mergeStatus,
          resolveReason: branchData.openPullRequest.resolveReason,
          isMergeable: branchData.openPullRequest.isMergeable,
          failedCheckNames: branchData.openPullRequest.failedCheckNames,
          url: branchData.openPullRequest.url,
          headBranch: branchData.openPullRequest.headBranch,
          baseBranch: branchData.openPullRequest.baseBranch,
        }
      : null,
  }
}

function formatGitActionError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback

  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/^GraphQL:\s*/i, "")
    .trim()
}

function GitActionIcon({ icon }: { icon: GitActionIconName }) {
  if (icon === "archive") {
    return <Archive size={16} />
  }
  if (icon === "chat") {
    return <ChatCircle size={16} />
  }
  if (icon === "commit") {
    return <GitCommit size={16} />
  }
  if (icon === "pull") {
    return <Refresh size={16} />
  }
  if (icon === "push") {
    return <CloudUpload size={16} />
  }
  if (icon === "pr") {
    return <GitPullRequest size={16} />
  }
  return <InformationCircle size={16} />
}

export function SourceControlActionGroup({
  className,
  projectPath,
}: SourceControlActionGroupProps) {
  const {
    selectedProject,
    selectedWorktree,
    selectedWorktreeId,
    selectedWorktreePath,
  } = useCurrentProjectWorktree()
  const resolvedProjectPath = projectPath ?? selectedWorktreePath ?? null
  const gitGenerationModel = useSettingsStore((state) => state.gitGenerationModel)
  const gitResolvePrompts = useSettingsStore((state) => state.gitResolvePrompts)
  const initializeSettings = useSettingsStore((state) => state.initialize)
  const createOptimisticSession = useChatStore((state) => state.createOptimisticSession)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const openChatSession = useTabStore((state) => state.openChatSession)
  const requestGitRefresh = useProjectGitStore((state) => state.requestRefresh)
  const latestGitRefreshPathRef = useRef<string | null>(null)
  const { expand: expandRightSidebar, setActiveTab: setRightSidebarActiveTab } = useRightSidebar()
  const {
    branchData,
    isLoading: isBranchLoading,
    loadError: branchLoadError,
    refresh: refreshBranches,
    setBranchData,
  } = useProjectGitBranches(resolvedProjectPath, {
    enabled: Boolean(resolvedProjectPath),
    autoRefreshOnMount: false,
    pollOpenPullRequest: false,
    refreshOnWindowFocus: false,
    subscribeToWatcher: false,
  })
  const { changes, isLoading: isChangesLoading, loadError: changesLoadError, refresh: refreshChanges } =
    useProjectGitChanges(resolvedProjectPath, {
      enabled: Boolean(resolvedProjectPath),
      autoRefreshOnMount: false,
      refreshOnWindowFocus: true,
      subscribeToWatcher: true,
    })

  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false)
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeStep, setActiveStep] = useState<GitActionStep | null>(null)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [feedbackTone, setFeedbackTone] = useState<"error" | "success" | "info">("info")
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false)

  useEffect(() => {
    void initializeSettings()
  }, [initializeSettings])

  useEffect(() => {
    if (!resolvedProjectPath) {
      latestGitRefreshPathRef.current = null
      return
    }

    latestGitRefreshPathRef.current = resolvedProjectPath
    const timeoutId = window.setTimeout(() => {
      if (latestGitRefreshPathRef.current !== resolvedProjectPath) {
        return
      }

      void requestGitRefresh(resolvedProjectPath, {
        includeBranches: true,
        includeChanges: true,
        quietBranches: true,
        quietChanges: true,
        debounceMs: 0,
      })
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [requestGitRefresh, resolvedProjectPath])

  useEffect(() => {
    return desktop.git.onActionProgress((event) => {
      setActiveStep(event.step)
    })
  }, [])

  useEffect(() => {
    if (!feedbackMessage || feedbackTone === "error") {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setFeedbackMessage(null)
    }, 4_000)

    return () => window.clearTimeout(timeoutId)
  }, [feedbackMessage, feedbackTone])

  const hasChanges = changes.length > 0
  const isBusy = isSubmitting || isBranchLoading || isChangesLoading
  const branchStatus = branchData
  const gitSetupState = !branchStatus
    ? null
    : !branchStatus.isGitAvailable
      ? "missing_git"
      : !branchStatus.isRepo
        ? "not_repo"
        : "ready"
  const gitReadyBranchStatus = gitSetupState === "ready" ? branchStatus : null
  const preferredRemoteName = selectedProject?.remoteName ?? null
  const canArchiveWorktree = selectedWorktree?.source === "managed"
  const effectiveRemoteName = useMemo(() => {
    if (preferredRemoteName?.trim()) {
      return preferredRemoteName.trim()
    }

    if (gitReadyBranchStatus?.hasOriginRemote) {
      return "origin"
    }

    return gitReadyBranchStatus?.remoteNames[0] ?? null
  }, [gitReadyBranchStatus, preferredRemoteName])
  const quickAction = useMemo(
    () =>
      resolveQuickAction(gitReadyBranchStatus, hasChanges, isBusy, {
        preferredRemoteName: effectiveRemoteName,
        canArchiveWorktree,
      }),
    [canArchiveWorktree, effectiveRemoteName, gitReadyBranchStatus, hasChanges, isBusy]
  )
  const menuItems = useMemo(
    () =>
      buildMenuItems(gitReadyBranchStatus, hasChanges, isBusy, {
        preferredRemoteName: effectiveRemoteName,
        canArchiveWorktree,
      }),
    [canArchiveWorktree, effectiveRemoteName, gitReadyBranchStatus, hasChanges, isBusy]
  )
  const actionError = branchLoadError ?? changesLoadError
  const actionHint =
    actionError ||
    (gitSetupState === "missing_git"
      ? "Git isn’t installed on this machine yet."
      : gitSetupState === "not_repo"
        ? "Initialize Git to enable branches, diffs, pull requests, and managed workspaces."
        : quickAction.hint || null)

  useEffect(() => {
    console.debug("[AppHeader] resolved state", {
      projectPath: resolvedProjectPath,
      hasChanges,
      isBusy,
      preferredRemoteName: effectiveRemoteName,
      branchStatus: summarizeBranchStatusForLog(branchStatus),
      quickAction,
      menuItems,
      actionError,
      actionHint,
    })
  }, [
    actionError,
    actionHint,
    branchStatus,
    effectiveRemoteName,
    hasChanges,
    isBusy,
    menuItems,
    quickAction,
    resolvedProjectPath,
  ])

  if (!resolvedProjectPath) {
    return null
  }

  const refreshGitState = async () => {
    console.debug("[AppHeader] refreshGitState:start", {
      projectPath: resolvedProjectPath,
    })
    await Promise.all([refreshBranches({ quiet: true }), refreshChanges({ quiet: true })])
    console.debug("[AppHeader] refreshGitState:done", {
      projectPath: resolvedProjectPath,
    })
  }

  const seedOptimisticPullRequest = (
    nextBranchData: GitBranchesResponse | null,
    pr: GitRunStackedActionResult["pr"]
  ) => {
    console.debug("[AppHeader] seedOptimisticPullRequest:attempt", {
      projectPath: resolvedProjectPath,
      pr,
      nextBranchData: summarizeBranchStatusForLog(nextBranchData),
      previousBranchStatus: summarizeBranchStatusForLog(branchStatus),
    })
    if (!pr.url || !pr.number) {
      console.debug("[AppHeader] seedOptimisticPullRequest:skipped", {
        reason: "missing-pr-url-or-number",
        pr,
      })
      return
    }

    const base = nextBranchData ?? branchStatus
    if (!base) {
      console.debug("[AppHeader] seedOptimisticPullRequest:skipped", {
        reason: "missing-base-branch-data",
        pr,
      })
      return
    }

    setBranchData({
      ...base,
      openPullRequest: {
        number: pr.number,
        title: pr.title ?? `PR #${pr.number}`,
        url: pr.url,
        state: "open",
        baseBranch: pr.baseBranch ?? base.defaultBranch ?? "main",
        headBranch: pr.headBranch ?? base.currentBranch,
        checksStatus: "pending",
        mergeStatus: "unknown",
        isMergeable: false,
      },
    })

    window.setTimeout(() => {
      console.debug("[AppHeader] seedOptimisticPullRequest:scheduled-refresh", {
        projectPath: resolvedProjectPath,
        prNumber: pr.number,
      })
      void refreshBranches({ quiet: true })
    }, 2_000)
  }

  const seedOptimisticPendingChecks = (nextBranchData: GitBranchesResponse | null) => {
    const nextPullRequest = nextBranchData?.openPullRequest ?? branchStatus?.openPullRequest ?? null
    const base = nextBranchData ?? branchStatus

    if (!base || nextPullRequest?.state !== "open") {
      return
    }

    setBranchData({
      ...base,
      openPullRequest: {
        ...nextPullRequest,
        checksStatus: "pending",
        checksError: null,
        pendingChecksCount: Math.max(nextPullRequest.pendingChecksCount ?? 0, 1),
        failedChecksCount: 0,
        failedCheckNames: [],
        resolveReason:
          nextPullRequest.resolveReason === "failed_checks"
            ? undefined
            : nextPullRequest.resolveReason,
      },
    })
  }

  const openPullRequest = async () => {
    const prUrl = branchStatus?.openPullRequest?.url
    if (!prUrl) {
      setFeedbackTone("error")
      setFeedbackMessage("No pull request found for this branch.")
      return
    }

    try {
      await desktop.shell.openExternal(prUrl)
      setFeedbackTone("info")
      setFeedbackMessage(null)
    } catch (error) {
      setFeedbackTone("error")
      setFeedbackMessage(formatGitActionError(error, "Unable to open the pull request."))
    }
  }

  const openArchiveModal = () => {
    if (!selectedProject || !selectedWorktree || selectedWorktree.source !== "managed") {
      setFeedbackTone("error")
      setFeedbackMessage("Only managed workspaces can be archived from the header.")
      return
    }

    setFeedbackTone("info")
    setFeedbackMessage(null)
    setIsArchiveModalOpen(true)
  }

  const handleInstallGit = async () => {
    try {
      await desktop.shell.openExternal(GIT_DOWNLOADS_URL)
      setFeedbackTone("info")
      setFeedbackMessage(null)
    } catch (error) {
      setFeedbackTone("error")
      setFeedbackMessage(formatGitActionError(error, "Unable to open Git installation instructions."))
    }
  }

  const handleInitRepo = async () => {
    setIsSubmitting(true)
    setBusyLabel("Initializing")
    setFeedbackMessage(null)

    try {
      const nextBranchData = await desktop.git.initRepo(resolvedProjectPath)
      setBranchData(nextBranchData)
      await refreshGitState()
      setFeedbackTone("success")
      setFeedbackMessage("Git initialized for this project.")
    } catch (error) {
      setFeedbackTone("error")
      setFeedbackMessage(formatGitActionError(error, "Unable to initialize Git for this project."))
    } finally {
      setIsSubmitting(false)
      setActiveStep(null)
      setBusyLabel(null)
    }
  }

  const runGitAction = async (
    action: "commit" | "commit_push" | "commit_push_pr",
    options?: {
      commitMessage?: string
      filePaths?: string[]
      featureBranch?: boolean
      skipDefaultBranchPrompt?: boolean
    }
  ): Promise<boolean> => {
    console.debug("[AppHeader] runGitAction:start", {
      projectPath: resolvedProjectPath,
      action,
      options,
      branchStatus: summarizeBranchStatusForLog(branchStatus),
      hasChanges,
      effectiveRemoteName,
    })
    if (
      !options?.skipDefaultBranchPrompt &&
      branchStatus &&
      requiresDefaultBranchConfirmation(action, branchStatus.isDefaultBranch)
    ) {
      setPendingDefaultBranchAction({
        action,
        label:
          action === "commit_push_pr" ? "Commit, push, and create a PR on the default branch?" : "Commit and push on the default branch?",
      })
      return false
    }

    setIsSubmitting(true)
    setActiveStep(options?.commitMessage ? "committing" : "generating")
    setBusyLabel(null)
    setFeedbackMessage(null)

    try {
      const result = await desktop.git.runStackedAction(resolvedProjectPath, {
        action,
        ...(options?.commitMessage ? { commitMessage: options.commitMessage } : {}),
        ...(options?.filePaths ? { filePaths: options.filePaths } : {}),
        ...(options?.featureBranch ? { featureBranch: true } : {}),
        ...(effectiveRemoteName ? { remoteName: effectiveRemoteName } : {}),
        ...(gitGenerationModel.trim()
          ? { generationModel: normalizeGitGenerationModel(gitGenerationModel) }
          : {}),
      })

      const [nextBranchData] = await Promise.all([
        refreshBranches({ quiet: true }),
        refreshChanges({ quiet: true }),
      ])
      console.debug("[AppHeader] runGitAction:post-refresh", {
        projectPath: resolvedProjectPath,
        action,
        result,
        nextBranchData: summarizeBranchStatusForLog(nextBranchData),
      })
      if (result.pr.status === "created" || result.pr.status === "opened_existing") {
        if (!nextBranchData?.openPullRequest) {
          seedOptimisticPullRequest(nextBranchData, result.pr)
        }
        if (result.pr.status === "opened_existing") {
          seedOptimisticPendingChecks(nextBranchData)
          setFeedbackTone("success")
          setFeedbackMessage(summarizeGitResult(result))
        } else {
          setFeedbackTone("info")
          setFeedbackMessage(null)
        }
      } else if (
        (action === "commit_push" || action === "commit_push_pr") &&
        (nextBranchData?.openPullRequest?.state === "open" ||
          branchStatus?.openPullRequest?.state === "open")
      ) {
        seedOptimisticPendingChecks(nextBranchData)
        setFeedbackTone("success")
        setFeedbackMessage(summarizeGitResult(result))
      } else {
        setFeedbackTone("success")
        setFeedbackMessage(summarizeGitResult(result))
      }
      console.debug("[AppHeader] runGitAction:success", {
        projectPath: resolvedProjectPath,
        action,
        result,
      })
      return true
    } catch (error) {
      console.error("[AppHeader] runGitAction:error", {
        projectPath: resolvedProjectPath,
        action,
        options,
        error,
      })
      setFeedbackTone("error")
      setFeedbackMessage(formatGitActionError(error, "Git action failed."))
      return false
    } finally {
      setIsSubmitting(false)
      setActiveStep(null)
      setBusyLabel(null)
    }
  }

  const handlePull = async () => {
    console.debug("[AppHeader] handlePull:start", {
      projectPath: resolvedProjectPath,
      branchStatus: summarizeBranchStatusForLog(branchStatus),
    })
    setIsSubmitting(true)
    setBusyLabel("Pulling")
    setFeedbackMessage(null)

    try {
      const result = await desktop.git.pull(resolvedProjectPath)
      await refreshGitState()
      console.debug("[AppHeader] handlePull:success", {
        projectPath: resolvedProjectPath,
        result,
      })
      setFeedbackTone("success")
      setFeedbackMessage(
        result.status === "pulled"
          ? `Pulled ${result.branch}`
          : `${result.branch} is already up to date`
      )
    } catch (error) {
      console.error("[AppHeader] handlePull:error", {
        projectPath: resolvedProjectPath,
        error,
      })
      setFeedbackTone("error")
      setFeedbackMessage(formatGitActionError(error, "Pull failed."))
    } finally {
      setIsSubmitting(false)
      setActiveStep(null)
      setBusyLabel(null)
    }
  }

  const openChecksTab = () => {
    expandRightSidebar()
    setRightSidebarActiveTab("checks")
    setFeedbackTone("info")
    setFeedbackMessage(null)
  }

  const handleMergePullRequest = async () => {
    console.debug("[AppHeader] handleMergePullRequest:start", {
      projectPath: resolvedProjectPath,
      branchStatus: summarizeBranchStatusForLog(branchStatus),
    })
    setIsSubmitting(true)
    setBusyLabel("Merging")
    setFeedbackMessage(null)

    try {
      const result = await desktop.git.mergePullRequest(resolvedProjectPath)
      await refreshGitState()
      console.debug("[AppHeader] handleMergePullRequest:success", {
        projectPath: resolvedProjectPath,
        result,
      })
      setFeedbackTone("success")
      setFeedbackMessage(`Merged PR #${result.number}`)
    } catch (error) {
      console.error("[AppHeader] handleMergePullRequest:error", {
        projectPath: resolvedProjectPath,
        error,
      })
      setFeedbackTone("error")
      setFeedbackMessage(formatGitActionError(error, "Merge failed."))
    } finally {
      setIsSubmitting(false)
      setActiveStep(null)
      setBusyLabel(null)
    }
  }

  const handleResolvePullRequest = async () => {
    console.debug("[AppHeader] handleResolvePullRequest:start", {
      projectPath: resolvedProjectPath,
      branchStatus: summarizeBranchStatusForLog(branchStatus),
      selectedWorktreeId,
      selectedWorktreePath,
    })
    if (!branchStatus?.openPullRequest?.resolveReason) {
      setFeedbackTone("error")
      setFeedbackMessage("No resolvable pull request state is available for this branch.")
      return
    }

    if (!selectedWorktreeId || !resolvedProjectPath) {
      setFeedbackTone("error")
      setFeedbackMessage("Select a project worktree before starting a resolve chat.")
      return
    }

    let session = createOptimisticSession(selectedWorktreeId, resolvedProjectPath)
    if (!session) {
      setFeedbackTone("error")
      setFeedbackMessage("Unable to start a resolve chat for this worktree.")
      return
    }

    const prompt = buildResolvePrompt(branchStatus, gitResolvePrompts, {
      projectName: selectedProject?.name,
      projectPath: selectedProject?.path,
      worktreeName: selectedWorktree?.name,
      worktreePath: resolvedProjectPath,
    })

    openChatSession(session.id, session.title)
    setIsSubmitting(true)
    setBusyLabel("Resolving")
    setFeedbackTone("info")
    setFeedbackMessage(null)

    try {
      await sendMessage(session.id, prompt)
      console.debug("[AppHeader] handleResolvePullRequest:success", {
        projectPath: resolvedProjectPath,
        sessionId: session.id,
        resolveReason: branchStatus.openPullRequest.resolveReason,
      })
    } catch (error) {
      console.error("[AppHeader] handleResolvePullRequest:error", {
        projectPath: resolvedProjectPath,
        error,
      })
      setFeedbackTone("error")
      setFeedbackMessage(formatGitActionError(error, "Unable to start a resolve chat."))
    } finally {
      setIsSubmitting(false)
      setActiveStep(null)
      setBusyLabel(null)
    }
  }

  const runQuickAction = async () => {
    console.debug("[AppHeader] runQuickAction", {
      projectPath: resolvedProjectPath,
      quickAction,
      branchStatus: summarizeBranchStatusForLog(branchStatus),
    })
    if (quickAction.kind === "open_pr") {
      await openPullRequest()
      return
    }

    if (quickAction.kind === "open_archive") {
      openArchiveModal()
      return
    }

    if (quickAction.kind === "open_checks") {
      openChecksTab()
      return
    }

    if (quickAction.kind === "merge_pr") {
      await handleMergePullRequest()
      return
    }

    if (quickAction.kind === "resolve_pr") {
      await handleResolvePullRequest()
      return
    }

    if (quickAction.kind === "run_pull") {
      await handlePull()
      return
    }

    if (quickAction.kind === "run_action" && quickAction.action) {
      await runGitAction(quickAction.action)
      return
    }

    if (quickAction.hint) {
      setFeedbackTone("info")
      setFeedbackMessage(quickAction.hint)
    }
  }

  const handleMenuItem = async (item: (typeof menuItems)[number]) => {
    console.debug("[AppHeader] handleMenuItem", {
      projectPath: resolvedProjectPath,
      item,
      branchStatus: summarizeBranchStatusForLog(branchStatus),
    })
    setIsMenuOpen(false)

    if (item.disabled) {
      return
    }

    if (item.openDialog) {
      setIsCommitDialogOpen(true)
      return
    }

    if (item.kind === "open_archive") {
      openArchiveModal()
      return
    }

    if (item.kind === "open_pr") {
      await openPullRequest()
      return
    }

    if (item.kind === "resolve_pr") {
      await handleResolvePullRequest()
      return
    }

    if (item.kind === "run_action" && item.action) {
      await runGitAction(item.action)
    }
  }

  const quickActionIcon = <GitActionIcon icon={quickAction.icon} />
  const setupActionLabel =
    gitSetupState === "missing_git"
      ? busyLabel ?? (isSubmitting ? "Opening download page" : "Install Git")
      : busyLabel ?? (isSubmitting ? "Initializing" : "Initialize Git")

  const displayLabel = busyLabel ?? (isSubmitting && activeStep ? STEP_LABELS[activeStep] : quickAction.label)
  const iconKey = isSubmitting ? "spinner" : quickAction.label
  const labelKey = displayLabel
  const isChecksPendingAction = quickAction.kind === "open_checks"
  const splitButtonTone = feedbackTone === "error" && feedbackMessage ? "danger" : quickAction.tone
  const feedbackIconTone =
    feedbackTone === "error" ? "destructive" : feedbackTone === "success" ? "success" : "info"
  const feedbackTitle =
    feedbackTone === "error"
      ? "Git action failed"
      : feedbackTone === "success"
        ? "Git action complete"
        : "Git action"
  const splitButtonToneClassName =
    splitButtonTone === "warning"
      ? "border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-surface)] text-[color:var(--color-warning-surface-foreground)] hover:bg-[color:var(--color-warning-surface)]/85 hover:text-[color:var(--color-warning-surface-foreground)]"
      : splitButtonTone === "danger"
        ? "border-[color:var(--color-destructive-border)] bg-[color:var(--color-destructive-surface)] text-[color:var(--color-destructive-surface-foreground)] hover:bg-[color:var(--color-destructive-surface)]/85 hover:text-[color:var(--color-destructive-surface-foreground)]"
        : undefined
  const splitButtonIconClassName =
    splitButtonTone === "default"
      ? "[&_svg]:text-[color:var(--color-icon)]"
      : "[&_svg]:text-current"

  const enterTransition = { duration: 0.25, ease: [0.4, 0, 0.2, 1] }
  const exitTransition = { duration: 0.15, ease: [0.4, 0, 1, 1] }

  const renderQuickButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void runQuickAction()}
      disabled={isBusy || quickAction.disabled}
      className={cn(
        "h-7 rounded-r-none border-r-0 border-control-border bg-[color:color-mix(in_oklab,var(--sidebar)_74%,var(--card))] shadow-none hover:bg-[var(--sidebar-item-hover)]",
        contentTextClassNames.default,
        splitButtonIconClassName,
        splitButtonToneClassName,
        className
      )}
    >
      <span className="relative inline-flex size-4 items-center justify-center overflow-hidden">
        <AnimatePresence initial={false}>
          <motion.span
            key={iconKey}
            className="inline-flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1, transition: enterTransition }}
            exit={{ opacity: 0, scale: 0.6, position: "absolute", transition: exitTransition }}
          >
            {isSubmitting || isChecksPendingAction ? (
              <CircleNotch size={16} className="animate-spin" />
            ) : (
              quickActionIcon
            )}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="relative inline-flex items-center overflow-hidden">
        <AnimatePresence initial={false}>
          <motion.span
            key={labelKey}
            className="inline-block whitespace-nowrap"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: enterTransition }}
            exit={{ opacity: 0, y: -10, position: "absolute", transition: exitTransition }}
          >
            {displayLabel}
          </motion.span>
        </AnimatePresence>
      </span>
    </Button>
  )

  return (
    <>
      <div className="flex items-center">
        {gitSetupState === "missing_git" || gitSetupState === "not_repo" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void (gitSetupState === "missing_git" ? handleInstallGit() : handleInitRepo())
                }
                disabled={isBusy}
                className={cn(
                  "h-7 border-control-border bg-[color:color-mix(in_oklab,var(--sidebar)_74%,var(--card))] shadow-none hover:bg-[var(--sidebar-item-hover)]",
                  contentTextClassNames.default,
                  "[&_svg]:text-[color:var(--color-icon)]",
                  feedbackTone === "error" && feedbackMessage ? "border-destructive/50" : undefined,
                  className
                )}
              >
                <InformationCircle size={16} />
                <span>{setupActionLabel}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="max-w-72 whitespace-pre-line text-sm leading-5">
              {actionHint}
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="inline-flex items-center gap-0">
            {actionHint ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">{renderQuickButton}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" className="max-w-72 whitespace-pre-line text-sm leading-5">
                  {actionHint}
                </TooltipContent>
              </Tooltip>
            ) : (
              renderQuickButton
            )}

            <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className={cn(
                      "h-7 w-8 rounded-l-none border-control-border bg-[color:color-mix(in_oklab,var(--sidebar)_74%,var(--card))] shadow-none hover:bg-[var(--sidebar-item-hover)]",
                      splitButtonTone === "default" ? iconTextClassNames.default : "text-current",
                      splitButtonToneClassName
                    )}
                    aria-label="Open git actions menu"
                    disabled={isBusy}
                  />
                }
              >
                <CaretDown size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="w-44 border border-sidebar-border bg-sidebar p-0.5 text-sidebar-foreground shadow-lg"
              >
                {menuItems.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    disabled={item.disabled}
                    onClick={() => void handleMenuItem(item)}
                    className="min-h-7 gap-1.5 px-1.5 py-0.5 focus:bg-[var(--sidebar-item-hover)] focus:text-sidebar-foreground focus:**:text-sidebar-foreground"
                  >
                    <GitActionIcon icon={item.icon} />
                    <span>{item.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <AnimatePresence>
        {feedbackMessage ? (
          <motion.div
            key={`${feedbackTone}:${feedbackMessage}`}
            role={feedbackTone === "error" ? "alert" : "status"}
            aria-live={feedbackTone === "error" ? "assertive" : "polite"}
            className="pointer-events-none fixed top-12 right-3 z-50 w-[min(92vw,360px)]"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <div
              className={cn(
                "pointer-events-auto flex items-start gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-popover)] px-3 py-2 text-sm text-[color:var(--color-popover-foreground)] shadow-lg"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center",
                  feedbackIconClassName(feedbackIconTone)
                )}
              >
                {feedbackTone === "error" ? (
                  <ShieldWarning size={16} />
                ) : (
                  <InformationCircle size={16} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-4">{feedbackTitle}</p>
                <p className="mt-0.5 break-words text-xs leading-5">{feedbackMessage}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="-mr-1 -mt-1 size-6 shrink-0 text-current opacity-70 hover:bg-current/10 hover:text-current hover:opacity-100"
                aria-label="Dismiss git action feedback"
                title="Dismiss"
                onClick={() => setFeedbackMessage(null)}
              >
                <X size={12} />
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <CommitChangesDialog
        open={isCommitDialogOpen}
        onOpenChange={setIsCommitDialogOpen}
        currentBranch={branchStatus?.currentBranch ?? "unknown"}
        isDefaultBranch={branchStatus?.isDefaultBranch ?? false}
        changes={changes}
        isSubmitting={isSubmitting}
        onConfirm={async ({ commitMessage, filePaths }) => {
          const didSucceed = await runGitAction("commit", { commitMessage, filePaths })
          if (didSucceed) {
            setIsCommitDialogOpen(false)
          }
        }}
        onConfirmOnNewBranch={async ({ commitMessage, filePaths }) => {
          const didSucceed = await runGitAction("commit", {
            commitMessage,
            filePaths,
            featureBranch: true,
            skipDefaultBranchPrompt: true,
          })
          if (didSucceed) {
            setIsCommitDialogOpen(false)
          }
        }}
      />

      <RemoveWorktreeModal
        open={isArchiveModalOpen}
        project={selectedProject}
        worktree={selectedWorktree}
        intent="archive"
        defaultDeleteFromSystem
        onOpenChange={setIsArchiveModalOpen}
      />

      <AlertDialog
        open={pendingDefaultBranchAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDefaultBranchAction(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Run this action on the default branch?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDefaultBranchAction?.label ??
                "This action targets the default branch. You can continue there or create a new feature branch first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Abort</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmitting || pendingDefaultBranchAction == null}
              onClick={async () => {
                const pendingAction = pendingDefaultBranchAction
                setPendingDefaultBranchAction(null)
                if (!pendingAction) {
                  return
                }

                await runGitAction(pendingAction.action, {
                  skipDefaultBranchPrompt: true,
                })
              }}
            >
              Continue
            </AlertDialogAction>
            <AlertDialogAction
              disabled={isSubmitting || pendingDefaultBranchAction == null}
              onClick={async () => {
                const pendingAction = pendingDefaultBranchAction
                setPendingDefaultBranchAction(null)
                if (!pendingAction) {
                  return
                }

                await runGitAction(pendingAction.action, {
                  featureBranch: true,
                  skipDefaultBranchPrompt: true,
                })
              }}
            >
              Checkout feature branch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
