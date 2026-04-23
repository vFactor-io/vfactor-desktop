import { useEffect, useMemo, useState } from "react"
import { File as PierreFile, WorkerPoolContextProvider } from "@pierre/diffs/react"
import PierreDiffWorker from "@pierre/diffs/worker/worker-portable.js?worker"
import { registerCustomCSSVariableTheme } from "@pierre/diffs"
import { desktop } from "@/desktop/client"
import { useAppearance } from "@/features/shared/appearance"

interface FilePreviewPanelProps {
  fileName: string
  filePath: string
  projectPath?: string | null
}

const FILE_PREVIEW_THEME_NAME = "nucleus-file-preview"

let filePreviewThemeRegistered = false

function ensureFilePreviewThemeRegistered() {
  if (filePreviewThemeRegistered) {
    return
  }

  registerCustomCSSVariableTheme(FILE_PREVIEW_THEME_NAME, {
    foreground: "var(--sidebar-foreground)",
    background: "var(--sidebar)",
    "token-constant": "var(--sidebar-foreground)",
    "token-string": "var(--color-vcs-added)",
    "token-comment": "var(--muted-foreground)",
    "token-keyword": "var(--primary)",
    "token-parameter": "var(--sidebar-foreground)",
    "token-function": "var(--color-vcs-renamed)",
    "token-string-expression": "var(--color-vcs-added)",
    "token-punctuation": "var(--sidebar-foreground)",
    "token-link": "var(--primary)",
  })

  filePreviewThemeRegistered = true
}

ensureFilePreviewThemeRegistered()

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/")
}

function getRelativePath(filePath: string, projectPath: string | null | undefined): string {
  if (!projectPath) {
    return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath
  }

  const normalizedFilePath = normalizePath(filePath)
  const normalizedProjectPath = normalizePath(projectPath).replace(/\/+$/, "")

  if (normalizedFilePath === normalizedProjectPath) {
    return normalizedFilePath.split("/").filter(Boolean).at(-1) ?? normalizedFilePath
  }

  const prefix = `${normalizedProjectPath}/`
  if (normalizedFilePath.startsWith(prefix)) {
    return normalizedFilePath.slice(prefix.length)
  }

  return normalizedFilePath.split("/").filter(Boolean).at(-1) ?? normalizedFilePath
}

export function FilePreviewPanel({
  fileName,
  filePath,
  projectPath,
}: FilePreviewPanelProps) {
  const [content, setContent] = useState("")
  const [showLoading, setShowLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { resolvedAppearance } = useAppearance()

  const relativePath = useMemo(
    () => getRelativePath(filePath, projectPath),
    [filePath, projectPath]
  )

  useEffect(() => {
    let cancelled = false
    let loadingTimeout: ReturnType<typeof setTimeout> | null = null

    async function loadFile() {
      setError(null)

      loadingTimeout = setTimeout(() => {
        if (!cancelled) {
          setShowLoading(true)
        }
      }, 120)

      try {
        const nextContent = await desktop.fs.readTextFile(filePath)
        if (!cancelled) {
          setContent(nextContent)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError("This file couldn’t be previewed here.")
          setContent("")
        }
      } finally {
        if (loadingTimeout) {
          clearTimeout(loadingTimeout)
        }
        if (!cancelled) {
          setShowLoading(false)
        }
      }
    }

    void loadFile()

    return () => {
      cancelled = true
      if (loadingTimeout) {
        clearTimeout(loadingTimeout)
      }
    }
  }, [filePath])

  if (showLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading file...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="app-scrollbar-sm min-h-0 flex-1 overflow-auto">
        <WorkerPoolContextProvider
          key={resolvedAppearance}
          poolOptions={{
            workerFactory: () => new PierreDiffWorker(),
            poolSize: 1,
          }}
          highlighterOptions={{
            theme: FILE_PREVIEW_THEME_NAME,
          }}
        >
          <PierreFile
            file={{
              name: relativePath || fileName,
              contents: content,
              cacheKey: `${filePath}:${content.length}:${content.slice(0, 64)}`,
            }}
            options={{
              theme: FILE_PREVIEW_THEME_NAME,
              themeType: resolvedAppearance,
              overflow: "scroll",
              disableFileHeader: false,
              unsafeCSS: `
                :host {
                  color-scheme: ${resolvedAppearance};
                  --diffs-header-font-family: var(--font-sans);
                  --diffs-font-size: 12px;
                  --diffs-line-height: 1.4;
                  --bg: var(--sidebar);
                  --fg: var(--sidebar-foreground);
                  --diffs-light-bg: var(--sidebar);
                  --diffs-dark-bg: var(--sidebar);
                  --diffs-light: var(--sidebar-foreground);
                  --diffs-dark: var(--sidebar-foreground);
                  --diffs-fg-number-override: color-mix(in oklab, var(--sidebar-foreground) 62%, var(--sidebar) 38%);
                  --diffs-bg-buffer-override: color-mix(in oklab, var(--sidebar) 96%, var(--sidebar-foreground) 4%);
                  --diffs-bg-hover-override: var(--sidebar-item-hover);
                  --diffs-bg-context-override: color-mix(in oklab, var(--sidebar) 94%, var(--sidebar-foreground) 6%);
                  --diffs-bg-context-number-override: color-mix(in oklab, var(--sidebar) 88%, var(--sidebar-foreground) 12%);
                  --diffs-bg-separator-override: color-mix(in oklab, var(--sidebar) 90%, var(--border) 10%);
                }

                [data-file],
                [data-diff] {
                  border-radius: 0 !important;
                  background: var(--sidebar) !important;
                  box-shadow: none !important;
                  border: 0 !important;
                }

                [data-file] [data-header] {
                  border-bottom-color: color-mix(in oklab, var(--color-border) 80%, transparent) !important;
                  background: color-mix(in oklab, var(--sidebar) 94%, var(--sidebar-foreground) 6%) !important;
                  padding-inline: 0 !important;
                  min-height: 34px !important;
                }

                [data-file-info] {
                  color: var(--sidebar-foreground) !important;
                  background: color-mix(in oklab, var(--sidebar) 94%, var(--sidebar-foreground) 6%) !important;
                  border-block-color: color-mix(in oklab, var(--sidebar-foreground) 12%, var(--sidebar) 88%) !important;
                }

                [data-title],
                [data-header-content],
                [data-change-icon='file'] {
                  color: var(--sidebar-foreground) !important;
                }

                pre,
                code,
                [data-code],
                [data-gutter],
                [data-content],
                [data-column-number],
                [data-separator],
                [data-content-buffer],
                [data-gutter-buffer] {
                  background-color: var(--sidebar) !important;
                }

                [data-code] {
                  padding-top: 0 !important;
                  padding-bottom: 6px !important;
                }

                [data-line] span {
                  background-color: inherit !important;
                }

                pre,
                code {
                  font-family: var(--font-mono, ui-monospace, monospace) !important;
                }
              `,
            }}
          />
        </WorkerPoolContextProvider>
      </div>
    </div>
  )
}
