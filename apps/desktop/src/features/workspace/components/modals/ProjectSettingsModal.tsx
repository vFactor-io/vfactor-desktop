import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { CaretDown, Copy, GitBranch, Image, X } from "@/components/icons"
import { desktop } from "@/desktop/client"
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
import { SearchableSelect } from "@/features/shared/components/ui/searchable-select"
import { Textarea } from "@/features/shared/components/ui/textarea"
import { useProjectGitBranches } from "@/features/shared/hooks"
import { ProjectIcon } from "@/features/workspace/components/ProjectIcon"
import { useProjectStore } from "@/features/workspace/store"
import type { Project } from "@/features/workspace/types"
import {
  normalizeProjectIconPath,
  projectIconPathToSrc,
} from "@/features/workspace/utils/projectIcon"
import {
  COPY_ALL_ENV_FILES_SETUP_SNIPPET,
  insertSetupSnippet,
  SETUP_SCRIPT_VARIABLES,
} from "@/features/workspace/utils/setupScript"
import {
  getDefaultProjectWorkspacesPath,
  getProjectWorkspacesPath,
  normalizeProjectWorkspacesPath,
} from "@/features/workspace/utils/worktrees"

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
  const updateProject = useProjectStore((state) => state.updateProject)
  const setProjectTargetBranch = useProjectStore((state) => state.setTargetBranch)
  const [name, setName] = useState("")
  const [iconPath, setIconPath] = useState<string | null>(null)
  const [workspacesPath, setWorkspacesPath] = useState("")
  const [targetBranch, setTargetBranch] = useState<string | null>(null)
  const [remoteName, setRemoteName] = useState<string | null>(null)
  const [setupScript, setSetupScript] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { branchData, isLoading: isGitLoading, loadError, refresh } = useProjectGitBranches(
    open ? project?.repoRootPath ?? null : null,
    { enabled: open && Boolean(project?.repoRootPath) }
  )

  const defaultWorkspacesPath = useMemo(() => {
    if (!project) {
      return ""
    }

    return getDefaultProjectWorkspacesPath(project)
  }, [project])
  const defaultRemoteName = useMemo(() => {
    if (branchData?.hasOriginRemote) {
      return "origin"
    }

    return branchData?.remoteNames[0] ?? null
  }, [branchData])
  const resolvedRemoteName = useMemo(() => {
    if (remoteName?.trim()) {
      return remoteName.trim()
    }

    return defaultRemoteName
  }, [defaultRemoteName, remoteName])

  useEffect(() => {
    if (!open || !project) {
      return
    }

    setName(project.name)
    setIconPath(normalizeProjectIconPath(project.iconPath))
    setWorkspacesPath(getProjectWorkspacesPath(project))
    setTargetBranch(project.targetBranch)
    setRemoteName(project.remoteName ?? null)
    setSetupScript(project.setupScript ?? "")
  }, [open, project])

  const isValid = name.trim().length > 0 && workspacesPath.trim().length > 0
  const normalizedIconPath = normalizeProjectIconPath(iconPath)
  const selectedImageLabel = normalizedIconPath
    ? normalizedIconPath.startsWith("data:")
      ? "Uploaded image"
      : normalizedIconPath.split(/[\\/]/).pop() ?? "Uploaded image"
    : null
  const branchOptions = (branchData?.branches ?? []).map((branchName) => ({
    value: branchName,
    label: branchName,
  }))
  const remoteOptions = (branchData?.remoteNames ?? []).map((candidateRemoteName) => ({
    value: candidateRemoteName,
    label: candidateRemoteName,
  }))
  const workspacesPathMatchesDefault =
    normalizeProjectWorkspacesPath(workspacesPath) === normalizeProjectWorkspacesPath(defaultWorkspacesPath)

  const handleChooseImage = () => {
    const input = fileInputRef.current
    if (!input) {
      return
    }

    input.value = ""
    input.click()
  }

  const handleOpenPath = async (filePath: string | null | undefined) => {
    const normalizedPath = filePath?.trim()
    if (!normalizedPath) {
      return
    }

    try {
      await desktop.shell.openExternal(projectIconPathToSrc(normalizedPath) ?? normalizedPath)
    } catch (error) {
      console.error(`Failed to open path: ${normalizedPath}`, error)
    }
  }

  const handleChooseWorkspacesPath = async () => {
    const selectedPath = await desktop.dialog.openProjectFolder()
    if (!selectedPath) {
      return
    }

    setWorkspacesPath(selectedPath)
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
        workspacesPath: workspacesPathMatchesDefault ? null : workspacesPath,
        remoteName: resolvedRemoteName && resolvedRemoteName !== defaultRemoteName ? resolvedRemoteName : null,
        setupScript: setupScript.trim() || null,
      })

      if (targetBranch?.trim() && targetBranch !== project.targetBranch) {
        await setProjectTargetBranch(project.id, targetBranch)
      }

      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleInsertEnvCopySnippet = () => {
    setSetupScript((current) => insertSetupSnippet(current, COPY_ALL_ENV_FILES_SETUP_SNIPPET))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(92vw,560px)] max-w-[560px] gap-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-0 sm:max-w-[560px]"
        showCloseButton={false}
      >
        <DialogHeader className="overflow-hidden border-b border-border/60 px-5 py-4">
          <DialogTitle className="sr-only">Project settings</DialogTitle>
          <DialogDescription className="sr-only">
            Update the project name, paths, target branch, and preferred remote.
          </DialogDescription>

          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleIconInputChange}
              />
              <button
                type="button"
                onClick={() => void handleChooseImage()}
                className={`flex size-10 items-center justify-center rounded-xl border bg-muted/20 transition hover:border-border hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${normalizedIconPath ? "border-border/70" : "border-dashed border-border/50"}`}
                aria-label={normalizedIconPath ? "Change project image" : "Upload project image"}
                title={normalizedIconPath ? "Change project image" : "Upload project image"}
              >
                {normalizedIconPath ? (
                  <ProjectIcon
                    project={{ iconPath: normalizedIconPath }}
                    size={40}
                    className="h-full w-full rounded-[inherit] object-cover text-muted-foreground"
                  />
                ) : (
                  <Image size={18} className="text-muted-foreground/60" />
                )}
              </button>
              {normalizedIconPath ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setIconPath(null)
                  }}
                  className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground shadow-sm transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  aria-label="Clear project image"
                  title="Clear project image"
                >
                  <X size={10} />
                </button>
              ) : null}
            </div>

            <div className="min-w-0 flex-1">
              <Label htmlFor="project-name" className="sr-only">
                Project name
              </Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Project name"
                autoFocus
                className="h-auto border-0 bg-transparent px-0 text-lg font-semibold tracking-tight shadow-none focus-visible:ring-0"
              />
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-4 px-5 py-4">
          <section className="space-y-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">Root path</h3>
            <button
              type="button"
              onClick={() => void handleOpenPath(project?.repoRootPath)}
              className="flex w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-left transition hover:border-border hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/95">
                {project?.repoRootPath ?? "No root path"}
              </span>
              <CaretDown size={14} className="shrink-0 text-muted-foreground" />
            </button>
          </section>

          <section className="space-y-1.5 border-t border-border/60 pt-4">
            <h3 className="text-xs font-medium text-muted-foreground">Workspaces path</h3>
            <button
              type="button"
              onClick={() => void handleChooseWorkspacesPath()}
              className="flex w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-left transition hover:border-border hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/95">
                {workspacesPath || "Choose where new workspaces should be created"}
              </span>
              <CaretDown size={14} className="shrink-0 text-muted-foreground" />
            </button>
            {!workspacesPathMatchesDefault ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={() => setWorkspacesPath(defaultWorkspacesPath)}
              >
                Reset to default
              </Button>
            ) : null}
          </section>

          <section className="space-y-1.5 border-t border-border/60 pt-4">
            <h3 className="text-xs font-medium text-muted-foreground">Target branch</h3>
            <SearchableSelect
              value={targetBranch}
              onValueChange={setTargetBranch}
              options={branchOptions}
              displayValue={targetBranch ?? "Choose a branch"}
              icon={<GitBranch size={14} />}
              searchPlaceholder="Search branches"
              sectionLabel="Branches"
              emptyMessage="No matching branches found."
              disabled={!project || isGitLoading || branchOptions.length === 0}
              onOpen={() => {
                void refresh({ quiet: true })
              }}
              triggerClassName="h-8 rounded-lg border-border/70 bg-muted/20 px-3 text-[13px] hover:bg-muted/30"
              dropdownClassName="w-[300px]"
              errorMessage={loadError}
            />
          </section>

          <section className="space-y-1.5 border-t border-border/60 pt-4">
            <h3 className="text-xs font-medium text-muted-foreground">Remote</h3>
            <SearchableSelect
              value={resolvedRemoteName}
              onValueChange={setRemoteName}
              options={remoteOptions}
              displayValue={resolvedRemoteName ?? "No remote configured"}
              searchPlaceholder="Search remotes"
              sectionLabel="Remotes"
              emptyMessage="No remotes found."
              disabled={!project || isGitLoading || remoteOptions.length === 0}
              onOpen={() => {
                void refresh({ quiet: true })
              }}
              className="max-w-[180px]"
              triggerClassName="h-8 rounded-lg border-border/70 bg-muted/20 px-3 text-[13px] hover:bg-muted/30"
              dropdownClassName="w-[220px]"
              errorMessage={loadError}
            />
          </section>

          <section className="space-y-1.5 border-t border-border/60 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-xs font-medium text-muted-foreground">Setup script</h3>
                <p className="text-xs text-muted-foreground/70">Runs when a new workspace is created</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1.5 rounded-lg"
                onClick={handleInsertEnvCopySnippet}
                disabled={setupScript.includes(COPY_ALL_ENV_FILES_SETUP_SNIPPET)}
              >
                <Copy size={14} />
                {setupScript.includes(COPY_ALL_ENV_FILES_SETUP_SNIPPET) ? "Env snippet added" : "Insert env copy"}
              </Button>
            </div>
            <Textarea
              value={setupScript}
              onChange={(event) => setSetupScript(event.target.value)}
              placeholder="e.g., npm install"
              rows={3}
              className="min-h-28 resize-y border-border/70 bg-muted/20 font-mono text-[13px] text-foreground/95 placeholder:text-muted-foreground/40"
            />
            <details className="group">
              <summary className="cursor-pointer select-none text-xs text-muted-foreground/70 hover:text-muted-foreground">
                Available variables
              </summary>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {SETUP_SCRIPT_VARIABLES.map((variable) => (
                  <span
                    key={variable.key}
                    title={variable.description}
                    className="rounded bg-muted/30 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    {variable.key}
                  </span>
                ))}
              </div>
            </details>
          </section>
        </DialogBody>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => void handleSave()} disabled={!isValid || isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
