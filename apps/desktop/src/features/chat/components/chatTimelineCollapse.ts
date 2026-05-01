import type { MessageWithParts } from "../types"
import { getMessageTextContent } from "../domain/runtimeMessages"

function getMessageText(message: MessageWithParts): string {
  return getMessageTextContent(message.parts)
}

function hasRenderableMessageContent(message: MessageWithParts): boolean {
  return message.parts.some((part) =>
    part.type === "tool" ||
    part.type === "attachment" ||
    (part.type === "text" && part.text.trim().length > 0)
  )
}

function isAssistantWorkMessage(message: MessageWithParts): boolean {
  return message.info.role === "assistant" && message.info.itemType !== "providerNotice"
}

function isAssistantResponseMessage(message: MessageWithParts): boolean {
  return message.info.role === "assistant" && message.info.itemType === "agentMessage"
}

function getFooterAnchorMessage(messages: MessageWithParts[]): MessageWithParts | null {
  return (
    [...messages].reverse().find(isAssistantResponseMessage) ??
    [...messages].reverse().find(isAssistantWorkMessage) ??
    null
  )
}

function dedupeMessagesByLastId(messages: MessageWithParts[]): MessageWithParts[] {
  const lastIndexById = new Map<string, number>()

  messages.forEach((message, index) => {
    lastIndexById.set(message.info.id, index)
  })

  return messages.filter((message, index) => lastIndexById.get(message.info.id) === index)
}

export function getTurnCollapsedMessagesByFooterId(
  messages: MessageWithParts[],
  status: "idle" | "connecting" | "streaming" | "error"
): Map<string, MessageWithParts[]> {
  const collapsedMessagesByFooterId = new Map<string, MessageWithParts[]>()
  const dedupedMessages = dedupeMessagesByLastId(messages)

  if (dedupedMessages.length === 0) {
    return collapsedMessagesByFooterId
  }

  let turnStartIndex = 0

  const processTurn = (turnEndIndex: number) => {
    if (turnEndIndex < turnStartIndex) {
      return
    }

    const turnMessages = dedupedMessages.slice(turnStartIndex, turnEndIndex + 1)
    const footerMessage = getFooterAnchorMessage(turnMessages)
    if (!footerMessage || !getMessageText(footerMessage).trim()) {
      return
    }

    if (status === "streaming" && turnEndIndex === dedupedMessages.length - 1) {
      return
    }

    const collapsedMessages = turnMessages.filter(
      (message) =>
        isAssistantWorkMessage(message) &&
        message.info.id !== footerMessage.info.id &&
        hasRenderableMessageContent(message)
    )

    if (collapsedMessages.length === 0) {
      return
    }

    collapsedMessagesByFooterId.set(footerMessage.info.id, collapsedMessages)
  }

  for (let index = 0; index < dedupedMessages.length; index++) {
    if (dedupedMessages[index]?.info.role !== "user") {
      continue
    }

    processTurn(index - 1)
    turnStartIndex = index + 1
  }

  processTurn(dedupedMessages.length - 1)

  return collapsedMessagesByFooterId
}
