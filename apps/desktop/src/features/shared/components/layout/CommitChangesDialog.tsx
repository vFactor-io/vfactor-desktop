import { useEffect, useMemo, useState } from "react"

import type { GitFileChange } from "@/desktop/client"
import { CheckCircle, Circle, CircleNotch } from "@/components/icons"
import { Button } from "@/features/shared/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/shared/components/ui/dialog"
import { Textarea } from "@/features/shared/components/ui/textarea"
import { cn } from "@/lib/utils"

interface CommitChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentBranch: string
  isDefaultBranch: boolean
  changes: GitFileChange[]
  isSubmitting?: boolean
  onConfirm: (input: { commitMessage?: string; filePaths?: string[] }) => Promise<void> | void
  onConfirmOnNewBranch: (input: {
    commitMessage?: string
    filePaths?: string[]
  }) => Promise<void> | void
}

function getStatusLabel(change: GitFileChange): string {
  if (change.status === "untracked") {
    return "New"
  }

  return change.status.charAt(0).toUpperCase() + change.status.slice(1)
}

function getStatusClasses(change: GitFileChange): string {
  switch (change.status) {
    case "added":
    case "untracked":
    case "copied":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    case "deleted":
      return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300"
    case "renamed":
      return "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"
    case "ignored":
      return "border-border/70 bg-muted text-muted-foreground"
    default:
      return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  }
}

export function CommitChangesDialog({
  open,
  onOpenChange,
  currentBranch,
  isDefaultBranch,
  changes,
  isSubmitting = false,
  onConfirm,
  onConfirmOnNewBranch,
}: CommitChangesDialogProps) {
  const [commitMessage, setCommitMessage] = useState("")
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set())
  const selectedChanges = useMemo(
    () => changes.filter((change) => !excludedFiles.has(change.path)),
    [changes, excludedFiles]
  )

  useEffect(() => {
    if (!open) {
      setCommitMessage("")
      setExcludedFiles(new Set())
    }
  }, [open])

  const handleSubmit = async (featureBranch: boolean) => {
    const trimmedCommitMessage = commitMessage.trim()
    const filePaths = selectedChanges.map((change) => change.path)
    const payload = {
      ...(trimmedCommitMessage ? { commitMessage: trimmedCommitMessage } : {}),
      ...(filePaths.length > 0 && filePaths.length !== changes.length ? { filePaths } : {}),
    }

    if (featureBranch) {
      await onConfirmOnNewBranch(payload)
      return
    }

    await onConfirm(payload)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Commit changes
            {isDefaultBranch ? (
              <span className="ml-2 inline-block align-middle rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {currentBranch}
              </span>
            ) : (
              <span className="ml-2 inline-block align-middle text-sm font-normal text-muted-foreground">
                {currentBranch}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Click files to exclude them. Leave the message blank to auto-generate one.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Changed files</span>
              <span className="text-xs text-muted-foreground">
                {selectedChanges.length}/{changes.length} selected
              </span>
            </div>

            <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/20">
              {changes.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No changes to commit.
                </div>
              ) : (
                <div className="max-h-[220px] overflow-y-auto p-1">
                  <div className="space-y-px">
                    {changes.map((change) => {
                      const isSelected = !excludedFiles.has(change.path)

                      return (
                        <button
                          key={change.path}
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => {
                            setExcludedFiles((current) => {
                              const next = new Set(current)
                              if (next.has(change.path)) {
                                next.delete(change.path)
                              } else {
                                next.add(change.path)
                              }
                              return next
                            })
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                            isSelected
                              ? "hover:bg-muted/40"
                              : "text-muted-foreground opacity-60 hover:bg-muted/30"
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center",
                              isSelected
                                ? "text-emerald-700 dark:text-emerald-300"
                                : "text-muted-foreground"
                            )}
                          >
                            {isSelected ? <CheckCircle size={14} /> : <Circle size={14} />}
                          </span>

                          <span className="min-w-0 flex-1 truncate">
                            {change.status === "renamed" && change.previousPath
                              ? `${change.previousPath} → ${change.path}`
                              : change.path}
                          </span>

                          <span
                            className={cn(
                              "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
                              getStatusClasses(change)
                            )}
                          >
                            {getStatusLabel(change)}
                          </span>

                          <span className="shrink-0 text-xs text-muted-foreground">
                            <span className="text-emerald-700 dark:text-emerald-300">
                              +{change.additions ?? 0}
                            </span>
                            <span className="px-0.5">/</span>
                            <span className="text-rose-700 dark:text-rose-300">
                              -{change.deletions ?? 0}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">Commit message</span>
            <Textarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Optional — leave blank to auto-generate"
              className="min-h-20 text-sm"
              disabled={isSubmitting || changes.length === 0 || selectedChanges.length === 0}
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleSubmit(true)}
            disabled={isSubmitting || selectedChanges.length === 0}
          >
            {isSubmitting ? <CircleNotch className="size-4 animate-spin" /> : null}
            New branch
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit(false)}
            disabled={isSubmitting || selectedChanges.length === 0}
          >
            {isSubmitting ? <CircleNotch className="size-4 animate-spin" /> : null}
            {isSubmitting ? "Committing..." : "Commit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
