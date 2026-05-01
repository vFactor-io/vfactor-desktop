import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs"
import {
  FileDiff,
  Virtualizer,
  WorkerPoolContextProvider,
} from "@pierre/diffs/react"
import PierreDiffWorker from "@pierre/diffs/worker/worker-portable.js?worker"
import { CaretDown, CaretRight } from "@/components/icons"
import { useEffect, useMemo, useState } from "react"
import { desktop } from "@/desktop/client"
import { useAppearance, vcsTextClassNames } from "@/features/shared/appearance"
import type { FileChange } from "../types"
import {
  getChangeKey,
  pruneCollapsedFileKeys,
  toggleCollapsedFileKey,
} from "./changesPanelState"

interface ChangesPanelProps {
  projectPath: string
  changes: FileChange[]
}

type PatchLoadState =
  | { status: "idle"; patch: string; error: null }
  | { status: "loading"; patch: string; error: null }
  | { status: "loaded"; patch: string; error: null }
  | { status: "error"; patch: string; error: string }

type RenderablePatch =
  | {
      kind: "files"
      files: FileDiffMetadata[]
    }
  | {
      kind: "raw"
      text: string
      reason: string
    }

const CHANGES_DIFF_UNSAFE_CSS = `
  :host {
    --diffs-light-bg: var(--background);
    --diffs-dark-bg: var(--background);
    --diffs-bg: var(--background);
    --diffs-light: var(--foreground);
    --diffs-dark: var(--foreground);
    --diffs-fg-number-override: color-mix(in oklab, var(--muted-foreground) 70%, var(--background) 30%);
    --diffs-bg-buffer-override: color-mix(in oklab, var(--background) 96%, var(--border) 4%);
    --diffs-bg-hover-override: color-mix(in oklab, var(--accent) 10%, var(--background) 90%);
    --diffs-bg-context-override: var(--background);
    --diffs-bg-context-number-override: color-mix(in oklab, var(--background) 94%, var(--border) 6%);
    --diffs-bg-separator-override: color-mix(in oklab, var(--background) 92%, var(--border) 8%);
    --diffs-addition-color-override: var(--vcs-added);
    --diffs-deletion-color-override: var(--vcs-deleted);
    --diffs-modified-color-override: var(--vcs-modified);
    --diffs-bg-addition-override: var(--vcs-added-surface);
    --diffs-bg-addition-number-override: color-mix(in oklab, var(--vcs-added-surface) 86%, var(--background) 14%);
    --diffs-bg-addition-hover-override: color-mix(in oklab, var(--vcs-added-surface) 92%, var(--accent) 8%);
    --diffs-bg-deletion-override: var(--vcs-deleted-surface);
    --diffs-bg-deletion-number-override: color-mix(in oklab, var(--vcs-deleted-surface) 86%, var(--background) 14%);
    --diffs-bg-deletion-hover-override: color-mix(in oklab, var(--vcs-deleted-surface) 92%, var(--accent) 8%);
    background-color: var(--background);
    color: var(--foreground);
  }

  pre,
  code,
  [data-diff],
  [data-file],
  [data-gutter],
  [data-diffs-header] {
    background-color: var(--diffs-bg);
  }

  [data-diffs-header] {
    position: sticky !important;
    top: 0;
    z-index: 4;
  }
`

function hashPatchText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function buildPatchCacheKey(patch: string, cacheScope: string): string {
  return `${cacheScope}:${patch.length}:${hashPatchText(patch)}`
}

function getRenderablePatch(patch: string, cacheScope: string): RenderablePatch | null {
  const normalizedPatch = patch.trim()
  if (!normalizedPatch) {
    return null
  }

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope)
    )
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files)
    if (files.length > 0) {
      return { kind: "files", files }
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    }
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    }
  }
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? ""
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2)
  }
  return raw
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`
}

function getDiffWorkerPoolSize(): number {
  const cores =
    typeof navigator === "undefined" ? 4 : Math.max(1, navigator.hardwareConcurrency || 4)
  return Math.max(2, Math.min(6, Math.floor(cores / 2)))
}

function LoadingDiffSurface() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3" role="status">
      <div className="h-4 w-32 animate-pulse rounded-full bg-muted" />
      <div className="space-y-2">
        <div className="h-3 w-full animate-pulse rounded-full bg-muted/80" />
        <div className="h-3 w-10/12 animate-pulse rounded-full bg-muted/70" />
        <div className="h-3 w-11/12 animate-pulse rounded-full bg-muted/60" />
        <div className="h-3 w-8/12 animate-pulse rounded-full bg-muted/60" />
      </div>
      <span className="sr-only">Loading working tree diff</span>
    </div>
  )
}

function DiffFileCollapseButton({
  collapsed,
  filePath,
  onToggle,
}: {
  collapsed: boolean
  filePath: string
  onToggle: () => void
}) {
  const Icon = collapsed ? CaretRight : CaretDown
  const label = collapsed ? `Expand ${filePath}` : `Collapse ${filePath}`

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Icon size={12} weight="bold" />
    </button>
  )
}

export function ChangesPanel({ projectPath, changes }: ChangesPanelProps) {
  const { pierreDiffTheme } = useAppearance()
  const workerPoolSize = useMemo(() => getDiffWorkerPoolSize(), [])
  const visibleChanges = useMemo(
    () =>
      changes
        .filter((change) => change.status !== "untracked")
        .sort((a, b) => a.path.localeCompare(b.path)),
    [changes]
  )
  const visibleChangeSignature = useMemo(
    () =>
      visibleChanges
        .map((change) =>
          [
            getChangeKey(change),
            change.status,
            change.additions ?? "",
            change.deletions ?? "",
          ].join(":")
        )
        .join("\n"),
    [visibleChanges]
  )
  const [patchState, setPatchState] = useState<PatchLoadState>({
    status: "idle",
    patch: "",
    error: null,
  })
  const [collapsedFileKeys, setCollapsedFileKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  useEffect(() => {
    if (visibleChanges.length === 0) {
      setPatchState({ status: "idle", patch: "", error: null })
      return
    }

    let cancelled = false
    const loadingTimeout = setTimeout(() => {
      if (!cancelled) {
        setPatchState((current) => ({ status: "loading", patch: current.patch, error: null }))
      }
    }, 120)

    desktop.git
      .getWorkingTreeDiff(projectPath)
      .then((result) => {
        if (cancelled) {
          return
        }
        setPatchState({ status: "loaded", patch: result.patch, error: null })
      })
      .catch((error) => {
        console.error("Failed to load working tree diff:", error)
        if (cancelled) {
          return
        }
        setPatchState({
          status: "error",
          patch: "",
          error: "Failed to load working tree diff.",
        })
      })
      .finally(() => {
        clearTimeout(loadingTimeout)
      })

    return () => {
      cancelled = true
      clearTimeout(loadingTimeout)
    }
  }, [projectPath, visibleChangeSignature, visibleChanges.length])

  const totals = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const change of visibleChanges) {
      additions += change.additions ?? 0
      deletions += change.deletions ?? 0
    }
    return { additions, deletions }
  }, [visibleChanges])

  const renderablePatch = useMemo(
    () => getRenderablePatch(patchState.patch, `changes-panel:${projectPath}:${pierreDiffTheme}`),
    [patchState.patch, pierreDiffTheme, projectPath]
  )
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return []
    }

    return [...renderablePatch.files].sort((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    )
  }, [renderablePatch])
  const renderableFileKeys = useMemo(
    () => renderableFiles.map((fileDiff) => buildFileDiffRenderKey(fileDiff)),
    [renderableFiles]
  )

  useEffect(() => {
    setCollapsedFileKeys((current) => pruneCollapsedFileKeys(current, renderableFileKeys))
  }, [renderableFileKeys])

  if (visibleChanges.length === 0) {
    return null
  }

  const fileLabel = visibleChanges.length === 1 ? "file" : "files"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-sidebar-border/60 bg-background/95 px-2.5 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {visibleChanges.length} {fileLabel} changed
        </span>
        <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
          {totals.additions > 0 ? (
            <span className={vcsTextClassNames.added}>+{totals.additions}</span>
          ) : null}
          {totals.deletions > 0 ? (
            <span className={vcsTextClassNames.deleted}>-{totals.deletions}</span>
          ) : null}
        </div>
      </div>

      <WorkerPoolContextProvider
        key={pierreDiffTheme}
        poolOptions={{
          workerFactory: () => new PierreDiffWorker(),
          poolSize: workerPoolSize,
          totalASTLRUCacheSize: 240,
        }}
        highlighterOptions={{
          theme: pierreDiffTheme,
          tokenizeMaxLineLength: 1_000,
        }}
      >
        <div className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden">
          {patchState.status === "error" ? (
            <div className="flex h-full items-center justify-center px-3 py-2 text-center text-xs text-destructive">
              {patchState.error}
            </div>
          ) : patchState.status === "loading" && !patchState.patch ? (
            <LoadingDiffSurface />
          ) : !renderablePatch ? (
            <div className="flex h-full items-center justify-center px-3 py-2 text-center text-xs text-muted-foreground/70">
              No patch available for this selection.
            </div>
          ) : renderablePatch.kind === "files" ? (
            <Virtualizer
              className="diff-render-surface app-scrollbar h-full min-h-0 overflow-auto"
              config={{
                overscrollSize: 600,
                intersectionObserverMargin: 1200,
              }}
            >
              {renderableFiles.map((fileDiff) => {
                const filePath = resolveFileDiffPath(fileDiff)
                const fileKey = buildFileDiffRenderKey(fileDiff)
                const themedFileKey = `${fileKey}:${pierreDiffTheme}`
                const collapsed = collapsedFileKeys.has(fileKey)

                return (
                  <div
                    key={themedFileKey}
                    data-diff-file-path={filePath}
                    className="diff-render-file"
                  >
                    <FileDiff
                      fileDiff={fileDiff}
                      options={{
                        diffStyle: "unified",
                        lineDiffType: "none",
                        overflow: "scroll",
                        collapsed,
                        theme: pierreDiffTheme,
                        themeType: pierreDiffTheme === "pierre-dark" ? "dark" : "light",
                        unsafeCSS: CHANGES_DIFF_UNSAFE_CSS,
                      }}
                      renderHeaderPrefix={() => (
                        <DiffFileCollapseButton
                          collapsed={collapsed}
                          filePath={filePath}
                          onToggle={() => {
                            setCollapsedFileKeys((current) =>
                              toggleCollapsedFileKey(current, fileKey)
                            )
                          }}
                        />
                      )}
                    />
                  </div>
                )
              })}
            </Virtualizer>
          ) : (
            <div className="h-full overflow-auto">
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                <pre className="app-scrollbar h-full overflow-auto bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90 whitespace-pre-wrap break-words">
                  {renderablePatch.text}
                </pre>
              </div>
            </div>
          )}
        </div>
      </WorkerPoolContextProvider>
    </div>
  )
}
