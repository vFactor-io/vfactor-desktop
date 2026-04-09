import { CheckCircle, Refresh } from "@/components/icons"
import type { AppUpdateState } from "@/desktop/client"
import { Button } from "@/features/shared/components/ui/button"
import { useAppUpdateStore } from "@/features/updates/store/updateStore"
import { formatUpdateTime, getUpdateStatusLabel } from "./updatePresentation"

function renderReleaseNotes(message: string | null, status: string) {
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

function createPreviewState(
  currentVersion: string,
  patch: Partial<AppUpdateState>,
): AppUpdateState {
  return {
    enabled: true,
    status: "idle",
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: Date.now(),
    message: null,
    errorContext: null,
    activeWork: null,
    canDismiss: false,
    canRetry: false,
    canInstall: false,
    ...patch,
  }
}

function buildPreviewStates(currentVersion: string) {
  const previewVersion = "0.2.0"

  return {
    checking: createPreviewState(currentVersion, {
      status: "checking",
    }),
    downloading: createPreviewState(currentVersion, {
      status: "downloading",
      availableVersion: previewVersion,
      downloadPercent: 42,
      message: "Background updater redesign, better restart gating, and release pipeline fixes.",
    }),
    ready: createPreviewState(currentVersion, {
      status: "ready",
      availableVersion: previewVersion,
      downloadedVersion: previewVersion,
      downloadPercent: 100,
      message: "Background updater redesign, better restart gating, and release pipeline fixes.",
      canDismiss: true,
      canInstall: true,
    }),
    blocked: createPreviewState(currentVersion, {
      status: "blocked",
      availableVersion: previewVersion,
      downloadedVersion: previewVersion,
      downloadPercent: 100,
      message: "Restarting now will interrupt active coding work.",
      errorContext: "blocked",
      activeWork: {
        activeTurns: 1,
        activeTerminalSessions: 2,
        labels: ["1 active coding turn", "2 active terminal sessions"],
      },
      canDismiss: true,
      canInstall: true,
    }),
    downloadError: createPreviewState(currentVersion, {
      status: "error",
      availableVersion: previewVersion,
      message: "The update download failed. Check your connection and try again.",
      errorContext: "download",
      canDismiss: true,
      canRetry: true,
    }),
    installError: createPreviewState(currentVersion, {
      status: "error",
      availableVersion: previewVersion,
      downloadedVersion: previewVersion,
      downloadPercent: 100,
      message: "Nucleus could not hand off to the installer. Try restarting again.",
      errorContext: "install",
      canDismiss: true,
      canRetry: true,
      canInstall: true,
    }),
    upToDate: createPreviewState(currentVersion, {
      status: "up-to-date",
    }),
  }
}

export function UpdatesSection() {
  const updateState = useAppUpdateStore((state) => state.updateState)
  const checkForUpdates = useAppUpdateStore((state) => state.checkForUpdates)
  const installUpdate = useAppUpdateStore((state) => state.installUpdate)
  const dismissUpdate = useAppUpdateStore((state) => state.dismissUpdate)
  const refreshState = useAppUpdateStore((state) => state.refreshState)
  const setUpdateState = useAppUpdateStore((state) => state.setUpdateState)

  const currentVersion = updateState.currentVersion || "Unknown"
  const activeVersion =
    updateState.downloadedVersion ?? updateState.availableVersion ?? currentVersion
  const showRestartAction = updateState.status === "ready"
  const showDismissAction = updateState.canDismiss && updateState.status !== "downloading"
  const showErrorDetail = updateState.status === "error" && updateState.message
  const previewStates = buildPreviewStates(currentVersion)
  const isDevPreviewEnabled = import.meta.env.DEV

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

        {isDevPreviewEnabled ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-background/30 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-card-foreground">Dev preview</p>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  These controls only appear in development. They override the updater snapshot locally so you can test the sidebar pill, sticky toast, and blocked restart dialog without packaging the app.
                </p>
              </div>

              <Button size="sm" variant="outline" onClick={() => void refreshState()}>
                Reset to real state
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setUpdateState(previewStates.checking)}>
                Checking
              </Button>
              <Button size="sm" variant="outline" onClick={() => setUpdateState(previewStates.downloading)}>
                Downloading
              </Button>
              <Button size="sm" variant="outline" onClick={() => setUpdateState(previewStates.ready)}>
                Ready
              </Button>
              <Button size="sm" variant="outline" onClick={() => setUpdateState(previewStates.blocked)}>
                Blocked
              </Button>
              <Button size="sm" variant="outline" onClick={() => setUpdateState(previewStates.downloadError)}>
                Download error
              </Button>
              <Button size="sm" variant="outline" onClick={() => setUpdateState(previewStates.installError)}>
                Install error
              </Button>
              <Button size="sm" variant="outline" onClick={() => setUpdateState(previewStates.upToDate)}>
                Up to date
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
