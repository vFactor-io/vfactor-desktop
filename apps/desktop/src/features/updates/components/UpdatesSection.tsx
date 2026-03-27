import { ArrowDown, CheckCircle, Refresh } from "@/components/icons"
import { Badge } from "@/features/shared/components/ui/badge"
import { Button } from "@/features/shared/components/ui/button"
import { useAppUpdateStore } from "@/features/updates/store/updateStore"

function formatCheckedAt(timestamp: number | null): string {
  if (!timestamp) {
    return "Not checked yet"
  }

  return new Date(timestamp).toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UpdatesSection() {
  const phase = useAppUpdateStore((state) => state.phase)
  const availableUpdate = useAppUpdateStore((state) => state.availableUpdate)
  const lastCheckedAt = useAppUpdateStore((state) => state.lastCheckedAt)
  const error = useAppUpdateStore((state) => state.error)
  const downloadedBytes = useAppUpdateStore((state) => state.downloadedBytes)
  const contentLength = useAppUpdateStore((state) => state.contentLength)
  const checkForUpdates = useAppUpdateStore((state) => state.checkForUpdates)
  const installUpdate = useAppUpdateStore((state) => state.installUpdate)

  const statusLabel =
    phase === "available"
      ? `Version ${availableUpdate?.version} is available`
      : phase === "checking"
        ? "Checking GitHub Releases"
        : phase === "downloading"
          ? contentLength
            ? `Downloading ${formatBytes(downloadedBytes)} of ${formatBytes(contentLength)}`
            : `Downloading ${formatBytes(downloadedBytes)}`
          : phase === "installing"
            ? "Installing update"
            : phase === "installed"
              ? "Update installed. The app will relaunch to finish."
              : phase === "up-to-date"
                ? "You are on the latest release"
                : phase === "error"
                  ? "Update check failed"
                  : "Ready to check for updates"

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-[560px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={availableUpdate ? "secondary" : "outline"}>
                {availableUpdate ? "Update available" : "Release feed"}
              </Badge>
              <p className="text-sm font-medium tracking-tight text-card-foreground">{statusLabel}</p>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Nucleus checks GitHub Releases for signed installer updates and can install them in-app.
            </p>
            <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <div>Last checked: {formatCheckedAt(lastCheckedAt)}</div>
              <div>Source: GitHub Releases for bradleygibsongit/nucleus-desktop</div>
              {availableUpdate ? <div>Current version: {availableUpdate.currentVersion}</div> : null}
              {availableUpdate ? <div>Latest version: {availableUpdate.version}</div> : null}
            </div>
            {availableUpdate?.notes ? (
              <div className="mt-3 rounded-xl border border-border/70 bg-muted/35 px-3 py-2.5 text-sm leading-6 text-muted-foreground">
                {availableUpdate.notes}
              </div>
            ) : null}
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void checkForUpdates()}
              disabled={phase === "checking" || phase === "downloading" || phase === "installing"}
            >
              <Refresh size={14} />
              {phase === "checking" ? "Checking..." : "Check now"}
            </Button>
            <Button
              size="sm"
              onClick={() => void installUpdate()}
              disabled={!availableUpdate || phase === "checking" || phase === "downloading" || phase === "installing"}
            >
              {availableUpdate ? <ArrowDown size={14} /> : <CheckCircle size={14} />}
              {phase === "downloading"
                ? "Downloading..."
                : phase === "installing"
                  ? "Installing..."
                  : "Install update"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
