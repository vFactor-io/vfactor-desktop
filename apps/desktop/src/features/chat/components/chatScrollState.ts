const SCROLL_EDGE_THRESHOLD_PX = 2
const SCROLL_BOTTOM_THRESHOLD_PX = 8

export interface ChatScrollMetrics {
  scrollOffset: number
  contentSize: number
  viewportSize: number
}

export interface ChatScrollState {
  isScrollable: boolean
  isAtTop: boolean
  isAtBottom: boolean
}

function normalizeFiniteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function getChatScrollStateFromMetrics({
  scrollOffset,
  contentSize,
  viewportSize,
}: ChatScrollMetrics): ChatScrollState {
  const normalizedContentSize = Math.max(0, normalizeFiniteNumber(contentSize))
  const normalizedViewportSize = Math.max(0, normalizeFiniteNumber(viewportSize))
  const maxScrollOffset = Math.max(0, normalizedContentSize - normalizedViewportSize)
  const normalizedScrollOffset = Math.min(
    maxScrollOffset,
    Math.max(0, normalizeFiniteNumber(scrollOffset))
  )
  const isScrollable =
    normalizedContentSize > normalizedViewportSize + SCROLL_EDGE_THRESHOLD_PX
  const distanceFromBottom = Math.max(
    0,
    normalizedContentSize - normalizedViewportSize - normalizedScrollOffset
  )

  return {
    isScrollable,
    isAtTop: !isScrollable || normalizedScrollOffset <= SCROLL_EDGE_THRESHOLD_PX,
    isAtBottom: !isScrollable || distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX,
  }
}
