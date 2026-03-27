import { $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot, $isElementNode, $isLineBreakNode, $isTextNode, type LexicalNode } from "lexical"
import type { NormalizedCommand } from "../../hooks/useCommands"
import { $createSkillChipNode, $isSkillChipNode } from "../SkillChipNode"

export const SKILL_REFERENCE_PATTERN = /\$([a-z0-9][a-z0-9-]*)/gi

function appendTextNodesToParagraph(
  text: string,
  paragraph: ReturnType<typeof $createParagraphNode>
) {
  const segments = text.split("\n")

  segments.forEach((segment, index) => {
    if (segment.length > 0) {
      paragraph.append($createTextNode(segment))
    }

    if (index < segments.length - 1) {
      paragraph.append($createLineBreakNode())
    }
  })
}

export function populateComposerFromSerializedValue(
  value: string,
  commandsByReference: Map<string, NormalizedCommand>
) {
  const root = $getRoot()
  const paragraph = $createParagraphNode()
  let lastIndex = 0

  root.clear()

  for (const match of value.matchAll(SKILL_REFERENCE_PATTERN)) {
    const fullMatch = match[0]
    const rawReference = match[1]
    const matchIndex = match.index ?? -1
    const referenceName = rawReference.toLowerCase()
    const command = commandsByReference.get(referenceName)

    if (matchIndex < 0) {
      continue
    }

    const textBefore = value.slice(lastIndex, matchIndex)
    if (textBefore.length > 0) {
      appendTextNodesToParagraph(textBefore, paragraph)
    }

    if (command?.referenceName) {
      paragraph.append($createSkillChipNode(command.referenceName, command.name))
    } else {
      appendTextNodesToParagraph(fullMatch, paragraph)
    }

    lastIndex = matchIndex + fullMatch.length
  }

  const remainingText = value.slice(lastIndex)
  if (remainingText.length > 0) {
    appendTextNodesToParagraph(remainingText, paragraph)
  }

  root.append(paragraph)
  root.selectEnd()
}

function serializeComposerNode(node: LexicalNode): string {
  if ($isSkillChipNode(node)) {
    return `$${node.getReferenceName()}`
  }

  if ($isLineBreakNode(node)) {
    return "\n"
  }

  if ($isTextNode(node)) {
    return node.getTextContent()
  }

  if ($isElementNode(node)) {
    return node.getChildren().map((child) => serializeComposerNode(child)).join("")
  }

  return ""
}

export function serializeComposerState(): string {
  return $getRoot()
    .getChildren()
    .map((child) => serializeComposerNode(child))
    .join("\n")
}
