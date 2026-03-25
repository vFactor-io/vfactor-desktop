import { useEffect, useState } from "react"
import { desktop, type GitBranchesResponse } from "@/desktop/client"
import { CircleNotch, GitBranch, X } from "@/components/icons"
import { Button } from "@/features/shared/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/features/shared/components/ui/dialog"
import { Input } from "@/features/shared/components/ui/input"

interface CreateBranchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string | null
  currentBranch: string | null
  onCreated: (data: GitBranchesResponse) => void
}

function formatCreateBranchError(error: unknown) {
  if (typeof error === "string") {
    return error
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return "Unable to create that branch right now."
}

export function CreateBranchDialog({
  open,
  onOpenChange,
  projectPath,
  currentBranch,
  onCreated,
}: CreateBranchDialogProps) {
  const [branchName, setBranchName] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setBranchName("")
      setErrorMessage(null)
      setIsSubmitting(false)
    }
  }, [open])

  const trimmedBranchName = branchName.trim()

  const handleCreateBranch = async () => {
    if (!projectPath || trimmedBranchName.length === 0 || isSubmitting) {
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const nextData = await desktop.git.createAndCheckoutBranch(projectPath, trimmedBranchName)

      onCreated(nextData)
      onOpenChange(false)
    } catch (error) {
      setErrorMessage(formatCreateBranchError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) {
          onOpenChange(nextOpen)
        }
      }}
    >
      <DialogContent
        className="w-[min(92vw,420px)] max-w-[420px] gap-0 overflow-hidden rounded-[24px] border border-sidebar-border bg-card p-0 text-card-foreground sm:max-w-[420px]"
        showCloseButton={false}
      >
        <div className="relative flex flex-col gap-4 px-5 py-4">
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-3 right-3 text-muted-foreground hover:bg-muted hover:text-foreground"
                disabled={isSubmitting}
              />
            }
          >
            <X size={16} />
            <span className="sr-only">Close create branch dialog</span>
          </DialogClose>

          <div className="flex items-center gap-2.5">
            <GitBranch size={18} className="text-muted-foreground" />
            <DialogTitle className="text-base font-semibold tracking-tight text-card-foreground">
              Create and checkout new branch
            </DialogTitle>
          </div>

          <DialogDescription className="text-sm leading-6">
            {currentBranch
              ? `Create a new branch from ${currentBranch}.`
              : "Create a new branch from your current checkout."}
          </DialogDescription>

          <div className="space-y-2">
            <label className="text-sm font-medium text-card-foreground" htmlFor="new-branch-name">
              Branch name
            </label>
            <Input
              id="new-branch-name"
              value={branchName}
              onChange={(event) => {
                setBranchName(event.target.value)
                if (errorMessage) {
                  setErrorMessage(null)
                }
              }}
              autoFocus
              placeholder="feature/branch-name"
              className="h-10 rounded-xl border-sidebar-border bg-background/30 px-3"
              disabled={isSubmitting}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void handleCreateBranch()
                }
              }}
            />
            {errorMessage ? (
              <p className="text-sm text-[#F08BA7]">{errorMessage}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Slashes are fine here. We&apos;ll skip the prefix prefill for now.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              className="rounded-lg px-4"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="min-w-36 rounded-lg bg-cta px-4 text-cta-foreground hover:bg-cta/90"
              onClick={() => void handleCreateBranch()}
              disabled={!projectPath || trimmedBranchName.length === 0 || isSubmitting}
            >
              <span className="inline-flex items-center gap-2">
                {isSubmitting ? (
                  <CircleNotch className="size-4 animate-spin" />
                ) : null}
                <span>{isSubmitting ? "Creating..." : "Create branch"}</span>
              </span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
