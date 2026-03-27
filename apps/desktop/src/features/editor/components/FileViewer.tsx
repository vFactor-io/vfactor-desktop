import { useState, useEffect } from "react"
import Editor from "@monaco-editor/react"
import { desktop } from "@/desktop/client"
import { getLanguageFromFilename } from "../utils/language"
import { useTheme } from "@/features/shared/hooks"

interface FileViewerProps {
  filename: string
  filePath?: string
}

export function FileViewer({ filename, filePath }: FileViewerProps) {
  const [content, setContent] = useState<string>("")
  const [showLoading, setShowLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const language = getLanguageFromFilename(filename)
  const theme = useTheme()

  useEffect(() => {
    let loadingTimeout: ReturnType<typeof setTimeout> | null = null
    let isCancelled = false

    async function loadFile() {
      if (!filePath) {
        setContent(`// No file path provided for: ${filename}`)
        return
      }

      setError(null)

      // Only show loading indicator if file takes longer than 150ms
      loadingTimeout = setTimeout(() => {
        if (!isCancelled) setShowLoading(true)
      }, 150)

      try {
        const fileContent = await desktop.fs.readTextFile(filePath)
        if (!isCancelled) setContent(fileContent)
      } catch (err) {
        console.error("Failed to read file:", err)
        if (!isCancelled) {
          setError(`Failed to read file: ${filePath}`)
          setContent("")
        }
      } finally {
        if (loadingTimeout) clearTimeout(loadingTimeout)
        if (!isCancelled) setShowLoading(false)
      }
    }

    loadFile()

    return () => {
      isCancelled = true
      if (loadingTimeout) clearTimeout(loadingTimeout)
    }
  }, [filePath, filename])

  if (showLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading file...
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-destructive">
        {error}
      </div>
    )
  }

  return (
    <Editor
      height="100%"
      language={language}
      value={content}
      theme={theme}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        padding: { top: 16 },
      }}
    />
  )
}
