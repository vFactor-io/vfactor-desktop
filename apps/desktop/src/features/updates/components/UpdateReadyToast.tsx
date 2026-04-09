import { Refresh, X } from "@/components/icons"
import { desktop } from "@/desktop/client"
import { Button } from "@/features/shared/components/ui/button"
import { useAppUpdateStore } from "@/features/updates/store/updateStore"
import { cn } from "@/lib/utils"
import { getUpdateReleaseUrl } from "./updatePresentation"

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="size-5 shrink-0 text-muted-foreground"
      aria-label="Dismiss update notification"
      title="Dismiss"
      onClick={onClick}
    >
      <X size={12} />
    </Button>
  )
}

export function UpdateReadyToast() {
  const updateState = useAppUpdateStore((state) => state.updateState)
  const toastDismissedForStatus = useAppUpdateStore((state) => state.toastDismissedForStatus)
  const checkForUpdates = useAppUpdateStore((state) => state.checkForUpdates)
  const installUpdate = useAppUpdateStore((state) => state.installUpdate)
  const dismissUpdate = useAppUpdateStore((state) => state.dismissUpdate)
  const dismissToast = useAppUpdateStore((state) => state.dismissToast)

  const showDownloading = updateState.status === "downloading"
  const showReady = updateState.status === "ready" && updateState.canDismiss
  const showRetryableError =
    updateState.status === "error" &&
    updateState.canDismiss &&
    (updateState.errorContext === "download" || updateState.errorContext === "install")

  const isToastDismissed = toastDismissedForStatus === updateState.status

  if (isToastDismissed || (!showDownloading && !showReady && !showRetryableError)) {
    return null
  }

  const releaseUrl = getUpdateReleaseUrl(
    updateState.downloadedVersion ?? updateState.availableVersion
  )
  const isInstallError = updateState.errorContext === "install" && updateState.canInstall
  const version = updateState.downloadedVersion ?? updateState.availableVersion

  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-50 w-[min(92vw,320px)]">
      <div
        className={cn(
          "pointer-events-auto overflow-hidden rounded-xl border bg-card/97 shadow-lg backdrop-blur-sm",
          showRetryableError ? "border-amber-400/40" : "border-border/70"
        )}
      >
        {/* Downloading state: slim bar with progress */}
        {showDownloading ? (
          <div className="px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-card-foreground">
                Downloading {version ? `v${version}` : "update"}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {updateState.downloadPercent != null ? `${updateState.downloadPercent}%` : "…"}
                </span>
                <DismissButton onClick={dismissToast} />
              </div>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted/50">
              {updateState.downloadPercent != null ? (
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${updateState.downloadPercent}%` }}
                />
              ) : (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/50" />
              )}
            </div>
          </div>
        ) : null}

        {/* Ready state: version + actions */}
        {showReady ? (
          <div className="px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 text-xs font-medium text-card-foreground">
                {version ? `v${version} ready` : "Update ready"}
              </p>
              <DismissButton onClick={() => void dismissUpdate()} />
            </div>
            {updateState.message ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                {updateState.message}
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-1.5">
              <Button type="button" size="sm" className="h-7 text-xs" onClick={() => void installUpdate()}>
                Restart to update
              </Button>
              {releaseUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => void desktop.shell.openExternal(releaseUrl)}
                >
                  Release notes
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Error state: message + retry */}
        {showRetryableError ? (
          <div className="px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 text-xs font-medium text-amber-600">
                {isInstallError ? "Restart failed" : "Download failed"}
              </p>
              <DismissButton onClick={() => void dismissUpdate()} />
            </div>
            {updateState.message ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                {updateState.message}
              </p>
            ) : null}
            <div className="mt-2">
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  if (isInstallError) {
                    void installUpdate()
                    return
                  }
                  void checkForUpdates()
                }}
              >
                <Refresh size={12} />
                {isInstallError ? "Retry restart" : "Retry"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
