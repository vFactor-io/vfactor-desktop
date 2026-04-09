import { ArrowDown, Refresh } from "@/components/icons"
import { Button } from "@/features/shared/components/ui/button"
import { cn } from "@/lib/utils"
import { useAppUpdateStore } from "@/features/updates/store/updateStore"
import { getUpdatePercentLabel } from "./updatePresentation"

export function SidebarUpdatePill() {
  const updateState = useAppUpdateStore((state) => state.updateState)
  const checkForUpdates = useAppUpdateStore((state) => state.checkForUpdates)
  const installUpdate = useAppUpdateStore((state) => state.installUpdate)

  const showDownloading = updateState.status === "downloading"
  const showReady = updateState.status === "ready" && updateState.canDismiss
  const showRetryableError =
    updateState.status === "error" &&
    updateState.canDismiss &&
    (updateState.errorContext === "download" || updateState.errorContext === "install")

  if (!showDownloading && !showReady && !showRetryableError) {
    return null
  }

  const percentLabel = getUpdatePercentLabel(updateState)
  const isInstallError = updateState.errorContext === "install" && updateState.canInstall
  const buttonLabel = showDownloading
    ? percentLabel
      ? `Downloading ${percentLabel}`
      : "Downloading update…"
    : showReady
      ? "Restart to update"
      : isInstallError
        ? "Retry restart"
        : "Retry download"

  return (
    <div
      className={cn(
        "rounded-xl border px-2 py-2",
        showRetryableError
          ? "border-amber-400/35 bg-amber-500/8"
          : "border-sidebar-border/60 bg-[color:var(--sidebar-item-active)]"
      )}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-sidebar-foreground">
            {buttonLabel}
          </p>
          <p className="truncate text-[11px] text-sidebar-foreground/56">
            {showRetryableError
              ? updateState.message ?? "The update could not be completed."
              : updateState.downloadedVersion
                ? `v${updateState.downloadedVersion} is ready`
                : "Background updates stay local to this app"}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={showRetryableError ? "outline" : "secondary"}
          className="h-7 shrink-0 px-2.5 text-[11px]"
          onClick={() => {
            if (showDownloading) {
              return
            }

            if (showReady || isInstallError) {
              void installUpdate()
              return
            }

            void checkForUpdates()
          }}
          disabled={showDownloading || updateState.status === "installing"}
        >
          {showRetryableError ? <Refresh size={12} /> : <ArrowDown size={12} />}
          <span>{showDownloading ? "Live" : showReady ? "Restart" : "Retry"}</span>
        </Button>
      </div>
    </div>
  )
}
