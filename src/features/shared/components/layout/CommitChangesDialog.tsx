import { useEffect, useMemo, useState } from "react"
import { desktop } from "@/desktop/client"
import {
  CloudUpload,
  GitBranch,
  GitCommit,
  GitPullRequest,
  X,
} from "@/components/icons"
import { Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/features/shared/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/features/shared/components/ui/dialog"
import { Switch } from "@/features/shared/components/ui/switch"
import { Textarea } from "@/features/shared/components/ui/textarea"
import { cn } from "@/lib/utils"

interface CommitChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string | null
}

interface GitBranchesResponse {
  currentBranch: string
}

type NextStepId = "commit" | "commit-and-push" | "commit-and-create-pr"

const NEXT_STEP_OPTIONS: Array<{
  id: NextStepId
  label: string
  icon: typeof GitCommit
  disabled?: boolean
}> = [
  { id: "commit", label: "Commit", icon: GitCommit },
  { id: "commit-and-push", label: "Commit and push", icon: CloudUpload },
  {
    id: "commit-and-create-pr",
    label: "Commit and create PR",
    icon: GitPullRequest,
    disabled: true,
  },
]

export function CommitChangesDialog({
  open,
  onOpenChange,
  projectPath,
}: CommitChangesDialogProps) {
  const [currentBranch, setCurrentBranch] = useState("main")
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [commitMessage, setCommitMessage] = useState("")
  const [nextStep, setNextStep] = useState<NextStepId>("commit")

  useEffect(() => {
    let cancelled = false

    if (!projectPath) {
      setCurrentBranch("main")
      return
    }

    desktop.git.getBranches(projectPath)
      .then((response) => {
        if (!cancelled && response.currentBranch.trim()) {
          setCurrentBranch(response.currentBranch)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentBranch("main")
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectPath])

  const summary = useMemo(
    () => ({
      files: 5,
      additions: 879,
      deletions: 97,
    }),
    [],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(92vw,400px)] max-w-[400px] gap-0 overflow-hidden rounded-xl border border-sidebar-border bg-card p-0 text-card-foreground sm:max-w-[400px]"
        showCloseButton={false}
      >
        <div className="relative flex flex-col gap-3 px-5 py-4">
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-3 right-3 text-muted-foreground hover:bg-muted hover:text-foreground"
              />
            }
          >
            <X size={16} />
            <span className="sr-only">Close commit dialog</span>
          </DialogClose>

          <div className="flex items-center gap-2.5">
            <GitCommit size={18} className="text-muted-foreground" />
            <DialogTitle className="text-base font-semibold tracking-tight text-card-foreground">
              Commit your changes
            </DialogTitle>
          </div>

          <div className="space-y-3">

            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium text-card-foreground">Branch</span>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <GitBranch size={16} />
                  <span className="font-medium text-card-foreground">{currentBranch}</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="font-medium text-card-foreground">Changes</span>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>{summary.files} files</span>
                  <span className="font-medium text-[#8FD98A]">+{summary.additions}</span>
                  <span className="font-medium text-[#F08BA7]">-{summary.deletions}</span>
                </div>
              </div>

              <label className="flex items-center gap-3">
                <Switch
                  size="sm"
                  checked={includeUnstaged}
                  onCheckedChange={setIncludeUnstaged}
                />
                <span className="font-medium text-card-foreground">Include unstaged</span>
              </label>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium text-card-foreground">Commit message</div>
              <Textarea
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Leave blank to autogenerate a commit message"
                className="min-h-14 rounded-lg border-sidebar-border bg-background/30 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium text-card-foreground">Next steps</div>

              <div className="border-b border-sidebar-border/80">
                {NEXT_STEP_OPTIONS.map(({ id, label, icon: Icon, disabled }, index) => {
                  const isSelected = id === nextStep

                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        if (!disabled) {
                          setNextStep(id)
                        }
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                        index > 0 && "border-t border-sidebar-border/80",
                        disabled
                          ? "cursor-not-allowed text-muted-foreground/65"
                          : "text-card-foreground hover:bg-muted/40",
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon size={16} />
                        <span className="font-medium">{label}</span>
                      </span>
                      <span className="flex items-center justify-center text-muted-foreground">
                        {isSelected ? <HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={2} className="text-foreground" /> : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end">
            <Button
              type="button"
              className="min-w-28 rounded-lg bg-cta px-4 text-cta-foreground hover:bg-cta/90"
              onClick={() => {
                console.info("[CommitChangesDialog] Continue clicked", {
                  includeUnstaged,
                  nextStep,
                  commitMessage,
                })
                onOpenChange(false)
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
