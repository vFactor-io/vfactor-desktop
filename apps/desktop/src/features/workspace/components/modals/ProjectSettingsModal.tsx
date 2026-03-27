import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { X } from "@/components/icons"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/shared/components/ui/dialog"
import { Button } from "@/features/shared/components/ui/button"
import { Input } from "@/features/shared/components/ui/input"
import { Label } from "@/features/shared/components/ui/label"
import type { Project } from "@/features/workspace/types"
import { useProjectStore } from "@/features/workspace/store"
import { ProjectIcon } from "@/features/workspace/components/ProjectIcon"
import { normalizeProjectIconPath } from "@/features/workspace/utils/projectIcon"

interface ProjectSettingsModalProps {
  open: boolean
  project: Project | null
  onOpenChange: (open: boolean) => void
}

export function ProjectSettingsModal({
  open,
  project,
  onOpenChange,
}: ProjectSettingsModalProps) {
  const { updateProject } = useProjectStore()
  const [name, setName] = useState("")
  const [iconPath, setIconPath] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open || !project) {
      return
    }

    setName(project.name)
    setIconPath(normalizeProjectIconPath(project.iconPath))
  }, [open, project])

  const isValid = name.trim().length > 0
  const normalizedIconPath = normalizeProjectIconPath(iconPath)
  const selectedImageLabel = normalizedIconPath
    ? normalizedIconPath.startsWith("data:")
      ? "Uploaded image"
      : normalizedIconPath.split(/[\\/]/).pop() ?? "Uploaded image"
    : null

  const handleChooseImage = () => {
    const input = fileInputRef.current
    if (!input) {
      return
    }

    input.value = ""
    input.click()
  }

  const handleIconInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const nextIconPath = await new Promise<string | null>((resolve) => {
      const reader = new FileReader()

      reader.onload = () => {
        resolve(typeof reader.result === "string" ? reader.result : null)
      }

      reader.onerror = () => {
        resolve(null)
      }

      reader.readAsDataURL(file)
    })

    if (!nextIconPath) {
      console.error("Failed to read selected project image.")
      return
    }

    setIconPath(nextIconPath)
  }

  const handleSave = async () => {
    if (!project || !isValid) {
      return
    }

    setIsSaving(true)

    try {
      await updateProject(project.id, {
        name,
        iconPath: normalizedIconPath,
      })
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            Update the name and image for {project?.name ?? "this project"}.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="min-w-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleIconInputChange}
            />
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => void handleChooseImage()}
                  className="flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-muted/20 transition hover:border-border hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  aria-label={normalizedIconPath ? "Change project image" : "Upload project image"}
                  title={normalizedIconPath ? "Change project image" : "Upload project image"}
                >
                  <ProjectIcon
                    project={{ iconPath: normalizedIconPath }}
                    size={56}
                    className="h-full w-full rounded-[inherit] object-cover text-muted-foreground"
                  />
                </button>
                {normalizedIconPath ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      setIconPath(null)
                    }}
                    className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground shadow-sm transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    aria-label="Clear project image"
                    title="Clear project image"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="project-name" className="sr-only">
                    Project name
                  </Label>
                  <Input
                    id="project-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Project name"
                    autoFocus
                    className="h-auto border-0 bg-transparent px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
                  />
                </div>

                <div className="break-all text-sm text-muted-foreground">
                  {project?.path ?? "No folder selected"}
                </div>

                <div className="text-sm text-muted-foreground">
                  {selectedImageLabel
                    ? `Click the image to change it. Selected: ${selectedImageLabel}`
                    : "Click the image to upload one. The folder icon is used by default."}
                </div>
              </div>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!isValid || isSaving}>
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
