import type { AppUpdateState } from "@/desktop/client"

export function formatUpdateTime(timestamp: number | null): string {
  if (!timestamp) {
    return "Never"
  }

  const seconds = Math.floor((Date.now() - timestamp) / 1000)

  if (seconds < 60) {
    return "Just now"
  }

  if (seconds < 3_600) {
    return `${Math.floor(seconds / 60)}m ago`
  }

  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3_600)}h ago`
  }

  return new Date(timestamp).toLocaleDateString()
}

export function getUpdatePercentLabel(updateState: AppUpdateState): string | null {
  if (updateState.downloadPercent == null) {
    return null
  }

  return `${updateState.downloadPercent}%`
}

export function getUpdateReleaseUrl(version: string | null): string | null {
  if (!version) {
    return null
  }

  return `https://github.com/vFactor-io/vfactor-desktop/releases/tag/v${version}`
}

export function getUpdateStatusLabel(updateState: AppUpdateState): string {
  switch (updateState.status) {
    case "disabled":
      return "Updates unavailable"
    case "idle":
      return "Waiting for the next background check"
    case "checking":
      return "Checking for updates…"
    case "up-to-date":
      return "Up to date"
    case "downloading":
      return updateState.downloadPercent != null
        ? `Downloading update… ${updateState.downloadPercent}%`
        : "Downloading update…"
    case "ready":
      return updateState.downloadedVersion
        ? `Restart to install v${updateState.downloadedVersion}`
        : "Restart to install update"
    case "blocked":
      return "Restart is blocked by active work"
    case "installing":
      return "Restarting to install update…"
    case "error":
      return "Update action failed"
    default:
      return "Updates"
  }
}
