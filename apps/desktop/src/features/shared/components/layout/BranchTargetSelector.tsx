import { GitBranch, CaretRight } from "@/components/icons"
import { SearchableSelect } from "@/features/shared/components/ui/searchable-select"
import { useProjectGitBranches } from "@/features/shared/hooks"
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

  if (!projectId || !worktreePath) {
    return null
  }

  const currentBranch = branchData?.currentBranch ?? "Loading branch..."
  const options = (branchData?.branches ?? []).map((branchName) => ({
    value: branchName,
    label: branchName,
  }))

  return (
    <div className="hidden min-w-0 items-center gap-2 md:flex">
      <div
        className={cn(
          "inline-flex min-w-0 max-w-[220px] items-center gap-1.5 text-sm font-medium text-foreground",
          isLoading && "text-muted-foreground"
        )}
      >
        <GitBranch size={14} className="shrink-0 text-muted-foreground" />
        <span className="truncate">{currentBranch}</span>
      </div>

      <CaretRight size={14} className="shrink-0 text-muted-foreground/70" />

      <SearchableSelect
        value={projectTargetBranch}
        onValueChange={(branchName) => void setTargetBranch(projectId, branchName)}
        options={options}
        displayValue={projectTargetBranch ?? "Choose target branch"}
        icon={<GitBranch size={15} />}
        searchPlaceholder="Search target branches"
        sectionLabel="Target branch"
        emptyMessage="No matching branches found."
        disabled={isLoading || !branchData}
        onOpen={() => {
          void refresh({ quiet: true })
        }}
        triggerVariant="ghost"
        className="min-w-0 items-center"
        triggerClassName="max-w-[260px] gap-1.5 px-0 font-medium text-muted-foreground"
        dropdownClassName="w-[300px]"
        errorMessage={loadError}
      />
    </div>
  )
}
