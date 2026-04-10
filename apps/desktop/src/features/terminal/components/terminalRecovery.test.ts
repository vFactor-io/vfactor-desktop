import { describe, expect, test } from "bun:test"
import { isTerminalRenderable, shouldRecoverTerminal } from "./terminalRecovery"

describe("isTerminalRenderable", () => {
  test("returns true for a connected, visible terminal with real size", () => {
    expect(
      isTerminalRenderable({
        isConnected: true,
        display: "block",
        visibility: "visible",
        width: 640,
        height: 480,
      })
    ).toBe(true)
  })

  test("returns false when the terminal is hidden or detached", () => {
    expect(
      isTerminalRenderable({
        isConnected: false,
        display: "block",
        visibility: "visible",
        width: 640,
        height: 480,
      })
    ).toBe(false)

    expect(
      isTerminalRenderable({
        isConnected: true,
        display: "none",
        visibility: "visible",
        width: 640,
        height: 480,
      })
    ).toBe(false)

    expect(
      isTerminalRenderable({
        isConnected: true,
        display: "block",
        visibility: "hidden",
        width: 640,
        height: 480,
      })
    ).toBe(false)
  })

  test("returns false when the terminal has no meaningful size", () => {
    expect(
      isTerminalRenderable({
        isConnected: true,
        display: "block",
        visibility: "visible",
        width: 1,
        height: 480,
      })
    ).toBe(false)

    expect(
      isTerminalRenderable({
        isConnected: true,
        display: "block",
        visibility: "visible",
        width: 640,
        height: 0,
      })
    ).toBe(false)
  })
})

describe("shouldRecoverTerminal", () => {
  const visibleRenderState = {
    isConnected: true,
    display: "block",
    visibility: "visible",
    width: 640,
    height: 480,
  } as const

  test("skips recovery while the document is hidden", () => {
    expect(shouldRecoverTerminal("hidden", visibleRenderState)).toBe(false)
  })

  test("allows recovery once the document is visible and the terminal is renderable", () => {
    expect(shouldRecoverTerminal("visible", visibleRenderState)).toBe(true)
  })
})
