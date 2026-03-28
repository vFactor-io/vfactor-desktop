import { useEffect, useMemo, useState } from "react"
import { desktop } from "@/desktop/client"
import {
  CheckCircle,
  CircleNotch,
  GitBranch,
  Plus,
} from "@/components/icons"
import { SearchableSelect } from "@/features/shared/components/ui/searchable-select"
import { useProjectGitBranches } from "@/features/shared/hooks"
import { cn } from "@/lib/utils"
import { CreateBranchDialog } from "./CreateBranchDialog"

interface BranchTargetSelectorProps {
  projectPath: string | null
}

const MIN_BRANCH_LOADING_MS = 350

function formatBranchError(error: unknown) {
  if (typeof error === "string") {
    return error
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return "Something went wrong while updating this branch."
}

export function BranchTargetSelector({ projectPath }: BranchTargetSelectorProps) {
  const { branchData, isLoading, loadError, refresh, setBranchData } = useProjectGitBranches(
    projectPath
  )
  const [isOpen, setIsOpen] = useState(false)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingBranch, setPendingBranch] = useState<string | null>(null)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    setActionErrorMessage(null)
    setIsOpen(false)
    setIsCreateDialogOpen(false)
    setPendingBranch(null)
    setIsSubmitting(false)
  }, [projectPath])

  useEffect(() => {
    if (loadError) {
      setIsOpen(false)
    }
  }, [loadError])

  const currentBranchLabel = branchData?.currentBranch ?? "Loading branch..."
  const workingTreeSummary = branchData?.workingTreeSummary ?? {
    changedFiles: 0,
    additions: 0,
    deletions: 0,
  }
  const canOpenMenu = !isLoading && branchData !== null
  const errorMessage = actionErrorMessage ?? loadError

  const options = useMemo(() => {
    if (!branchData) return []
    return [
      branchData.currentBranch,
      ...branchData.branches.filter((b) => b !== branchData.currentBranch),
    ].map((b) => ({ value: b, label: b }))
  }, [branchData])

  if (!projectPath) {
    return null
  }

  const handleBranchSelect = (branch: string) => {
    if (!projectPath || !branchData || branch === branchData.currentBranch) {
      setIsOpen(false)
      return
    }

    setIsSubmitting(true)
    setPendingBranch(branch)
    setActionErrorMessage(null)

    void (async () => {
      try {
        const [nextData] = await Promise.all([
          desktop.git.checkoutBranch(projectPath, branch),
          new Promise((resolve) => window.setTimeout(resolve, MIN_BRANCH_LOADING_MS)),
        ])

        setBranchData(nextData)
        setIsOpen(false)
      } catch (error) {
        setActionErrorMessage(formatBranchError(error))
      } finally {
        setIsSubmitting(false)
        setPendingBranch(null)
      }
    })()
  }

  return (
    <>
      <SearchableSelect
        value={branchData?.currentBranch ?? null}
        onValueChange={handleBranchSelect}
        options={options}
        displayValue={currentBranchLabel}
        icon={<GitBranch size={15} />}
        searchPlaceholder="Search branches"
        sectionLabel="Branches"
        emptyMessage="No matching branches found."
        disabled={!canOpenMenu}
        busy={isSubmitting}
        open={isOpen}
        onOpenChange={(open) => {
          if (!open && isSubmitting) return
          setIsOpen(open)
        }}
        onOpen={() => {
          setActionErrorMessage(null)
          void refresh({ quiet: true })
        }}
        triggerVariant="ghost"
        className="hidden h-full min-w-0 items-center md:flex"
        triggerClassName={cn(
          "max-w-[260px] font-medium",
          canOpenMenu
            ? "text-foreground"
            : "cursor-default text-muted-foreground/70",
        )}
        dropdownClassName="w-[300px]"
        errorMessage={errorMessage}
        statusMessage={isSubmitting ? `Switching to ${pendingBranch}...` : null}
        renderOption={(option, { isSelected }) => (
          <span className="flex min-w-0 items-start gap-3">
            <GitBranch
              size={16}
              className="mt-0.5 shrink-0 text-muted-foreground transition-colors group-hover:text-accent-foreground/70"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {option.label}
              </span>
              {isSelected && workingTreeSummary.changedFiles > 0 ? (
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground transition-colors group-hover:text-accent-foreground/70">
                  <span>
                    Uncommitted: {workingTreeSummary.changedFiles} file
                    {workingTreeSummary.changedFiles === 1 ? "" : "s"}
                  </span>
                  <span className="font-medium text-[#8FD98A]">
                    +{workingTreeSummary.additions}
                  </span>
                  <span className="font-medium text-[#F08BA7]">
                    -{workingTreeSummary.deletions}
                  </span>
                </span>
              ) : null}
            </span>
          </span>
        )}
        renderIndicator={(option) => {
          const isPending = option.value === pendingBranch
          const isCurrent = option.value === branchData?.currentBranch
          if (isPending) return <CircleNotch size={14} className="animate-spin text-muted-foreground" />
          if (isCurrent) return <CheckCircle size={14} />
          return null
        }}
        footer={
          <button
            type="button"
            onClick={() => {
              setActionErrorMessage(null)
              setIsOpen(false)
              setIsCreateDialogOpen(true)
            }}
            className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Plus
              size={16}
              className="shrink-0 text-muted-foreground transition-colors group-hover:text-accent-foreground/70"
            />
            <span className="truncate">Create and checkout new branch...</span>
          </button>
        }
      />

      <CreateBranchDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        projectPath={projectPath}
        currentBranch={branchData?.currentBranch ?? null}
        onCreated={(nextData) => {
          setBranchData(nextData)
          setActionErrorMessage(null)
        }}
      />
    </>
  )
}
