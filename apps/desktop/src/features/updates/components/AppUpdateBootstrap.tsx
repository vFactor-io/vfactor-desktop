import { useEffect } from "react"
import { desktop } from "@/desktop/client"
import { useAppUpdateStore } from "@/features/updates/store/updateStore"

export function AppUpdateBootstrap() {
  const initialize = useAppUpdateStore((state) => state.initialize)
  const setUpdateState = useAppUpdateStore((state) => state.setUpdateState)

  useEffect(() => {
    let isMounted = true
    let unlisten: (() => void) | null = null

    void initialize()

    try {
      const dispose = desktop.app.onUpdateState((state) => {
        setUpdateState(state)
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
  }, [initialize, setUpdateState])

  return null
}
