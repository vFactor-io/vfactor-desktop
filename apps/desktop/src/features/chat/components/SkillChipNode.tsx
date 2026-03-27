import type { ReactElement } from "react"
import { BookOpen } from "@/components/icons"
import {
  $create,
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"

export type SerializedSkillChipNode = Spread<
  {
    label: string
    referenceName: string
    type: "skill-chip"
    version: 1
  },
  SerializedLexicalNode
>

function SkillChip({
  label,
  referenceName,
}: {
  label: string
  referenceName: string
}): ReactElement {
  return (
    <span
      data-skill-chip="true"
      data-skill-reference={referenceName}
      className="inline-flex items-center gap-1 rounded-md bg-skill-surface px-2 py-0.5 text-[13px] leading-5 font-medium text-skill-accent"
    >
      <BookOpen className="size-3.5 text-skill-icon" />
      <span>{label}</span>
    </span>
  )
}

export class SkillChipNode extends DecoratorNode<ReactElement> {
  __label: string
  __referenceName: string

  static getType(): string {
    return "skill-chip"
  }

  static clone(node: SkillChipNode): SkillChipNode {
    return new SkillChipNode(node.__label, node.__referenceName, node.__key)
  }

  static importJSON(serializedNode: SerializedSkillChipNode): SkillChipNode {
    return $createSkillChipNode(
      serializedNode.referenceName,
      serializedNode.label
    )
  }

  constructor(label = "", referenceName = "", key?: NodeKey) {
    super(key)
    this.__label = label
    this.__referenceName = referenceName
  }

  createDOM(): HTMLElement {
    const dom = document.createElement("span")
    dom.className = "inline-block align-middle"
    return dom
  }

  updateDOM(): false {
    return false
  }

  exportJSON(): SerializedSkillChipNode {
    return {
      ...super.exportJSON(),
      label: this.getLabel(),
      referenceName: this.getReferenceName(),
      type: "skill-chip",
      version: 1,
    }
  }

  getTextContent(): string {
    return this.getLabel()
  }

  isInline(): true {
    return true
  }

  isIsolated(): true {
    return true
  }

  isKeyboardSelectable(): false {
    return false
  }

  decorate(_editor: unknown, _config: EditorConfig): ReactElement {
    return (
      <SkillChip
        label={this.getLabel()}
        referenceName={this.getReferenceName()}
      />
    )
  }

  getLabel(): string {
    return this.getLatest().__label
  }

  getReferenceName(): string {
    return this.getLatest().__referenceName
  }

  setLabel(label: string): this {
    const writable = this.getWritable()
    writable.__label = label
    return writable
  }

  setReferenceName(referenceName: string): this {
    const writable = this.getWritable()
    writable.__referenceName = referenceName
    return writable
  }
}

export function $createSkillChipNode(referenceName: string, label: string): SkillChipNode {
  const node = $create(SkillChipNode)
  const writableNode = node.getWritable() as SkillChipNode
  writableNode.__label = label
  writableNode.__referenceName = referenceName
  return $applyNodeReplacement(node)
}

export function $isSkillChipNode(node: LexicalNode | null | undefined): node is SkillChipNode {
  return node instanceof SkillChipNode
}
