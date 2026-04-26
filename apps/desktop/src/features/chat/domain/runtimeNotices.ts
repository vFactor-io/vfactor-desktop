import type { MessageWithParts, RuntimeNotice } from "../types"

export function createRuntimeNoticeMessage(
  sessionId: string,
  turnId: string,
  notice: RuntimeNotice
): MessageWithParts {
  const createdAt = notice.createdAt ?? notice.updatedAt ?? Date.now()

  return {
    info: {
      id: `runtime-notice:${notice.id}`,
      sessionId,
      role: "assistant",
      createdAt,
      itemType: "providerNotice",
      phase: "runtime",
      turnId,
      runtimeNotice: notice,
    },
    parts: [
      {
        id: `runtime-notice:${notice.id}:text`,
        type: "text",
        text: notice.message,
      },
    ],
  }
}

export function createRuntimeNoticeMessages(
  sessionId: string,
  turnId: string,
  notices: RuntimeNotice[] | undefined
): MessageWithParts[] {
  return (notices ?? []).map((notice) => createRuntimeNoticeMessage(sessionId, turnId, notice))
}
