import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"

import { desktop } from "@/desktop/client"
import type { GitActionStep } from "@/desktop/contracts"
import {
  CaretDown,
  CircleNotch,
  CloudUpload,
  GitCommit,
  GitPullRequest,
  InformationCircle,
  Refresh,
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
import { Button } from "@/features/shared/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/shared/components/ui/tooltip"
import { useProjectGitBranches, useProjectGitChanges } from "@/features/shared/hooks"
import { cn } from "@/lib/utils"
import { CommitChangesDialog } from "./CommitChangesDialog"
import {
  buildMenuItems,
  type GitActionIconName,
  requiresDefaultBranchConfirmation,
  resolveQuickAction,
  summarizeGitResult,
} from "./gitActionsLogic"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"

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

function formatGitActionError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback

  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim()
}

function GitActionIcon({ icon }: { icon: GitActionIconName }) {
  if (icon === "commit") {
    return <GitCommit size={16} />
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
  const { selectedProject, selectedWorktreePath } = useCurrentProjectWorktree()
  const resolvedProjectPath = projectPath ?? selectedWorktreePath ?? null
  const gitGenerationModel = useSettingsStore((state) => state.gitGenerationModel)
  const initializeSettings = useSettingsStore((state) => state.initialize)
  const { branchData, isLoading: isBranchLoading, loadError: branchLoadError, refresh: refreshBranches } =
    useProjectGitBranches(resolvedProjectPath, { enabled: Boolean(resolvedProjectPath) })
  const { changes, isLoading: isChangesLoading, loadError: changesLoadError, refresh: refreshChanges } =
    useProjectGitChanges(resolvedProjectPath, { enabled: Boolean(resolvedProjectPath) })

  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false)
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeStep, setActiveStep] = useState<GitActionStep | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [feedbackTone, setFeedbackTone] = useState<"error" | "neutral">("neutral")

  useEffect(() => {
    void initializeSettings()
  }, [initializeSettings])

  useEffect(() => {
    return desktop.git.onActionProgress((event) => {
      setActiveStep(event.step)
    })
  }, [])

  const hasChanges = changes.length > 0
  const isBusy = isSubmitting || isBranchLoading || isChangesLoading
  const branchStatus = branchData
  const preferredRemoteName = selectedProject?.remoteName ?? null
  const effectiveRemoteName = useMemo(() => {
    if (preferredRemoteName?.trim()) {
      return preferredRemoteName.trim()
    }

    if (branchStatus?.hasOriginRemote) {
      return "origin"
    }

    return branchStatus?.remoteNames[0] ?? null
  }, [branchStatus, preferredRemoteName])
  const quickAction = useMemo(
    () => resolveQuickAction(branchStatus, hasChanges, isBusy, effectiveRemoteName),
    [branchStatus, effectiveRemoteName, hasChanges, isBusy]
  )
  const menuItems = useMemo(
    () => buildMenuItems(branchStatus, hasChanges, isBusy, effectiveRemoteName),
    [branchStatus, effectiveRemoteName, hasChanges, isBusy]
  )
  const actionError = branchLoadError ?? changesLoadError
  const actionHint = actionError || quickAction.hint || null

  if (!resolvedProjectPath) {
    return null
  }

  const refreshGitState = async () => {
    await Promise.all([refreshBranches({ quiet: true }), refreshChanges({ quiet: true })])
  }

  const openPullRequest = async () => {
    const prUrl = branchStatus?.openPullRequest?.url
    if (!prUrl) {
      setFeedbackTone("error")
      setFeedbackMessage("No open pull request found for this branch.")
      return
    }

    try {
      await desktop.shell.openExternal(prUrl)
      setFeedbackTone("neutral")
      setFeedbackMessage(null)
    } catch (error) {
      setFeedbackTone("error")
      setFeedbackMessage(formatGitActionError(error, "Unable to open the pull request."))
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

      await refreshGitState()
      if (result.pr.status === "created" || result.pr.status === "opened_existing") {
        setFeedbackTone("neutral")
        setFeedbackMessage(null)
      } else {
        setFeedbackTone("neutral")
        setFeedbackMessage(summarizeGitResult(result))
      }
      return true
    } catch (error) {
      setFeedbackTone("error")
      setFeedbackMessage(formatGitActionError(error, "Git action failed."))
      return false
    } finally {
      setIsSubmitting(false)
      setActiveStep(null)
    }
  }

  const handlePull = async () => {
    setIsSubmitting(true)
    setFeedbackMessage(null)

    try {
      const result = await desktop.git.pull(resolvedProjectPath)
      await refreshGitState()
      setFeedbackTone("neutral")
      setFeedbackMessage(
        result.status === "pulled"
          ? `Pulled ${result.branch}`
          : `${result.branch} is already up to date`
      )
    } catch (error) {
      setFeedbackTone("error")
      setFeedbackMessage(formatGitActionError(error, "Pull failed."))
    } finally {
      setIsSubmitting(false)
      setActiveStep(null)
    }
  }

  const runQuickAction = async () => {
    if (quickAction.kind === "open_pr") {
      await openPullRequest()
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
      setFeedbackTone("neutral")
      setFeedbackMessage(quickAction.hint)
    }
  }

  const handleMenuItem = async (item: (typeof menuItems)[number]) => {
    setIsMenuOpen(false)

    if (item.disabled) {
      return
    }

    if (item.openDialog) {
      setIsCommitDialogOpen(true)
      return
    }

    if (item.opensPr) {
      await openPullRequest()
      return
    }

    if (item.action) {
      await runGitAction(item.action)
    }
  }

  const quickActionIcon =
    quickAction.kind === "run_pull" ? (
      <Refresh size={16} />
    ) : (
      <GitActionIcon
        icon={
          quickAction.label.toLowerCase().includes("pr")
            ? "pr"
            : quickAction.label.toLowerCase().includes("push")
              ? "push"
              : quickAction.label.toLowerCase().includes("commit")
                ? "commit"
                : "info"
        }
      />
    )

  const displayLabel = isSubmitting && activeStep ? STEP_LABELS[activeStep] : quickAction.label
  const iconKey = isSubmitting ? "spinner" : quickAction.label
  const labelKey = displayLabel

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
        "h-7 rounded-r-none border-r-0 shadow-none",
        feedbackTone === "error" && feedbackMessage ? "border-destructive/50" : undefined,
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
            {isSubmitting ? <CircleNotch size={16} className="animate-spin" /> : quickActionIcon}
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
        <div className="inline-flex items-center gap-0">
          {actionHint ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">{renderQuickButton}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-72 text-sm leading-5">
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
                  className="h-7 w-8 rounded-l-none shadow-none"
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
              className="w-48 border border-border/70 bg-card p-1 shadow-lg"
            >
              {menuItems.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  disabled={item.disabled}
                  onClick={() => void handleMenuItem(item)}
                  className="min-h-8 gap-2 px-2 py-1"
                >
                  <GitActionIcon icon={item.icon} />
                  <span>{item.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

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
