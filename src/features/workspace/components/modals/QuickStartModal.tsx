import { useState, useEffect } from "react"
import { desktop } from "@/desktop/client"
import { Command } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/features/shared/components/ui/dialog"
import { Button } from "@/features/shared/components/ui/button"
import { Input } from "@/features/shared/components/ui/input"
import { Label } from "@/features/shared/components/ui/label"
import { useProjectStore } from "../../store"
import { openFolderPicker } from "../../utils/folderDialog"

interface QuickStartModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuickStartModal({ open, onOpenChange }: QuickStartModalProps) {
  const [name, setName] = useState("")
  const { defaultLocation, setDefaultLocation, addProject } = useProjectStore()
  const [location, setLocation] = useState(defaultLocation)

  // Sync location with defaultLocation when it changes or modal opens
  useEffect(() => {
    if (open && defaultLocation) {
      setLocation(defaultLocation)
    }
  }, [open, defaultLocation])

  const handleBrowse = async () => {
    const folderPath = await openFolderPicker()
    if (folderPath) {
      setLocation(folderPath)
      // Persist the new default location
      await setDefaultLocation(folderPath)
    }
  }

  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || !location.trim()) {
      return
    }

    setError(null)
    setIsCreating(true)

    try {
      // Create the full project path
      const projectPath = `${location}/${name}`

      // Check if folder already exists
      const folderExists = await desktop.fs.exists(projectPath)
      if (folderExists) {
        setError("A folder with this name already exists at this location.")
        setIsCreating(false)
        return
      }

      // Create the directory
      await desktop.fs.mkdir(projectPath, { recursive: true })

      // Add to project store
      await addProject(projectPath, name)

      // Reset form and close
      setName("")
      setError(null)
      onOpenChange(false)
    } catch (err) {
      console.error("Failed to create project:", err)
      setError("Failed to create project folder. Please check the location and try again.")
    } finally {
      setIsCreating(false)
    }
  }

  const isValid = name.trim().length > 0 && location.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick start</DialogTitle>
          <DialogDescription>
            Create a new project folder in your selected location.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* Name field */}
          <div className="space-y-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              placeholder="my-awesome-project"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Location field */}
          <div className="space-y-2">
            <Label htmlFor="project-location">Location</Label>
            <div className="flex gap-2">
              <Input
                id="project-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="flex-1"
              />
              <Button variant="outline" onClick={handleBrowse}>
                Browse...
              </Button>
            </div>
          </div>

          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button onClick={handleCreate} disabled={!isValid || isCreating}>
            {isCreating ? "Creating..." : "Create"}
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-primary-foreground/70">
              <Command size={12} />
              <span></span>
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
