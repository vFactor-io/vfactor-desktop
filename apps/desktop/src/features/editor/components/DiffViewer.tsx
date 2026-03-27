import { DiffEditor } from "@monaco-editor/react"
import { getLanguageFromFilename } from "../utils/language"
import { useTheme } from "@/features/shared/hooks"

interface DiffViewerProps {
  filename: string
  original: string
  modified: string
}

export function DiffViewer({ filename, original, modified }: DiffViewerProps) {
  const language = getLanguageFromFilename(filename)
  const theme = useTheme()

  return (
    <DiffEditor
      height="100%"
      language={language}
      original={original}
      modified={modified}
      theme={theme}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        padding: { top: 16 },
        renderSideBySide: true,
      }}
    />
  )
}
