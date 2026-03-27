import {
  createTextMessage,
  dedupeMessages,
  getSessionTitleFallback,
  preserveExistingMessageMetadata,
  remapMessagesToSession,
} from "../domain/runtimeMessages"
import type { MessageWithParts, RuntimeSession } from "../types"
import type { FileChangeEvent } from "./storeTypes"

export function emitFileChanges(
  listeners: Set<(event: FileChangeEvent) => void>,
  messages: MessageWithParts[]
): void {
  if (listeners.size === 0) {
    return
  }

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool" || part.tool !== "fileChange") {
        continue
      }

      const output = part.state.output
      const changes =
        output && typeof output === "object" && "changes" in output
          ? (output as { changes?: unknown[] }).changes
          : undefined

      if (!Array.isArray(changes)) {
        continue
      }

      for (const change of changes) {
        if (!change || typeof change !== "object") {
          continue
        }

        const path =
          "path" in change && typeof change.path === "string"
            ? change.path
            : "newPath" in change && typeof change.newPath === "string"
              ? change.newPath
              : null

        if (!path) {
          continue
        }

        for (const listener of listeners) {
          listener({
            file: path,
            event: "change",
          })
        }
      }
    }
  }
}

export function shouldRecreateRemoteSession(session: RuntimeSession, error: unknown): boolean {
  if (session.harnessId !== "codex") {
    return false
  }

  const message = String(error)
  return (
    message.includes("no rollout found for thread id") ||
    message.includes("failed to load rollout") ||
    (message.includes("rollout at") && message.includes("is empty"))
  )
}

export {
  createTextMessage,
  dedupeMessages,
  getSessionTitleFallback,
  preserveExistingMessageMetadata,
  remapMessagesToSession,
}
