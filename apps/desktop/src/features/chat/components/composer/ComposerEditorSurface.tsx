import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from "react"
import type { EditorState, LexicalEditor } from "lexical"
import { SkillChipNode } from "../SkillChipNode"
import { ComposerEditorRefPlugin } from "./ComposerEditorRefPlugin"

interface ComposerEditorSurfaceProps {
  editorRef: MutableRefObject<LexicalEditor | null>
  initialConfig: {
    namespace: string
    nodes: typeof SkillChipNode[]
    onError: (error: Error) => void
    editorState: () => void
  }
  isStreaming: boolean
  onChange: (editorState: EditorState) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  placeholder: string
}

export function ComposerEditorSurface({
  editorRef,
  initialConfig,
  isStreaming,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  placeholder,
}: ComposerEditorSurfaceProps) {
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ComposerEditorRefPlugin editorRef={editorRef} isStreaming={isStreaming} />
      <OnChangePlugin onChange={onChange} />
      <HistoryPlugin />
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            onKeyDown={onKeyDown}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            aria-placeholder={placeholder}
            placeholder={<></>}
            className="app-scrollbar w-full min-h-[46px] max-h-[328px] overflow-y-auto bg-transparent text-sm leading-5 text-foreground outline-none"
          />
        }
        placeholder={
          <div className="pointer-events-none absolute top-[14px] left-4 text-sm leading-5 text-muted-foreground/75">
            {placeholder}
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
    </LexicalComposer>
  )
}
