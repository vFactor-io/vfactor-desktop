import {
  createActiveRuntimePromptState,
  normalizeRuntimePrompt,
} from "../domain/runtimePrompts"
import type { RuntimePrompt, RuntimePromptResponse, RuntimePromptState } from "../types"

export function createPromptState(prompt: RuntimePrompt): RuntimePromptState {
  return createActiveRuntimePromptState(prompt)
}

export function createAnsweredPromptState(
  prompt: RuntimePrompt,
  response: RuntimePromptResponse
): RuntimePromptState {
  const now = Date.now()

  return {
    prompt,
    status: "answered",
    createdAt: now,
    updatedAt: now,
    response,
  }
}

export function createDismissedPromptState(prompt: RuntimePrompt): RuntimePromptState {
  const now = Date.now()

  return {
    prompt,
    status: "dismissed",
    createdAt: now,
    updatedAt: now,
  }
}

export function getNormalizedPromptState(prompt: RuntimePrompt | null | undefined): RuntimePromptState | null {
  const normalizedPrompt = normalizeRuntimePrompt(prompt)
  if (!normalizedPrompt) {
    return null
  }

  return createPromptState(normalizedPrompt)
}
