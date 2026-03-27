import { useCallback, useEffect, useRef } from "react"

interface UseResizablePanelOptions {
  width: number
  setWidth: (width: number) => void
  isCollapsed: boolean
  /** "left" = drag right increases width; "right" = drag left increases width */
  side: "left" | "right"
}

export function useResizablePanel({ width, setWidth, isCollapsed, side }: UseResizablePanelOptions) {
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const stopResizing = useCallback(() => {
    resizeStateRef.current = null
    document.documentElement.style.removeProperty("cursor")
    document.documentElement.style.removeProperty("user-select")
    document.documentElement.style.removeProperty("-webkit-user-select")
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
    document.body.style.removeProperty("-webkit-user-select")
  }, [])

  useEffect(() => {
    return () => {
      stopResizing()
    }
  }, [stopResizing])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) {
        return
      }

      const delta = event.clientX - resizeState.startX
      const nextWidth = side === "left"
        ? resizeState.startWidth + delta
        : resizeState.startWidth - delta
      setWidth(nextWidth)
    }

    const handlePointerUp = () => {
      stopResizing()
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [setWidth, stopResizing, side])

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCollapsed) {
        return
      }

      event.preventDefault()

      resizeStateRef.current = {
        startX: event.clientX,
        startWidth: width,
      }

      window.getSelection()?.removeAllRanges()
      document.documentElement.style.cursor = "col-resize"
      document.documentElement.style.userSelect = "none"
      document.documentElement.style.setProperty("-webkit-user-select", "none")
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      document.body.style.setProperty("-webkit-user-select", "none")
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [isCollapsed, width],
  )

  return { handleResizeStart }
}
