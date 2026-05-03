import { useEffect, useMemo, useState } from "react"
import {
  ArrowSquareOut,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
  InformationCircle,
} from "@/components/icons"
import { desktop } from "@/desktop/client"
import { Button } from "@/features/shared/components/ui/button"
import { RightSidebarEmptyState } from "@/features/shared/components/layout/RightSidebarEmptyState"
import { SidebarShell } from "@/features/shared/components/layout/SidebarShell"
import { useRightSidebar } from "@/features/shared/components/layout/useRightSidebar"
import { useArtifactStore, useLocalChatStore } from "../store"
import type { ArtifactItem } from "../types"
import { cn } from "@/lib/utils"

function formatBytes(value?: number): string | null {
  if (value == null) {
    return null
  }

  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} KB`
  }

  return `${Math.round(value / 1024 / 102.4) / 10} MB`
}

function getArtifactIcon(artifact: ArtifactItem) {
  if (artifact.isDirectory) return Folder
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(artifact.name)) return FileImage
  if (/\.(md|txt|json|csv|log)$/i.test(artifact.name)) return FileText
  if (/\.(tsx?|jsx?|css|html|py|rs|go|rb|php|java|c|cpp|cs)$/i.test(artifact.name)) return FileCode
  return File
}

function isPreviewableText(artifact: ArtifactItem): boolean {
  return /\.(md|txt|json|csv|log|css|html|tsx?|jsx?|py|rs|go)$/i.test(artifact.name)
}

function isPreviewableImage(artifact: ArtifactItem): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(artifact.name)
}

function ArtifactPreview({ artifact }: { artifact: ArtifactItem | null }) {
  const [preview, setPreview] = useState<{ kind: "text" | "image"; value: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setError(null)

    if (!artifact || artifact.isDirectory) {
      return
    }

    if (isPreviewableImage(artifact)) {
      void desktop.fs.readFileAsDataUrl(artifact.path).then((dataUrl) => {
        if (!cancelled) {
          setPreview({ kind: "image", value: dataUrl })
        }
      }).catch((readError) => {
        if (!cancelled) {
          setError(readError instanceof Error ? readError.message : "Could not preview image.")
        }
      })
      return () => {
        cancelled = true
      }
    }

    if (isPreviewableText(artifact) && (artifact.sizeBytes ?? 0) <= 256_000) {
      void desktop.fs.readTextFile(artifact.path).then((text) => {
        if (!cancelled) {
          setPreview({ kind: "text", value: text })
        }
      }).catch((readError) => {
        if (!cancelled) {
          setError(readError instanceof Error ? readError.message : "Could not preview file.")
        }
      })
    }

    return () => {
      cancelled = true
    }
  }, [artifact])

  if (!artifact) {
    return null
  }

  if (error) {
    return <div className="px-3 py-2 text-xs text-destructive">{error}</div>
  }

  if (!preview) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {artifact.isDirectory ? "Folder preview is not available yet." : "Preview is not available for this file."}
      </div>
    )
  }

  if (preview.kind === "image") {
    return (
      <div className="min-h-0 overflow-auto p-3">
        <img src={preview.value} alt={artifact.name} className="max-h-80 w-full rounded-md object-contain" />
      </div>
    )
  }

  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-5 text-sidebar-foreground/78">
      {preview.value}
    </pre>
  )
}

export function WorkbenchSidebar() {
  const { activeThreadId, threads } = useLocalChatStore()
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads]
  )
  const {
    artifactsByThreadId,
    loadingByThreadId,
    errorByThreadId,
    initializeThreadArtifacts,
    clearActiveThread,
  } = useArtifactStore()
  const { isCollapsed, width, clampWidth, setWidth, persistWidth } = useRightSidebar()
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      void clearActiveThread()
    }
  }, [clearActiveThread])

  useEffect(() => {
    if (!activeThread) {
      setSelectedArtifactPath(null)
      void clearActiveThread()
      return
    }

    void initializeThreadArtifacts(activeThread.id, activeThread.artifactsPath)
  }, [activeThread, clearActiveThread, initializeThreadArtifacts])

  const artifacts = activeThread ? artifactsByThreadId[activeThread.id] ?? [] : []
  const isLoading = activeThread ? loadingByThreadId[activeThread.id] ?? false : false
  const error = activeThread ? errorByThreadId[activeThread.id] ?? null : null
  const selectedArtifact =
    artifacts.find((artifact) => artifact.path === selectedArtifactPath) ?? artifacts[0] ?? null

  useEffect(() => {
    if (!selectedArtifactPath && artifacts[0]) {
      setSelectedArtifactPath(artifacts[0].path)
    }
    if (selectedArtifactPath && !artifacts.some((artifact) => artifact.path === selectedArtifactPath)) {
      setSelectedArtifactPath(artifacts[0]?.path ?? null)
    }
  }, [artifacts, selectedArtifactPath])

  if (isCollapsed) {
    return null
  }

  return (
    <SidebarShell
      width={width}
      setWidth={setWidth}
      persistWidth={persistWidth}
      clampWidth={clampWidth}
      isCollapsed={isCollapsed}
      side="right"
      sizeConstraintClass="min-w-[280px] max-w-[640px]"
      collapsedWidth={0}
    >
      <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <div className="border-b border-sidebar-border/70 px-3 py-3">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-sidebar-foreground/40">
            Workbench
          </div>
          <div className="mt-1 text-sm font-medium text-sidebar-foreground/86">Artifacts</div>
        </div>

        {!activeThread ? (
          <RightSidebarEmptyState
            icon={File}
            title="No chat selected"
            description="Start a local chat to collect artifacts here."
          />
        ) : error ? (
          <RightSidebarEmptyState
            icon={InformationCircle}
            title="Artifacts unavailable"
            description={error}
          />
        ) : artifacts.length === 0 && !isLoading ? (
          <RightSidebarEmptyState
            icon={File}
            title="No artifacts yet"
            description="Files created in this chat's artifacts folder will appear here."
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              <div className="space-y-1">
                {artifacts.map((artifact) => {
                  const Icon = getArtifactIcon(artifact)
                  const isSelected = selectedArtifact?.path === artifact.path
                  const meta = [formatBytes(artifact.sizeBytes), artifact.modifiedAt ? new Date(artifact.modifiedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null]
                    .filter(Boolean)
                    .join(" · ")

                  return (
                    <button
                      key={artifact.path}
                      type="button"
                      onClick={() => setSelectedArtifactPath(artifact.path)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition",
                        isSelected
                          ? "bg-[var(--sidebar-item-active)] text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/68 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground/90"
                      )}
                    >
                      <Icon size={16} className="mt-0.5 shrink-0 text-sidebar-foreground/48" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{artifact.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-sidebar-foreground/40">
                          {meta || artifact.relativePath}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {selectedArtifact ? (
              <div className="shrink-0 border-t border-sidebar-border/70">
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-sidebar-foreground/78">
                      {selectedArtifact.name}
                    </div>
                    <div className="truncate text-[11px] text-sidebar-foreground/38">
                      {selectedArtifact.relativePath}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 rounded-md text-sidebar-foreground/52 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
                    onClick={() => void desktop.shell.openExternal(`file://${selectedArtifact.path}`)}
                    aria-label="Open artifact"
                  >
                    <ArrowSquareOut size={14} />
                  </Button>
                </div>
                <ArtifactPreview artifact={selectedArtifact} />
              </div>
            ) : null}
          </div>
        )}
      </aside>
    </SidebarShell>
  )
}
