import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const flushMock = mock(async () => {})
const shutdownMock = mock(async (_timeoutMs?: number) => {})
const captureMock = mock(() => {})
const captureExceptionMock = mock(() => {})
const consoleWarnMock = mock(() => {})
const originalConsoleWarn = console.warn

mock.module("posthog-node", () => ({
  PostHog: class {
    capture = captureMock
    captureException = captureExceptionMock
    flush = flushMock
    shutdown = shutdownMock
  },
}))

const { flushAnalyticsWithTimeout, initAnalytics } = await import("./analytics")

describe("analytics", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "test-key"
    process.env.POSTHOG_ENABLED = "true"
    flushMock.mockReset()
    flushMock.mockImplementation(async () => {})
    shutdownMock.mockReset()
    captureMock.mockReset()
    captureExceptionMock.mockReset()
    consoleWarnMock.mockReset()
    console.warn = consoleWarnMock as typeof console.warn
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    initAnalytics("disabled")
    console.warn = originalConsoleWarn
  })

  test("flushAnalyticsWithTimeout propagates flush failures before the timeout", async () => {
    const error = new Error("flush failed")
    flushMock.mockImplementationOnce(async () => {
      throw error
    })
    initAnalytics("device-1")

    await expect(flushAnalyticsWithTimeout(100)).rejects.toBe(error)
  })

  test("flushAnalyticsWithTimeout suppresses flush failures after the timeout wins", async () => {
    let rejectFlush: (error: Error) => void = () => {}
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason)
    }

    flushMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFlush = reject
        }),
    )
    initAnalytics("device-1")
    process.on("unhandledRejection", onUnhandledRejection)

    try {
      await flushAnalyticsWithTimeout(1)
      rejectFlush(new Error("late flush failure"))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(unhandledRejections).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandledRejection)
    }
  })
})
