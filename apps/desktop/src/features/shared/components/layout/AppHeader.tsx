import { useEffect, useState } from "react"
import { desktop, type GitBranchesResponse } from "@/desktop/client"
import { GitPullRequest } from "@/components/icons"
import { useChatComposerState, useChatProjectState } from "@/features/chat/hooks/useChat"
import {
  buildCreatePrMessage,
  DEFAULT_PR_TARGET_BRANCH,
} from "@/features/settings/createPrMessage"
import {
  normalizeCreatePrInstructions,
  useSettingsStore,
} from "@/features/settings/store/settingsStore"
import { Button } from "@/features/shared/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/features/shared/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function SourceControlActionGroup({
  className,
}: {
  className?: string
}) {
  const { selectedProjectId, selectedProject, activeSessionId } = useChatProjectState()
  const createPrInstructions = useSettingsStore((state) => state.createPrInstructions)
  const initializeSettings = useSettingsStore((state) => state.initialize)
  const [isPreparing, setIsPreparing] = useState(false)
  const { submit, status } = useChatComposerState({
    selectedProjectId,
    selectedProjectPath: selectedProject?.path ?? null,
    activeSessionId,
  })

  useEffect(() => {
    void initializeSettings()
  }, [initializeSettings])

  const handleCreatePr = async () => {
    if (!selectedProject?.path) {
      return
    }

    setIsPreparing(true)

    try {
      const branchData = await desktop.git.getBranches(selectedProject.path)

      const message = buildCreatePrMessage(
        {
          currentBranch: branchData.currentBranch,
          targetBranch: DEFAULT_PR_TARGET_BRANCH,
          upstreamBranch: branchData.upstreamBranch,
          uncommittedChanges: branchData.workingTreeSummary.changedFiles,
        },
        normalizeCreatePrInstructions(createPrInstructions),
      )

      await submit(message)
    } catch (error) {
      console.error("Failed to prepare PR message:", error)

      const fallbackMessage = buildCreatePrMessage(
        {
          currentBranch: "unknown",
          targetBranch: DEFAULT_PR_TARGET_BRANCH,
          upstreamBranch: null,
          uncommittedChanges: 0,
        },
        normalizeCreatePrInstructions(createPrInstructions),
      )

      await submit(fallbackMessage)
    } finally {
      setIsPreparing(false)
    }
  }

  const isAgentRunning = status === "streaming" || isPreparing
  const isDisabled = !selectedProject || isAgentRunning
  const disabledReason = isAgentRunning
    ? "The agent needs to finish running, or you need to cancel it before you can create a PR."
    : null

  const button = (
    <Button
      type="button"
      variant="default"
      size="sm"
      onClick={() => void handleCreatePr()}
      disabled={isDisabled}
      className={cn(
        "h-7 rounded-lg border-transparent shadow-none disabled:opacity-100",
        isDisabled
          ? "cursor-not-allowed bg-muted text-muted-foreground"
          : "bg-cta text-cta-foreground hover:bg-cta/90",
        className,
      )}
    >
      <GitPullRequest size={16} />
      <span>{isAgentRunning ? "Create PR" : "Create PR"}</span>
    </Button>
  )

  if (!disabledReason) {
    return button
  }

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-64 text-sm leading-5">
          {disabledReason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
