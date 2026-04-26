import {
  capture,
  captureException,
  flushAnalytics,
} from "../analytics"
import type { HarnessId, RuntimeSession } from "@/features/chat/types"

type RuntimeTelemetryPhase =
  | "runtime.list_models"
  | "runtime.send_turn"
  | "runtime.answer_prompt"
  | "runtime.interrupt_turn"
  | "codex.thread_ready"
  | "codex.turn_start"
  | "claude.session_ready"
  | "claude.message_send"
  | "opencode.client"
  | "opencode.event_stream"
  | "opencode.session_prompt"

interface RuntimeTelemetryInput {
  harnessId: HarnessId
  phase: RuntimeTelemetryPhase
  session?: RuntimeSession | null
  model?: string | null
  runtimeMode?: string | null
  durationMs?: number
  extra?: Record<string, unknown>
}

function getErrorField(error: unknown, key: string): unknown {
  return error && typeof error === "object" && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return String(error)
}

function getCause(error: unknown): unknown {
  return getErrorField(error, "cause")
}

function getErrorCode(error: unknown): string | null {
  const code = getErrorField(error, "code")
  return typeof code === "string" || typeof code === "number" ? String(code) : null
}

function normalizeError(error: unknown): Record<string, unknown> {
  const cause = getCause(error)
  const response = getErrorField(error, "response")
  const status = getErrorField(error, "status") ?? getErrorField(response, "status")

  return {
    error_name: error instanceof Error ? error.name : typeof error,
    error_message: getErrorMessage(error),
    error_code: getErrorCode(error),
    error_cause_name: cause instanceof Error ? cause.name : cause ? typeof cause : null,
    error_cause_message: cause ? getErrorMessage(cause) : null,
    error_cause_code: getErrorCode(cause),
    error_status: typeof status === "string" || typeof status === "number" ? String(status) : null,
  }
}

function splitModel(model: string | null | undefined): {
  model_provider: string | null
  model_id: string | null
} {
  const trimmed = model?.trim()
  if (!trimmed) {
    return {
      model_provider: null,
      model_id: null,
    }
  }

  const separatorIndex = trimmed.indexOf("/")
  if (separatorIndex === -1) {
    return {
      model_provider: null,
      model_id: trimmed,
    }
  }

  return {
    model_provider: trimmed.slice(0, separatorIndex),
    model_id: trimmed.slice(separatorIndex + 1),
  }
}

function buildProperties(input: RuntimeTelemetryInput): Record<string, unknown> {
  const model = splitModel(input.model ?? input.session?.model ?? null)

  return {
    harness_id: input.harnessId,
    phase: input.phase,
    runtime_mode: input.runtimeMode ?? input.session?.runtimeMode ?? null,
    has_session_id: Boolean(input.session?.id),
    has_remote_id: Boolean(input.session?.remoteId),
    has_project_path: Boolean(input.session?.projectPath),
    duration_ms: input.durationMs,
    ...model,
    ...input.extra,
  }
}

function logRuntimeError(
  event: "runtime_operation_failed" | "provider_operation_failed",
  properties: Record<string, unknown>
): void {
  console.error(`[runtime] ${event}`, properties)
}

function flushRuntimeError(): void {
  void flushAnalytics().catch((error) => {
    console.warn("[posthog] Failed to flush runtime error telemetry:", error)
  })
}

export function captureRuntimeEvent(
  event: "runtime_operation_started" | "runtime_operation_completed",
  input: RuntimeTelemetryInput
): void {
  capture(event, buildProperties(input))
}

export function captureRuntimeError(
  event: "runtime_operation_failed" | "provider_operation_failed",
  error: unknown,
  input: RuntimeTelemetryInput
): void {
  const properties = {
    ...buildProperties(input),
    ...normalizeError(error),
  }

  logRuntimeError(event, properties)
  capture(event, properties)
  capture("chat_runtime_error", {
    ...properties,
    source_event: event,
  })
  captureException(error, properties)
  flushRuntimeError()
}
