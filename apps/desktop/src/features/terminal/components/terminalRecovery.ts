export interface TerminalRenderState {
  isConnected: boolean
  display: string
  visibility: string
  width: number
  height: number
}

export function isTerminalRenderable(renderState: TerminalRenderState) {
  if (!renderState.isConnected) {
    return false
  }

  if (renderState.display === "none" || renderState.visibility === "hidden") {
    return false
  }

  return renderState.width > 1 && renderState.height > 1
}

export function shouldRecoverTerminal(
  documentVisibilityState: DocumentVisibilityState,
  renderState: TerminalRenderState
) {
  if (documentVisibilityState === "hidden") {
    return false
  }

  return isTerminalRenderable(renderState)
}
