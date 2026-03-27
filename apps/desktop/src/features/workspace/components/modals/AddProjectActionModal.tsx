import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import {
  createShortcutBindingFromKeyboardEvent,
  formatShortcutBinding,
  hasShortcutModifier,
  type ShortcutBinding,
} from "@/features/settings/shortcuts"
import { Plus } from "@/components/icons"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import { Input } from "@/features/shared/components/ui/input"
import { Label } from "@/features/shared/components/ui/label"
import { Textarea } from "@/features/shared/components/ui/textarea"
import { useProjectStore } from "@/features/workspace/store"
import type { Project, ProjectAction } from "@/features/workspace/types"
import { getProjectActionCommands } from "@/features/workspace/utils/projectActions"
import { ProjectActionIcon } from "@/features/workspace/components/ProjectActionIcon"
import {
  normalizeProjectActionIconName,
  PROJECT_ACTION_ICON_OPTIONS,
  type ProjectActionIconName,
} from "@/features/workspace/utils/projectActionIcons"

interface AddProjectActionModalProps {
  open: boolean
  project: Project | null
  action?: ProjectAction | null
  onOpenChange: (open: boolean) => void
  onActionSaved?: (action: ProjectAction) => void
}

export function AddProjectActionModal({
  open,
  project,
  action,
  onOpenChange,
  onActionSaved,
}: AddProjectActionModalProps) {
  const addProjectAction = useProjectStore((state) => state.addProjectAction)
  const updateProjectAction = useProjectStore((state) => state.updateProjectAction)
  const deleteProjectAction = useProjectStore((state) => state.deleteProjectAction)
  const [name, setName] = useState("")
  const [iconName, setIconName] = useState<ProjectActionIconName | null>(null)
  const [hotkey, setHotkey] = useState<ShortcutBinding | null>(null)
  const [command, setCommand] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [hotkeyError, setHotkeyError] = useState<string | null>(null)
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    setName(action?.name ?? "")
    setIconName(normalizeProjectActionIconName(action?.iconName))
    setHotkey(action?.hotkey ?? null)
    setCommand(action?.command ?? "")
    setHotkeyError(null)
    setIsIconPickerOpen(false)
  }, [action, open])

  const selectedIconLabel = useMemo(
    () => PROJECT_ACTION_ICON_OPTIONS.find((option) => option.id === iconName)?.label ?? null,
    [iconName],
  )
  const commandCount = getProjectActionCommands(command).length
  const isValid = name.trim().length > 0 && commandCount > 0 && !hotkeyError

  const handleHotkeyKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") {
      return
    }

    event.preventDefault()

    if (event.key === "Backspace") {
      setHotkey(null)
      setHotkeyError(null)
      return
    }

    const nextBinding = createShortcutBindingFromKeyboardEvent(event.nativeEvent)
    if (!nextBinding) {
      return
    }

    if (!hasShortcutModifier(nextBinding)) {
      setHotkeyError("Include at least one modifier so the action does not trigger while typing.")
      return
    }

    setHotkey(nextBinding)
    setHotkeyError(null)
  }

  const handleSave = async () => {
    if (!project || !isValid) {
      return
    }

    setIsSaving(true)

    try {
      const nextAction = action
        ? await updateProjectAction(project.id, action.id, {
            name,
            iconName,
            iconPath: null,
            hotkey,
            command,
          })
        : await addProjectAction(project.id, {
            name,
            iconName,
            iconPath: null,
            hotkey,
            command,
          })

      onActionSaved?.(nextAction)
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!project || !action) {
      return
    }

    setIsSaving(true)

    try {
      await deleteProjectAction(project.id, action.id)
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            {action ? "Edit Action" : "Add Action"}
          </DialogTitle>
          <DialogDescription className="max-w-xl text-base leading-7">
            {action
              ? "Update this project-scoped terminal command and keep the toolbar in sync."
              : "Actions are project-scoped terminal commands you can run from the top bar or your keybindings."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="project-action-name">Name</Label>
            <div className="flex items-center gap-3">
              <DropdownMenu open={isIconPickerOpen} onOpenChange={setIsIconPickerOpen}>
              <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className={
                        iconName
                          ? "flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card text-muted-foreground transition hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                          : "flex size-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 text-muted-foreground transition hover:border-border hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      }
                      aria-label="Choose action icon"
                      title={selectedIconLabel ? `Icon: ${selectedIconLabel}` : "Choose action icon"}
                    />
                  }
                >
                  {iconName ? (
                    <ProjectActionIcon action={{ iconName }} size={22} />
                  ) : (
                    <Plus size={18} />
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={8}
                  className="w-[248px] border border-border/70 bg-card p-2 shadow-lg"
                >
                  <div className="grid grid-cols-6 gap-1.5">
                    {PROJECT_ACTION_ICON_OPTIONS.map((option) => {
                      const isSelected = option.id === iconName
                      const IconComponent = option.icon

                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setIconName(option.id)
                            setIsIconPickerOpen(false)
                          }}
                          className={
                            isSelected
                              ? "flex aspect-square w-full items-center justify-center rounded-lg border border-foreground/10 bg-accent text-foreground"
                              : "flex aspect-square w-full items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground transition hover:border-border hover:bg-accent hover:text-foreground"
                          }
                          aria-label={`Select ${option.label} icon`}
                          title={option.label}
                        >
                          <IconComponent size={17} />
                        </button>
                      )
                    })}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
              <Input
                id="project-action-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Run tests"
                autoFocus
                className="h-11"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-action-hotkey">Keybinding</Label>
            <Input
              id="project-action-hotkey"
              value={hotkey ? formatShortcutBinding(hotkey) : ""}
              onKeyDown={handleHotkeyKeyDown}
              onChange={() => undefined}
              placeholder="Press shortcut"
              className="h-11"
            />
            <p className="text-sm text-muted-foreground">
              {hotkeyError ?? "Press a shortcut. Use Backspace to clear."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-action-command">Command</Label>
            <Textarea
              id="project-action-command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder={"bun test\nbun run lint"}
              className="min-h-32 resize-y font-mono text-sm"
            />
            <p className="text-sm text-muted-foreground">
              Actions run sequentially. Each non-empty line is sent to the terminal as its own command.
            </p>
          </div>
        </DialogBody>

        <DialogFooter>
          {action ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={isSaving}
              className="sm:mr-auto"
            >
              Delete action
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!isValid || isSaving}>
            {isSaving ? "Saving action..." : action ? "Save changes" : "Save action"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
