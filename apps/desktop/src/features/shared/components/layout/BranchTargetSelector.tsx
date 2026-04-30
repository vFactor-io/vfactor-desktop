import { GitBranch, CaretRight } from "@/components/icons"
import { SearchableSelect } from "@/features/shared/components/ui/searchable-select"
import { contentTextClassNames, iconTextClassNames } from "@/features/shared/appearance"
import { useProjectGitBranches } from "@/features/shared/hooks"
import { ProjectIcon } from "@/features/workspace/components/ProjectIcon"
import { useProjectStore } from "@/features/workspace/store"
import { cn } from "@/lib/utils"

interface BranchTargetSelectorProps {
  projectId: string | null
  projectTargetBranch: string | null
  worktreePath: string | null
}

export function BranchTargetSelector({
  projectId,
  projectTargetBranch,
  worktreePath,
}: BranchTargetSelectorProps) {
  const { branchData, isLoading, loadError, refresh } = useProjectGitBranches(worktreePath, {
    enabled: Boolean(worktreePath),
  })
  const setTargetBranch = useProjectStore((state) => state.setTargetBranch)
  const project = useProjectStore((state) =>
    projectId ? state.projects.find((candidate) => candidate.id === projectId) ?? null : null
  )

  if (!projectId || !worktreePath) {
    return null
  }

  const currentBranch = !branchData
    ? "Loading branch..."
    : !branchData.isGitAvailable
      ? "Git not installed"
      : !branchData.isRepo
        ? "Git not initialized"
        : branchData.currentBranch || "No branch"
  const options = (branchData?.branches ?? []).map((branchName) => ({
    value: branchName,
    label: branchName,
  }))
  const isGitSelectable = Boolean(branchData?.isGitAvailable && branchData.isRepo)

  return (
    <div className="hidden min-w-0 items-center gap-2 md:flex">
      <div
        className={cn(
          "inline-flex min-w-0 max-w-[220px] items-center gap-1.5 text-sm font-medium",
          contentTextClassNames.default,
          isLoading && contentTextClassNames.muted
        )}
      >
        <span className={cn("flex size-4 shrink-0 items-center justify-center", iconTextClassNames.subtle)}>
          <ProjectIcon project={project} size={14} className="shrink-0 rounded-[4px]" />
        </span>
        <span className="truncate">{currentBranch}</span>
      </div>

      <CaretRight size={14} className={cn("shrink-0", iconTextClassNames.muted)} />

      <SearchableSelect
        value={projectTargetBranch}
        onValueChange={(branchName) => void setTargetBranch(projectId, branchName)}
        options={options}
        displayValue={
          projectTargetBranch ??
          (!branchData
            ? "Choose target branch"
            : !branchData.isGitAvailable
              ? "Install Git to pick a branch"
              : !branchData.isRepo
                ? "Initialize Git to pick a branch"
                : "Choose target branch")
        }
        icon={<GitBranch size={15} />}
        searchPlaceholder="Search target branches"
        sectionLabel="Target branch"
        emptyIcon={<GitBranch size={17} />}
        emptyTitle={branchData?.branches.length === 0 ? "No branches available" : "No matches"}
        emptyMessage={
          branchData?.branches.length === 0
            ? "Once this repository has branches, you can choose a target branch here."
            : "Try a different branch name."
        }
        disabled={isLoading || !isGitSelectable}
        onOpen={() => {
          void refresh({ quiet: true })
        }}
        triggerVariant="text"
        className="min-w-0 items-center"
        triggerClassName="max-w-[312px] gap-1.5 font-medium"
        dropdownClassName="w-[360px]"
        errorMessage={loadError}
      />
    </div>
  )
}
