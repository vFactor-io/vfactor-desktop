import { useEffect, useRef } from "react"
import { DiffEditor } from "@monaco-editor/react"
import type { editor } from "monaco-editor"
import { getLanguageFromFilename } from "../utils/language"
import { registerMonacoThemes, useAppearance } from "@/features/shared/appearance"

interface DiffViewerProps {
  filename: string
  original: string
  modified: string
  modelKey?: string
  renderSideBySide?: boolean
  fontSize?: number
  paddingTop?: number
}

export function DiffViewer({
  filename,
  original,
  modified,
  modelKey,
  renderSideBySide = true,
  fontSize = 13,
  paddingTop = 16,
}: DiffViewerProps) {
  const language = getLanguageFromFilename(filename)
  const { monacoThemeId } = useAppearance()
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const effectiveModelKey = modelKey ?? filename

  useEffect(() => {
    return () => {
      const diffEditor = editorRef.current
      if (!diffEditor) {
        return
      }

      const model = diffEditor.getModel()
      diffEditor.setModel(null)
      model?.original.dispose()
      model?.modified.dispose()
      editorRef.current = null
    }
  }, [])

  return (
    <DiffEditor
      height="100%"
      language={language}
      original={original}
      modified={modified}
      originalModelPath={`inmemory://diff/${encodeURIComponent(effectiveModelKey)}.original`}
      modifiedModelPath={`inmemory://diff/${encodeURIComponent(effectiveModelKey)}.modified`}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      theme={monacoThemeId}
      beforeMount={(monaco) => {
        registerMonacoThemes(monaco)
      }}
      onMount={(editorInstance) => {
        editorRef.current = editorInstance
      }}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        padding: { top: paddingTop },
        renderSideBySide,
      }}
    />
  )
}
