import { useEffect, useMemo, useRef, useState } from "react"
import { desktop } from "@/desktop/client"
import {
  CaretDown,
  CheckCircle,
  CircleNotch,
  GitBranch,
  MagnifyingGlass,
  Plus,
} from "@/components/icons"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/features/shared/components/ui"
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
  const [searchQuery, setSearchQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingBranch, setPendingBranch] = useState<string | null>(null)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setSearchQuery("")
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

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (isSubmitting) {
        return
      }

      if (!dropdownRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSubmitting) {
        return
      }

      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }, 0)

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen, isSubmitting])

  const filteredBranches = useMemo(() => {
    if (!branchData) {
      return []
    }

    const normalizedQuery = searchQuery.trim().toLowerCase()
    const matchesQuery = (branch: string) =>
      normalizedQuery.length === 0 || branch.toLowerCase().includes(normalizedQuery)

    const currentBranch = matchesQuery(branchData.currentBranch) ? [branchData.currentBranch] : []
    const remainingBranches = branchData.branches.filter(
      (branch) => branch !== branchData.currentBranch && matchesQuery(branch),
    )

    return [...currentBranch, ...remainingBranches]
  }, [branchData, searchQuery])

  if (!projectPath) {
    return null
  }

  const currentBranchLabel = branchData?.currentBranch ?? "Loading branch..."
  const workingTreeSummary = branchData?.workingTreeSummary ?? {
    changedFiles: 0,
    additions: 0,
    deletions: 0,
  }
  const canOpenMenu = !isLoading && branchData !== null
  const errorMessage = actionErrorMessage ?? loadError

  const handleBranchSelect = async (branch: string) => {
    if (!projectPath || !branchData || branch === branchData.currentBranch) {
      setIsOpen(false)
      return
    }

    setIsSubmitting(true)
    setPendingBranch(branch)
    setActionErrorMessage(null)

    try {
      const [nextData] = await Promise.all([
        desktop.git.checkoutBranch(projectPath, branch),
        new Promise((resolve) => window.setTimeout(resolve, MIN_BRANCH_LOADING_MS)),
      ])

      setBranchData(nextData)
      setSearchQuery("")
      setIsOpen(false)
    } catch (error) {
      setActionErrorMessage(formatBranchError(error))
    } finally {
      setIsSubmitting(false)
      setPendingBranch(null)
    }
  }

  return (
    <>
      <div ref={dropdownRef} className="relative hidden h-full min-w-0 items-center md:flex">
        <button
          type="button"
          onClick={() => {
            if (!canOpenMenu) {
              return
            }

            if (!isOpen) {
              void refresh({ quiet: true })
            }

            setActionErrorMessage(null)
            setSearchQuery("")
            setIsOpen((current) => !current)
          }}
          disabled={!canOpenMenu}
          className={cn(
            "inline-flex h-7 max-w-[260px] items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors",
            canOpenMenu
              ? "text-foreground hover:bg-muted/70"
              : "cursor-default text-muted-foreground/70",
            isOpen && "bg-muted text-foreground",
          )}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
        >
          <GitBranch size={15} className="shrink-0 text-muted-foreground" />
          <span className="truncate">{currentBranchLabel}</span>
          <CaretDown size={14} className="shrink-0 text-muted-foreground" />
        </button>

        {isOpen ? (
          <div className="absolute top-[calc(100%+6px)] left-0 z-50 flex w-[300px] flex-col overflow-hidden rounded-xl border border-sidebar-border bg-popover shadow-md ring-1 ring-foreground/10">
            <div className="border-b border-sidebar-border p-2">
              <InputGroup className="h-8 rounded-lg border-input/80 bg-input/30">
                <InputGroupAddon className="pl-2 text-muted-foreground">
                  <MagnifyingGlass size={16} />
                </InputGroupAddon>
                <InputGroupInput
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search branches"
                  className="h-full px-0 text-sm"
                  disabled={isSubmitting}
                />
              </InputGroup>
            </div>

            <div className="px-3 pt-3 pb-1 text-sm font-medium text-muted-foreground">
              Branches
            </div>

            <div className="max-h-72 overflow-y-auto p-1">
              {filteredBranches.length > 0 ? (
                <div className="space-y-0.5">
                  {filteredBranches.map((branch) => {
                    const isCurrent = branch === branchData?.currentBranch
                    const isPending = branch === pendingBranch

                    return (
                      <button
                        key={branch}
                        type="button"
                        onClick={() => void handleBranchSelect(branch)}
                        disabled={isSubmitting}
                        className={cn(
                          "flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                          isCurrent
                            ? "text-foreground"
                            : "text-foreground/92 hover:bg-muted/60",
                          isPending && "bg-muted/60",
                          isSubmitting && "opacity-80",
                        )}
                      >
                        <span className="flex min-w-0 items-start gap-3">
                          <GitBranch size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {branch}
                            </span>
                            {isCurrent && workingTreeSummary.changedFiles > 0 ? (
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
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

                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-foreground">
                          {isPending ? (
                            <CircleNotch size={14} className="animate-spin text-muted-foreground" />
                          ) : isCurrent ? (
                            <CheckCircle size={14} />
                          ) : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No matching branches found.
                </div>
              )}
            </div>

            {errorMessage ? (
              <div className="border-t border-sidebar-border px-3 py-2 text-sm text-[#F08BA7]">
                {errorMessage}
              </div>
            ) : isSubmitting ? (
              <div className="border-t border-sidebar-border px-3 py-2 text-sm text-muted-foreground">
                Switching to {pendingBranch}...
              </div>
            ) : null}

            <div className="sticky bottom-0 border-t border-sidebar-border bg-popover p-1">
              <button
                type="button"
                onClick={() => {
                  setActionErrorMessage(null)
                  setIsOpen(false)
                  setIsCreateDialogOpen(true)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
              >
                <Plus size={16} className="shrink-0 text-muted-foreground" />
                <span className="truncate">Create and checkout new branch...</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <CreateBranchDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        projectPath={projectPath}
        currentBranch={branchData?.currentBranch ?? null}
        onCreated={(nextData) => {
          setBranchData(nextData)
          setSearchQuery("")
          setActionErrorMessage(null)
        }}
      />
    </>
  )
}
