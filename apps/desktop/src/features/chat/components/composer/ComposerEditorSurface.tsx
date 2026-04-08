import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from "react"
import type { EditorState, Klass, LexicalEditor, LexicalNode } from "lexical"
import { ComposerEditorRefPlugin } from "./ComposerEditorRefPlugin"

interface ComposerEditorSurfaceProps {
  editorRef: MutableRefObject<LexicalEditor | null>
  initialConfig: {
    namespace: string
    nodes: Array<Klass<LexicalNode>>
    onError: (error: Error) => void
    editorState: () => void
  }
  isLocked: boolean
  isStreaming: boolean
  onChange: (editorState: EditorState) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onPaste?: (event: ReactClipboardEvent<HTMLDivElement>) => void
  onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder: string
}

export function ComposerEditorSurface({
  editorRef,
  initialConfig,
  isStreaming,
  onChange,
  onKeyDown,
  onPaste,
  onDragOver,
  onDrop,
  onCompositionStart,
  onCompositionEnd,
  onFocus,
  onBlur,
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
            onPaste={onPaste}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onFocus={onFocus}
            onBlur={onBlur}
            aria-placeholder={placeholder}
            placeholder={<></>}
            className="app-scrollbar w-full min-h-[58px] max-h-[328px] overflow-y-auto bg-transparent text-sm leading-5 text-foreground outline-none"
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
