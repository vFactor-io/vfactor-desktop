import { CheckCircle, Refresh } from "@/components/icons"
import type { AppUpdateState } from "@/desktop/client"
import { Button } from "@/features/shared/components/ui/button"
import { useAppUpdateStore } from "@/features/updates/store/updateStore"
import { formatUpdateTime, getUpdateStatusLabel } from "./updatePresentation"

function renderReleaseNotes(message: string | null, status: AppUpdateState["status"]) {
  if (!message) {
    return null
  }

  if (status === "error" || status === "blocked" || status === "disabled" || status === "idle") {
    return null
  }

  return (
    <div className="rounded-xl border border-border/70 bg-muted/35 px-3 py-3">
      <p className="text-sm font-medium text-card-foreground">Release notes</p>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{message}</p>
    </div>
  )
}

export function UpdatesSection() {
  const updateState = useAppUpdateStore((state) => state.updateState)
  const checkForUpdates = useAppUpdateStore((state) => state.checkForUpdates)
  const installUpdate = useAppUpdateStore((state) => state.installUpdate)
  const dismissUpdate = useAppUpdateStore((state) => state.dismissUpdate)

  const currentVersion = updateState.currentVersion || "Unknown"
  const activeVersion =
    updateState.downloadedVersion ?? updateState.availableVersion ?? currentVersion
  const showRestartAction =
    updateState.canInstall &&
    updateState.status !== "downloading" &&
    updateState.status !== "installing"
  const showDismissAction = updateState.canDismiss && updateState.status !== "downloading"
  const showErrorDetail = updateState.status === "error" && updateState.message

  return (
    <section className="rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
      <div className="space-y-5 px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {updateState.status === "up-to-date" ? (
              <div className="flex items-center gap-2">
                <CheckCircle size={15} className="shrink-0 text-emerald-500" />
                <p className="text-sm font-medium">Nucleus is up to date</p>
              </div>
            ) : (
              <p className="text-sm font-medium">{getUpdateStatusLabel(updateState)}</p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              Current version: v{currentVersion}
              {activeVersion !== currentVersion ? `  •  Latest version: v${activeVersion}` : ""}
            </p>
          </div>

          <p className="shrink-0 text-xs text-muted-foreground">
            Checked {formatUpdateTime(updateState.checkedAt)}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-background/40 px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Status
            </p>
            <p className="mt-2 text-sm text-card-foreground">{getUpdateStatusLabel(updateState)}</p>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/40 px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Progress
            </p>
            <p className="mt-2 text-sm text-card-foreground">
              {updateState.downloadPercent != null ? `${updateState.downloadPercent}%` : "No active download"}
            </p>
          </div>
        </div>

        {renderReleaseNotes(updateState.message, updateState.status)}

        {showErrorDetail ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3">
            <p className="text-sm font-medium text-destructive">Updater error</p>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{updateState.message}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void checkForUpdates()}
            disabled={
              updateState.status === "checking" ||
              updateState.status === "downloading" ||
              updateState.status === "installing"
            }
          >
            <Refresh size={14} />
            {updateState.status === "checking" ? "Checking..." : "Check now"}
          </Button>

          {showRestartAction ? (
            <Button size="sm" onClick={() => void installUpdate()}>
              Restart to install
            </Button>
          ) : null}

          {showDismissAction ? (
            <Button size="sm" variant="ghost" onClick={() => void dismissUpdate()}>
              Later
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
