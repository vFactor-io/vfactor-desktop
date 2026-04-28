import { app, type BrowserWindow } from "electron"
import {
  capture,
  captureException,
  flushAnalyticsWithTimeout,
} from "./analytics"

type CrashTelemetryContextProvider = () => Record<string, unknown>

const fatalProcessGoneReasons = new Set([
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure",
  "memory-eviction",
])

function getAppCrashProperties(): Record<string, unknown> {
  return {
    app_version: app.getVersion(),
    is_packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
  }
}

function shouldReportProcessGone(reason: string): boolean {
  return fatalProcessGoneReasons.has(reason)
}

function normalizeError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error
  }

  const normalizedError = new Error(fallbackMessage)
  normalizedError.name = typeof error === "string" ? "NonErrorThrow" : "UnknownError"
  normalizedError.cause = error
  return normalizedError
}

function flushCrashTelemetry(): void {
  void flushAnalyticsWithTimeout(1_500).catch((error) => {
    console.warn("[posthog] Failed to flush crash telemetry:", error)
  })
}

export function captureCrashTelemetry(
  event: string,
  error: unknown,
  properties: Record<string, unknown> = {},
): void {
  const normalizedError = normalizeError(error, event)
  const eventProperties = {
    ...getAppCrashProperties(),
    ...properties,
  }

  capture("app_crash_signal", {
    ...eventProperties,
    crash_event: event,
    error_name: normalizedError.name,
    error_message: normalizedError.message,
  })
  captureException(normalizedError, {
    ...eventProperties,
    context: event,
  })
  flushCrashTelemetry()
}

export function registerProcessCrashTelemetry(getContext: CrashTelemetryContextProvider): void {
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    captureCrashTelemetry("main_process_uncaught_exception", error, {
      ...getContext(),
      origin,
    })
  })

  process.on("unhandledRejection", (reason) => {
    captureCrashTelemetry("main_process_unhandled_rejection", reason, {
      ...getContext(),
    })
  })
}

export function registerElectronCrashTelemetry(getContext: CrashTelemetryContextProvider): void {
  app.on("child-process-gone", (_event, details) => {
    if (!shouldReportProcessGone(details.reason)) {
      return
    }

    captureCrashTelemetry(
      "electron_child_process_gone",
      new Error(`Electron child process ${details.type} exited: ${details.reason}`),
      {
        ...getContext(),
        process_type: details.type,
        reason: details.reason,
        exit_code: details.exitCode,
        service_name: details.serviceName ?? null,
        process_name: details.name ?? null,
      },
    )
  })
}

export function attachWindowCrashTelemetry(
  window: BrowserWindow,
  getContext: CrashTelemetryContextProvider,
): void {
  window.webContents.on("render-process-gone", (_event, details) => {
    if (!shouldReportProcessGone(details.reason)) {
      return
    }

    captureCrashTelemetry(
      "renderer_process_gone",
      new Error(`Renderer process exited: ${details.reason}`),
      {
        ...getContext(),
        window_id: window.id,
        reason: details.reason,
        exit_code: details.exitCode,
      },
    )
  })

  window.webContents.on("unresponsive", () => {
    captureCrashTelemetry(
      "renderer_window_unresponsive",
      new Error("Renderer window became unresponsive"),
      {
        ...getContext(),
        window_id: window.id,
      },
    )
  })

  window.webContents.on("responsive", () => {
    capture("renderer_window_responsive", {
      ...getAppCrashProperties(),
      ...getContext(),
      window_id: window.id,
    })
  })
}
