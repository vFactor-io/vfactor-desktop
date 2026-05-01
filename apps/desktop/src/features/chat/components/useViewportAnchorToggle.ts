import { useCallback } from "react"

export function useViewportAnchorToggle() {
  return useCallback(
    (_anchor: HTMLElement | null, toggle: () => void) => {
      toggle()
    },
    []
  )
}
