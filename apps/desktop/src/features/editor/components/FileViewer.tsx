import { useState, useEffect } from "react"
import Editor from "@monaco-editor/react"
import { desktop } from "@/desktop/client"
import { getLanguageFromFilename } from "../utils/language"
import { registerMonacoThemes, useAppearance } from "@/features/shared/appearance"

interface FileViewerProps {
  filename: string
  filePath?: string
}

const IMAGE_EXTENSIONS = new Set(["avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"])

function isImageFile(filename: string): boolean {
  const extension = filename.split(".").pop()?.toLowerCase()
  return extension ? IMAGE_EXTENSIONS.has(extension) : false
}

export function FileViewer({ filename, filePath }: FileViewerProps) {
  const [content, setContent] = useState<string>("")
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [showLoading, setShowLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isImage = isImageFile(filename)
  const language = getLanguageFromFilename(filename)
  const { monacoThemeId, textSizePx } = useAppearance()

  useEffect(() => {
    let loadingTimeout: ReturnType<typeof setTimeout> | null = null
    let isCancelled = false

    async function loadFile() {
      if (!filePath) {
        setContent(`// No file path provided for: ${filename}`)
        setImageDataUrl(null)
        return
      }

      setError(null)
      setContent("")
      setImageDataUrl(null)

      // Only show loading indicator if file takes longer than 150ms
      loadingTimeout = setTimeout(() => {
        if (!isCancelled) setShowLoading(true)
      }, 150)

      try {
        if (isImage) {
          const dataUrl = await desktop.fs.readFileAsDataUrl(filePath)
          if (!isCancelled) setImageDataUrl(dataUrl)
        } else {
          const fileContent = await desktop.fs.readTextFile(filePath)
          if (!isCancelled) setContent(fileContent)
        }
      } catch (err) {
        console.error("Failed to read file:", err)
        if (!isCancelled) {
          setError(`Failed to read file: ${filePath}`)
          setContent("")
          setImageDataUrl(null)
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
  }, [filePath, filename, isImage])

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

  if (isImage && filePath) {
    return (
      <div className="h-full overflow-auto bg-background p-6">
        {imageDataUrl ? (
          <div className="flex min-h-full items-center justify-center">
            <img
              src={imageDataUrl}
              alt={filename}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <Editor
      height="100%"
      language={language}
      value={content}
      theme={monacoThemeId}
      beforeMount={(monaco) => {
        registerMonacoThemes(monaco)
      }}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: textSizePx,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        padding: { top: 16 },
      }}
    />
  )
}
