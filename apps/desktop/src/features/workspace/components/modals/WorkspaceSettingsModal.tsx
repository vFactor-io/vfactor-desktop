import { useEffect, useState } from "react"
import { GitBranch } from "@/components/icons"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/features/shared/components/ui/dialog"
import { Button } from "@/features/shared/components/ui/button"
import { Input } from "@/features/shared/components/ui/input"
import { Label } from "@/features/shared/components/ui/label"
import { useProjectStore } from "@/features/workspace/store"
import type { Project, ProjectWorktree } from "@/features/workspace/types"

interface WorkspaceSettingsModalProps {
  open: boolean
  project: Project | null
  worktree: ProjectWorktree | null
  onOpenChange: (open: boolean) => void
}

export function WorkspaceSettingsModal({
  open,
  project,
  worktree,
  onOpenChange,
}: WorkspaceSettingsModalProps) {
  const updateWorktree = useProjectStore((state) => state.updateWorktree)
  const [name, setName] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !worktree) {
      return
    }

    setName(worktree.name)
    setErrorMessage(null)
  }, [open, worktree])

  const normalizedName = name.trim()
  const isValid = normalizedName.length > 0

  const handleSave = async () => {
    if (!project || !worktree || !isValid) {
      return
    }

    setIsSaving(true)
    setErrorMessage(null)

    try {
      await updateWorktree(project.id, worktree.id, {
        name,
      })
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to update workspace name:", error)
      setErrorMessage("Could not save workspace name. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSaving) {
      return
    }

    onOpenChange(nextOpen)
  }

  const handleCancel = () => {
    if (isSaving) {
      return
    }

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[min(92vw,420px)] max-w-[420px] gap-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-0 sm:max-w-[420px]"
        showCloseButton={false}
      >
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle>Workspace settings</DialogTitle>
          <DialogDescription className="sr-only">
            Change how this workspace appears in vFactor.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 px-5 py-4">
          <section className="space-y-1.5">
            <Label htmlFor="workspace-display-name">Visual name</Label>
            <Input
              id="workspace-display-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setErrorMessage(null)
              }}
              placeholder="Workspace name"
              autoFocus
              aria-invalid={errorMessage ? true : undefined}
              aria-describedby={errorMessage ? "workspace-display-name-error" : undefined}
            />
            {errorMessage ? (
              <p id="workspace-display-name-error" className="text-xs text-destructive">
                {errorMessage}
              </p>
            ) : null}
          </section>

          <section className="space-y-1.5 border-t border-border/60 pt-4">
            <h3 className="text-xs font-medium text-muted-foreground">Git branch</h3>
            <div className="flex h-8 items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 text-[13px] text-foreground/95">
              <GitBranch size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {worktree?.branchName ?? "No branch"}
              </span>
            </div>
          </section>
        </DialogBody>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={!isValid || isSaving}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
