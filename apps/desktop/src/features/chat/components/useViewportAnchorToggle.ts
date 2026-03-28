import { useCallback, useRef } from "react"
import { useStickToBottomContext } from "use-stick-to-bottom"

export function useViewportAnchorToggle() {
  const stickToBottom = useStickToBottomContext()
  const releaseTimeoutRef = useRef<number | null>(null)

  return useCallback(
    (anchor: HTMLElement | null, toggle: () => void) => {
      const scrollElement = stickToBottom.scrollRef.current
      if (!anchor || !scrollElement) {
        toggle()
        return
      }

      const topBefore = anchor.getBoundingClientRect().top
      const previousTargetScrollTop = stickToBottom.targetScrollTop

      // For the immediate resize caused by this toggle, anchor the clicked
      // control in place and let StickToBottom own the actual scroll update.
      stickToBottom.targetScrollTop = (_targetScrollTop, { scrollElement }) => {
        const drift = anchor.getBoundingClientRect().top - topBefore
        return scrollElement.scrollTop + drift
      }

      if (releaseTimeoutRef.current != null) {
        window.clearTimeout(releaseTimeoutRef.current)
        releaseTimeoutRef.current = null
      }

      toggle()

      releaseTimeoutRef.current = window.setTimeout(() => {
        releaseTimeoutRef.current = null
        requestAnimationFrame(() => {
          const currentScrollTop = scrollElement.scrollTop
          stickToBottom.state.lastScrollTop = currentScrollTop
          stickToBottom.state.ignoreScrollToTop = currentScrollTop
          stickToBottom.targetScrollTop = previousTargetScrollTop ?? null
        })
      }, 0)
    },
    [stickToBottom]
  )
}
