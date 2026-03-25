import { useEffect } from "react"
import { desktop } from "@/desktop/client"
import {
  type AppUpdateDownloadEvent,
  useAppUpdateStore,
} from "@/features/updates/store/updateStore"

export function AppUpdateBootstrap() {
  const initialize = useAppUpdateStore((state) => state.initialize)
  const handleDownloadEvent = useAppUpdateStore((state) => state.handleDownloadEvent)

  useEffect(() => {
    let isMounted = true
    let unlisten: (() => void) | null = null

    void initialize()

    try {
      const dispose = desktop.app.onUpdateEvent((event: AppUpdateDownloadEvent) => {
        handleDownloadEvent(event)
      })

      if (isMounted) {
        unlisten = dispose
      } else {
        dispose()
      }
    } catch (error) {
      console.error("Failed to subscribe to app update events:", error)
    }

    return () => {
      isMounted = false
      unlisten?.()
    }
  }, [handleDownloadEvent, initialize])

  return null
}
