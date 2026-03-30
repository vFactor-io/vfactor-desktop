import { useEffect, useRef, useState } from "react"
import { desktop, type TerminalStartResponse } from "@/desktop/client"
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
import { Textarea } from "@/features/shared/components/ui/textarea"
import { useChatStore } from "@/features/chat/store"
import { Terminal } from "@/features/terminal/components/Terminal"
import { useProjectStore } from "@/features/workspace/store"
import { openFolderPicker } from "@/features/workspace/utils/folderDialog"

interface QuickStartModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SetupStep = "configure" | "running"

interface ActiveRunState {
  sessionId: string
  cwd: string
  existingDirectoryNames: string[]
}

type TerminalShellKind = TerminalStartResponse["shellKind"]

const RUN_COMPLETE_MARKER = "__NUCLEUS_QUICK_START_DONE__"
const TERMINAL_COLS = 120
const TERMINAL_ROWS = 28

async function resolveCreatedProjectPath(runState: ActiveRunState) {
  const entries = await desktop.fs.readDir(runState.cwd)
  const existingNames = new Set(runState.existingDirectoryNames)
  const newDirectories = entries.filter(
    (entry) => entry.isDirectory && !existingNames.has(entry.name),
  )

  if (newDirectories.length === 1) {
    return newDirectories[0].path
  }

  return runState.cwd
}

function buildCompletionCommand(command: string, shellKind: TerminalShellKind) {
  if (shellKind === "cmd") {
    return [command, `echo ${RUN_COMPLETE_MARKER}:%errorlevel%`, ""].join("\r\n")
  }

  if (shellKind === "powershell") {
    return [
      command,
      "$__nucleusQuickStartExitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }",
      `Write-Output ('${RUN_COMPLETE_MARKER}:' + $__nucleusQuickStartExitCode)`,
      "",
    ].join("\r\n")
  }

  return [command, `printf "\\n${RUN_COMPLETE_MARKER}:%s\\n" "$?"`, ""].join("\n")
}

export function QuickStartModal({ open, onOpenChange }: QuickStartModalProps) {
  const defaultLocation = useProjectStore((state) => state.defaultLocation)
  const setDefaultLocation = useProjectStore((state) => state.setDefaultLocation)
  const addProject = useProjectStore((state) => state.addProject)
  const selectProject = useProjectStore((state) => state.selectProject)
  const openDraftSession = useChatStore((state) => state.openDraftSession)

  const [step, setStep] = useState<SetupStep>("configure")
  const [command, setCommand] = useState("")
  const [location, setLocation] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isRunStarting, setIsRunStarting] = useState(false)
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null)
  const activeRunStateRef = useRef<ActiveRunState | null>(null)
  const ignoredExitSessionIdsRef = useRef(new Set<string>())
  const isRunStartingRef = useRef(false)
  const runOutputBufferRef = useRef("")
  const activeRunListenersRef = useRef<(() => void) | null>(null)

  const cleanupRunSession = async (runState: ActiveRunState, errorContext: string) => {
    activeRunListenersRef.current?.()
    activeRunListenersRef.current = null
    runOutputBufferRef.current = ""
    if (activeRunStateRef.current?.sessionId === runState.sessionId) {
      activeRunStateRef.current = null
    }
    ignoredExitSessionIdsRef.current.add(runState.sessionId)

    try {
      await desktop.terminal.closeSession(runState.sessionId)
    } catch (error) {
      console.error(errorContext, error)
    }
  }

  useEffect(() => {
    if (open) {
      activeRunListenersRef.current?.()
      activeRunListenersRef.current = null
      isRunStartingRef.current = false
      setIsRunStarting(false)
      setLocation(defaultLocation)
      setErrorMessage(null)
      setStep("configure")
      activeRunStateRef.current = null
      setActiveRun(null)
      runOutputBufferRef.current = ""
    }
  }, [open])

  useEffect(() => {
    activeRunStateRef.current = activeRun
  }, [activeRun])

  useEffect(() => {
    return () => {
      activeRunListenersRef.current?.()
      activeRunListenersRef.current = null

      const activeRunState = activeRunStateRef.current
      if (!activeRunState) {
        return
      }

      void cleanupRunSession(
        activeRunState,
        "Failed to close quick start terminal session:",
      )
    }
  }, [])

  useEffect(() => {
    if (open || !activeRun) {
      return
    }

    activeRunListenersRef.current?.()
    activeRunListenersRef.current = null
    void cleanupRunSession(activeRun, "Failed to close quick start terminal session:")
    setStep("configure")
    setActiveRun(null)
  }, [activeRun, open])

  const finishSuccessfulRun = async (runState: ActiveRunState) => {
    const resolvedProjectPath = await resolveCreatedProjectPath(runState)
    if (!resolvedProjectPath) {
      setErrorMessage(
        "The command finished, but we couldn't determine which project folder was created.",
      )
      setStep("configure")
      setActiveRun(null)
      return
    }

    let project =
      useProjectStore.getState().projects.find(
        (candidate) => candidate.path === resolvedProjectPath,
      ) ?? null

    if (!project) {
      const resolvedProjectName = resolvedProjectPath.split("/").pop() || resolvedProjectPath
      await addProject(resolvedProjectPath, resolvedProjectName)
      project =
        useProjectStore.getState().projects.find(
          (candidate) => candidate.path === resolvedProjectPath,
        ) ?? null
    }

    if (!project) {
      throw new Error("Project was created, but it could not be added to the workspace list.")
    }

    await cleanupRunSession(runState, "Failed to close quick start terminal session:")
    await selectProject(project.id)
    const rootWorktreePath =
      project.worktrees.find((candidate) => candidate.id === project.rootWorktreeId)?.path ??
      project.repoRootPath
    await openDraftSession(project.id, rootWorktreePath)

    setActiveRun(null)
    setStep("configure")
    onOpenChange(false)
  }

  const handleModalOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && activeRun) {
      void cleanupRunSession(activeRun, "Failed to close quick start terminal session:")
      setActiveRun(null)
      setStep("configure")
    }

    onOpenChange(nextOpen)
  }

  const handleBrowse = async () => {
    const folderPath = await openFolderPicker()
    if (!folderPath) {
      return
    }

    setLocation(folderPath)
    await setDefaultLocation(folderPath)
  }

  const handleRun = async () => {
    const trimmedCommand = command.trim()
    const trimmedLocation = location.trim()
    const sessionId = `quick-start:${crypto.randomUUID()}`

    if (!trimmedLocation) {
      setErrorMessage("Choose the folder where the project should be created.")
      return
    }

    if (!trimmedCommand) {
      setErrorMessage("Add an install command before running.")
      return
    }

    if (isRunStartingRef.current || activeRunStateRef.current) {
      return
    }

    isRunStartingRef.current = true
    setIsRunStarting(true)

    try {
      const entries = await desktop.fs.readDir(trimmedLocation)
      const nextRun: ActiveRunState = {
        sessionId,
        cwd: trimmedLocation,
        existingDirectoryNames: entries
          .filter((entry) => entry.isDirectory)
          .map((entry) => entry.name),
      }

      activeRunListenersRef.current?.()
      runOutputBufferRef.current = ""

      const unlistenData = desktop.terminal.onData((event) => {
        if (event.sessionId !== nextRun.sessionId) {
          return
        }

        runOutputBufferRef.current = `${runOutputBufferRef.current}${event.data}`.slice(-4000)
        const markerMatch = runOutputBufferRef.current.match(
          /__NUCLEUS_QUICK_START_DONE__:(-?\d+)/
        )

        if (!markerMatch) {
          return
        }

        runOutputBufferRef.current = ""
        const exitCode = Number(markerMatch[1] ?? "1")

        if (exitCode !== 0) {
          setErrorMessage(`The install command exited with code ${exitCode}.`)
          return
        }

        void finishSuccessfulRun(nextRun).catch((error) => {
          console.error("Failed to finish quick start setup:", error)
          void cleanupRunSession(
            nextRun,
            "Failed to close quick start terminal session after setup error:",
          ).finally(() => {
            setErrorMessage(
              error instanceof Error ? error.message : "Failed to open the created project.",
            )
            setStep("configure")
            activeRunStateRef.current = null
            setActiveRun(null)
          })
        })
      })

      const unlistenExit = desktop.terminal.onExit((event) => {
        if (event.sessionId !== nextRun.sessionId) {
          return
        }

        if (ignoredExitSessionIdsRef.current.has(event.sessionId)) {
          ignoredExitSessionIdsRef.current.delete(event.sessionId)
          return
        }

        activeRunListenersRef.current?.()
        activeRunListenersRef.current = null
        runOutputBufferRef.current = ""
        setErrorMessage("The terminal session ended before the install command completed.")
        setStep("configure")
        activeRunStateRef.current = null
        setActiveRun(null)
      })

      activeRunListenersRef.current = () => {
        unlistenData()
        unlistenExit()
      }

      setErrorMessage(null)
      activeRunStateRef.current = nextRun
      setActiveRun(nextRun)
      setStep("running")

      const response = await desktop.terminal.createSession(
        sessionId,
        trimmedLocation,
        TERMINAL_COLS,
        TERMINAL_ROWS,
      )
      await desktop.terminal.write(
        sessionId,
        buildCompletionCommand(trimmedCommand, response.shellKind),
      )
      await setDefaultLocation(trimmedLocation)
    } catch (error) {
      console.error("Failed to start quick start terminal session:", error)
      await cleanupRunSession(
        {
          sessionId,
          cwd: trimmedLocation,
          existingDirectoryNames: [],
        },
        "Failed to close quick start terminal session:",
      )
      activeRunStateRef.current = null
      setActiveRun(null)
      setStep("configure")
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to start the install command.",
      )
    } finally {
      isRunStartingRef.current = false
      setIsRunStarting(false)
    }
  }

  const canRun =
    command.trim().length > 0 && location.trim().length > 0 && !isRunStarting

  return (
    <Dialog open={open} onOpenChange={handleModalOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Add a custom install command and run it in the embedded terminal.
          </DialogDescription>
        </DialogHeader>

        {step === "configure" ? (
          <DialogBody className="space-y-5">
            <section className="space-y-2">
              <Label htmlFor="quick-start-location">Location</Label>
              <div className="flex gap-2">
                <Input
                  id="quick-start-location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="/Users/bradleygibson/projects"
                  className="h-10 flex-1 border-border/70 bg-background/40"
                />
                <Button type="button" variant="outline" onClick={handleBrowse}>
                  Browse
                </Button>
              </div>
            </section>

            <section className="space-y-2">
              <Label htmlFor="quick-start-install-command">Install command</Label>
              <Textarea
                id="quick-start-install-command"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="bun create next-app my-app"
                className="min-h-[112px] resize-none border-border/70 bg-background/40 font-mono text-[13px] leading-6"
              />
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <span>Start from a</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void desktop.shell.openExternal("https://ui.shadcn.com/create")}
                  className="h-auto px-0 py-0 text-sm font-normal text-muted-foreground underline underline-offset-4 hover:bg-transparent hover:text-foreground"
                >
                  template
                </Button>
                <span>instead.</span>
              </div>
              {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
            </section>
          </DialogBody>
        ) : (
          <DialogBody className="space-y-3">
            <Terminal
              sessionId={activeRun?.sessionId ?? null}
              cwd={activeRun?.cwd ?? null}
              className="h-[320px] border-0"
            />
            {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
          </DialogBody>
        )}

        <DialogFooter>
          {step === "configure" ? (
            <>
              <Button type="button" variant="outline" onClick={() => handleModalOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleRun()} disabled={!canRun}>
                Run Command
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => handleModalOpenChange(false)}>
              Stop and Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
