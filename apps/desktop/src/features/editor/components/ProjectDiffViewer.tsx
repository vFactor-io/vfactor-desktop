import { useEffect, useState } from "react"
import { desktop, type GitFileDiff } from "@/desktop/client"
import { DiffViewer } from "./DiffViewer"

interface ProjectDiffViewerProps {
  filename: string
  projectPath?: string | null
  filePath?: string
  previousFilePath?: string | null
}

export function ProjectDiffViewer({
  filename,
  projectPath,
  filePath,
  previousFilePath,
}: ProjectDiffViewerProps) {
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [showLoading, setShowLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let loadingTimeout: ReturnType<typeof setTimeout> | null = null
    let isCancelled = false

    async function loadDiff() {
      if (!projectPath || !filePath) {
        setDiff(null)
        setError("No diff path available for this file.")
        return
      }

      setDiff(null)
      setError(null)

      loadingTimeout = setTimeout(() => {
        if (!isCancelled) {
          setShowLoading(true)
        }
      }, 150)

      try {
        const nextDiff = await desktop.git.getFileDiff(projectPath, filePath, previousFilePath)
        if (!isCancelled) {
          setDiff(nextDiff)
        }
      } catch (err) {
        console.error("Failed to load file diff:", err)
        if (!isCancelled) {
          setError(`Failed to load diff for: ${filePath}`)
        }
      } finally {
        if (loadingTimeout) {
          clearTimeout(loadingTimeout)
        }

        if (!isCancelled) {
          setShowLoading(false)
        }
      }
    }

    void loadDiff()

    return () => {
      isCancelled = true
      if (loadingTimeout) {
        clearTimeout(loadingTimeout)
      }
    }
  }, [filePath, previousFilePath, projectPath])

  if (showLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading diff...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        {error}
      </div>
    )
  }

  if (!diff) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Diff not available
      </div>
    )
  }

  return (
    <DiffViewer
      filename={filename}
      original={diff.original}
      modified={diff.modified}
    />
  )
}
