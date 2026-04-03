import asciiArtBackground from "@/assets/backgrounds/ascii-art.png"
import { CheckCircle, Circle, Plus } from "@/components/icons"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { ProjectIcon } from "@/features/workspace/components/ProjectIcon"
import { resolveProjectIconPath } from "@/features/workspace/utils/projectIcon"
import { Loader } from "./ai-elements/loader"
import { ChatInput } from "./ChatInput"
import { useNewWorkspaceSetupState } from "../hooks/useChat"
import type { WorkspaceSetupStep } from "../store/storeTypes"

function WorkspaceSetupStepRow({
  step,
  isLast,
}: {
  step: WorkspaceSetupStep
  isLast: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div className="flex size-5 shrink-0 items-center justify-center">
          {step.status === "completed" ? (
            <CheckCircle className="size-[18px] text-emerald-400" />
          ) : step.status === "active" ? (
            <Loader size={16} className="text-foreground/84" />
          ) : step.status === "error" ? (
            <Circle className="size-[18px] text-destructive" />
          ) : (
            <Circle className="size-[18px] text-muted-foreground/30" />
          )}
        </div>
        {!isLast && (
          <div
            className={
              step.status === "completed"
                ? "mt-1 h-4 w-px bg-emerald-400/40"
                : "mt-1 h-4 w-px bg-muted-foreground/16"
            }
          />
        )}
      </div>
      <span
        className={
          step.status === "pending"
            ? "pt-0.5 text-sm text-muted-foreground/50"
            : step.status === "error"
              ? "pt-0.5 text-sm font-medium text-destructive"
              : step.status === "active"
                ? "pt-0.5 text-sm font-medium text-foreground"
                : "pt-0.5 text-sm text-foreground/72"
        }
      >
        {step.label}
      </span>
    </div>
  )
}

export function NewWorkspaceSetupView() {
  const { selectedProject } = useCurrentProjectWorktree()
  const { input, setInput, submit, workspaceSetupState } = useNewWorkspaceSetupState()
  const selectedProjectIconPath = resolveProjectIconPath(selectedProject)
  const hasSteps = workspaceSetupState != null
  const title = workspaceSetupState?.title ?? "New workspace"
  const detail =
    workspaceSetupState?.errorMessage?.trim() ||
    workspaceSetupState?.detail?.trim() ||
    null

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={asciiArtBackground}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover object-center opacity-88"
          draggable={false}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,8,23,0.22)_44%,rgba(2,6,23,0.82)_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/58 via-black/28 to-background/72" />
      </div>

      <div className="relative z-10 flex w-full max-w-[803px] flex-col items-center gap-6 px-10">
        {hasSteps ? (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <h2 className="text-center text-[1.25rem] font-semibold leading-tight text-foreground md:text-[1.5rem]">
                {title}
              </h2>
              {detail && (
                <p
                  className={
                    workspaceSetupState?.status === "error"
                      ? "text-sm text-destructive"
                      : "text-sm text-muted-foreground"
                  }
                >
                  {detail}
                </p>
              )}
            </div>
            <div className="flex w-full max-w-[480px] flex-col">
              {workspaceSetupState.steps.map((step, index) => (
                <WorkspaceSetupStepRow
                  key={step.id}
                  step={step}
                  isLast={index === workspaceSetupState.steps.length - 1}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-4 text-center">
              {selectedProjectIconPath ? (
                <div className="size-10 overflow-hidden rounded-xl border border-border/40 shadow-lg shadow-black/20">
                  <ProjectIcon project={selectedProject} size={40} className="size-full rounded-none" />
                </div>
              ) : (
                <div className="flex size-10 items-center justify-center rounded-xl border border-border/40 bg-background/32 shadow-lg shadow-black/20 backdrop-blur-md">
                  <Plus size={20} className="text-foreground/60" />
                </div>
              )}
              <div className="flex flex-col items-center gap-1.5">
                <h2 className="text-center font-pixel text-2xl tracking-tight text-foreground">
                  New workspace
                </h2>
                {selectedProject?.name && (
                  <p className="text-sm text-muted-foreground/72">{selectedProject.name}</p>
                )}
              </div>
            </div>
            <div className="w-full">
              <ChatInput
                placement="intro"
                allowSlashCommands={false}
                input={input}
                setInput={setInput}
                isLocked={false}
                onSubmit={async (text, options) => {
                  await submit(text, options)
                }}
                status="idle"
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
