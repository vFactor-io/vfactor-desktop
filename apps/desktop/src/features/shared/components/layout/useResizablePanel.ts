import { useCallback, useEffect, useRef, useState } from "react"

interface UseResizablePanelOptions {
  width: number
  setWidth: (width: number) => void
  persistWidth?: () => void
  isCollapsed: boolean
  widthCssVariable?: string
  clampWidth?: (width: number) => number
  /** "left" = drag right increases width; "right" = drag left increases width */
  side: "left" | "right"
}

export function useResizablePanel({
  width,
  setWidth,
  persistWidth,
  isCollapsed,
  widthCssVariable,
  clampWidth,
  side,
}: UseResizablePanelOptions) {
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const pendingWidthRef = useRef<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  const stopResizing = useCallback(() => {
    const didResize = resizeStateRef.current !== null
    const nextWidth = pendingWidthRef.current
    resizeStateRef.current = null
    pendingWidthRef.current = null
    setIsResizing(false)
    delete document.documentElement.dataset.sidebarResizing
    document.documentElement.style.removeProperty("cursor")
    document.documentElement.style.removeProperty("user-select")
    document.documentElement.style.removeProperty("-webkit-user-select")
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
    document.body.style.removeProperty("-webkit-user-select")
    if (didResize && nextWidth != null) {
      setWidth(clampWidth ? clampWidth(nextWidth) : nextWidth)
      persistWidth?.()
    }
  }, [clampWidth, persistWidth, setWidth])

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
      const clampedWidth = clampWidth ? clampWidth(nextWidth) : nextWidth
      pendingWidthRef.current = clampedWidth

      if (widthCssVariable) {
        document.documentElement.style.setProperty(widthCssVariable, `${clampedWidth}px`)
      }
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
  }, [clampWidth, stopResizing, side, widthCssVariable])

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
      pendingWidthRef.current = width
      setIsResizing(true)

      window.getSelection()?.removeAllRanges()
      document.documentElement.dataset.sidebarResizing = "true"
      if (widthCssVariable) {
        document.documentElement.style.setProperty(widthCssVariable, `${width}px`)
      }
      document.documentElement.style.cursor = "col-resize"
      document.documentElement.style.userSelect = "none"
      document.documentElement.style.setProperty("-webkit-user-select", "none")
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      document.body.style.setProperty("-webkit-user-select", "none")
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [isCollapsed, width, widthCssVariable],
  )

  return { handleResizeStart, isResizing }
}
