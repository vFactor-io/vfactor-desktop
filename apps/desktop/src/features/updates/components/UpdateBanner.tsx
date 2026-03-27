import { ArrowDown, Refresh } from "@/components/icons"
import { Badge } from "@/features/shared/components/ui/badge"
import { Button } from "@/features/shared/components/ui/button"
import { useAppUpdateStore } from "@/features/updates/store/updateStore"

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UpdateBanner() {
  const phase = useAppUpdateStore((state) => state.phase)
  const availableUpdate = useAppUpdateStore((state) => state.availableUpdate)
  const dismissedVersion = useAppUpdateStore((state) => state.dismissedVersion)
  const downloadedBytes = useAppUpdateStore((state) => state.downloadedBytes)
  const contentLength = useAppUpdateStore((state) => state.contentLength)
  const error = useAppUpdateStore((state) => state.error)
  const installUpdate = useAppUpdateStore((state) => state.installUpdate)
  const dismissUpdate = useAppUpdateStore((state) => state.dismissUpdate)
  const checkForUpdates = useAppUpdateStore((state) => state.checkForUpdates)

  const isVisible =
    !!availableUpdate &&
    (dismissedVersion !== availableUpdate.version ||
      phase === "downloading" ||
      phase === "installing" ||
      phase === "installed" ||
      phase === "error")

  if (!isVisible || !availableUpdate) {
    return null
  }

  const notes = availableUpdate.notes?.trim()
  const progressLabel =
    phase === "downloading"
      ? contentLength
        ? `Downloading ${formatBytes(downloadedBytes)} of ${formatBytes(contentLength)}`
        : `Downloading ${formatBytes(downloadedBytes)}`
      : phase === "installing"
        ? "Installing update..."
        : phase === "installed"
          ? "Update installed. Nucleus will relaunch to finish."
          : null
  const actionLabel =
    phase === "downloading"
      ? "Downloading..."
      : phase === "installing"
        ? "Installing..."
        : phase === "installed"
          ? "Installed"
          : "Install update"

  return (
    <div className="border-b border-border/70 bg-[linear-gradient(180deg,rgba(182,212,255,0.12),rgba(182,212,255,0.04))]">
      <div className="mx-auto flex max-w-[980px] items-start justify-between gap-4 px-6 py-4 sm:px-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Update available</Badge>
            <p className="text-sm font-medium text-main-content-foreground">
              Nucleus {availableUpdate.version} is ready to install.
            </p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            You are on {availableUpdate.currentVersion}. Install the latest release without leaving the app.
          </p>
          {notes ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{notes}</p> : null}
          {progressLabel ? <p className="mt-2 text-xs font-medium text-muted-foreground">{progressLabel}</p> : null}
          {phase === "error" && error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {phase === "error" ? (
            <Button variant="outline" size="sm" onClick={() => void checkForUpdates()}>
              <Refresh size={14} />
              Check again
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => void installUpdate()}
            disabled={phase === "downloading" || phase === "installing" || phase === "installed"}
          >
            <ArrowDown size={14} />
            {actionLabel}
          </Button>
          {phase === "available" ? (
            <Button variant="ghost" size="sm" onClick={dismissUpdate}>
              Later
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
