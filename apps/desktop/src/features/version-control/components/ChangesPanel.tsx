import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { desktop, type GitFileDiff } from "@/desktop/client"
import { CaretDown, CaretRight } from "@/components/icons"
import { PatchDiff } from "@pierre/diffs/react"
import { useAppearance, vcsTextClassNames } from "@/features/shared/appearance"
import { cn } from "@/lib/utils"
import type { FileChange, FileStatus } from "../types"

interface ChangesPanelProps {
  projectPath: string
  changes: FileChange[]
}

const statusBorderColors: Record<FileStatus, string> = {
  modified: "color-mix(in oklab, var(--color-vcs-modified) 35%, transparent)",
  added: "color-mix(in oklab, var(--color-vcs-added) 35%, transparent)",
  deleted: "color-mix(in oklab, var(--color-vcs-deleted) 35%, transparent)",
  renamed: "color-mix(in oklab, var(--color-vcs-renamed) 35%, transparent)",
  copied: "color-mix(in oklab, var(--color-vcs-added) 35%, transparent)",
  untracked: "color-mix(in oklab, var(--color-vcs-ignored) 35%, transparent)",
  ignored: "color-mix(in oklab, var(--color-vcs-ignored) 35%, transparent)",
}

const statusPillClassNames: Record<FileStatus, string> = {
  modified:
    "bg-[color:var(--color-vcs-modified-surface)] text-[color:var(--color-vcs-modified)]",
  added:
    "bg-[color:var(--color-vcs-added-surface)] text-[color:var(--color-vcs-added)]",
  deleted:
    "bg-[color:var(--color-vcs-deleted-surface)] text-[color:var(--color-vcs-deleted)]",
  renamed:
    "bg-[color:var(--color-vcs-renamed-surface)] text-[color:var(--color-vcs-renamed)]",
  copied:
    "bg-[color:var(--color-vcs-added-surface)] text-[color:var(--color-vcs-added)]",
  untracked:
    "bg-[color:var(--color-vcs-ignored-surface)] text-[color:var(--color-vcs-ignored)]",
  ignored:
    "bg-[color:var(--color-vcs-ignored-surface)] text-[color:var(--color-vcs-ignored)]",
}

const statusIndicators: Record<FileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "U",
  renamed: "R",
  copied: "C",
  ignored: "!",
}

const statusLabels: Record<FileStatus, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  untracked: "Untracked",
  renamed: "Renamed",
  copied: "Copied",
  ignored: "Ignored",
}

function splitFilePath(filePath: string): { name: string; parent: string | null } {
  const lastSlash = filePath.lastIndexOf("/")
  if (lastSlash === -1) {
    return { name: filePath, parent: null }
  }
  return {
    name: filePath.slice(lastSlash + 1),
    parent: filePath.slice(0, lastSlash),
  }
}

const COLLAPSED_KEYS_STORAGE_PREFIX = "vfactor:changes-panel-collapsed:"

function getCollapsedKeysStorageKey(projectPath: string): string {
  return `${COLLAPSED_KEYS_STORAGE_PREFIX}${projectPath}`
}

function readCollapsedKeysFromStorage(projectPath: string): Set<string> {
  if (typeof window === "undefined") {
    return new Set()
  }

  try {
    const raw = window.localStorage.getItem(getCollapsedKeysStorageKey(projectPath))
    if (!raw) {
      return new Set()
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return new Set()
    }
    return new Set(parsed.filter((value): value is string => typeof value === "string"))
  } catch {
    return new Set()
  }
}

function writeCollapsedKeysToStorage(projectPath: string, keys: ReadonlySet<string>): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    const storageKey = getCollapsedKeysStorageKey(projectPath)
    if (keys.size === 0) {
      window.localStorage.removeItem(storageKey)
      return
    }
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(keys)))
  } catch {
    // Ignore storage errors (private mode, quota, etc.)
  }
}

function getChangeKey(change: FileChange) {
  return `${change.previousPath ?? ""}->${change.path}`
}

function normalizePatchText(value: string): string {
  return value.replace(/\r\n/g, "\n")
}

function splitPatchContentLines(value: string): { lines: string[]; hadTrailingNewline: boolean } {
  const normalized = normalizePatchText(value)
  const hadTrailingNewline = normalized.endsWith("\n")
  const body = hadTrailingNewline ? normalized.slice(0, -1) : normalized

  if (!body) {
    return { lines: [], hadTrailingNewline }
  }

  return {
    lines: body.split("\n"),
    hadTrailingNewline,
  }
}

function buildSyntheticPatch(diff: GitFileDiff): string | null {
  const targetPath = diff.path
  const sourcePath = diff.previousPath ?? diff.path

  if (diff.status === "added") {
    const { lines, hadTrailingNewline } = splitPatchContentLines(diff.modified)
    if (lines.length === 0) {
      return null
    }

    return [
      "--- /dev/null",
      `+++ b/${targetPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
      ...(hadTrailingNewline ? [] : ["\\ No newline at end of file"]),
    ].join("\n")
  }

  if (diff.status === "deleted") {
    const { lines, hadTrailingNewline } = splitPatchContentLines(diff.original)
    if (lines.length === 0) {
      return null
    }

    return [
      `--- a/${sourcePath}`,
      "+++ /dev/null",
      `@@ -1,${lines.length} +0,0 @@`,
      ...lines.map((line) => `-${line}`),
      ...(hadTrailingNewline ? [] : ["\\ No newline at end of file"]),
    ].join("\n")
  }

  const originalLinesState = splitPatchContentLines(diff.original)
  const modifiedLinesState = splitPatchContentLines(diff.modified)

  if (originalLinesState.lines.length === 0 && modifiedLinesState.lines.length === 0) {
    return null
  }

  return [
    `--- a/${sourcePath}`,
    `+++ b/${targetPath}`,
    `@@ -1,${originalLinesState.lines.length} +1,${modifiedLinesState.lines.length} @@`,
    ...originalLinesState.lines.map((line) => `-${line}`),
    ...modifiedLinesState.lines.map((line) => `+${line}`),
    ...(!originalLinesState.hadTrailingNewline || !modifiedLinesState.hadTrailingNewline
      ? ["\\ No newline at end of file"]
      : []),
  ].join("\n")
}

function getRenderablePatch(diff: GitFileDiff | null): string | null {
  if (!diff) {
    return null
  }

  if (diff.previewUnavailableReason) {
    return null
  }

  const patch = diff.patch?.trim()
  if (patch) {
    return normalizePatchText(patch)
  }

  return buildSyntheticPatch(diff)
}

function ChangesPanelDiff({
  diff,
}: {
  diff: GitFileDiff | null
}) {
  const { pierreDiffTheme } = useAppearance()
  const patch = useMemo(() => getRenderablePatch(diff), [diff])

  const placeholder = (() => {
    if (!diff) return "Loading diff…"
    if (diff.previewUnavailableReason === "image") return "Image diffs are not previewed here."
    if (diff.previewUnavailableReason === "binary") return "Binary diffs are not previewed here."
    if (diff.previewUnavailableReason === "too_large") return "This diff is too large to preview safely."
    if (!patch) return "Diff not available for this file."
    return null
  })()

  if (placeholder) {
    return (
      <div className="rounded-md border border-border/60 bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground">
        {placeholder}
      </div>
    )
  }

  return (
    <div className="app-scrollbar-sm overflow-hidden rounded-md border border-border/60 bg-card/60">
      <PatchDiff
        key={pierreDiffTheme}
        patch={patch!}
        disableWorkerPool
        options={{
          theme: pierreDiffTheme,
          themeType: pierreDiffTheme === "pierre-dark" ? "dark" : "light",
          diffStyle: "unified",
          diffIndicators: "classic",
          hunkSeparators: "line-info-basic",
          overflow: "scroll",
          disableFileHeader: true,
          disableBackground: false,
          lineDiffType: "word",
          unsafeCSS: `
            :host {
              --diffs-header-font-family: var(--font-sans);
              --diffs-font-size: 12px;
              --diffs-line-height: 1.45;
              --diffs-light-bg: var(--color-card);
              --diffs-dark-bg: var(--color-card);
              --diffs-light: var(--color-card-foreground);
              --diffs-dark: var(--color-card-foreground);
              --diffs-fg-number-override: color-mix(in oklab, var(--color-muted-foreground) 70%, var(--color-card) 30%);
              --diffs-bg-buffer-override: color-mix(in oklab, var(--color-card) 96%, var(--color-background) 4%);
              --diffs-bg-hover-override: color-mix(in oklab, var(--color-accent) 10%, var(--color-card) 90%);
              --diffs-bg-context-override: transparent;
              --diffs-bg-context-number-override: color-mix(in oklab, var(--color-card) 94%, var(--color-border) 6%);
              --diffs-bg-separator-override: color-mix(in oklab, var(--color-card) 92%, var(--color-border) 8%);
              --diffs-addition-color-override: var(--color-vcs-added);
              --diffs-deletion-color-override: var(--color-vcs-deleted);
              --diffs-modified-color-override: var(--color-vcs-modified);
              --diffs-bg-addition-override: var(--color-vcs-added-surface);
              --diffs-bg-addition-number-override: color-mix(in oklab, var(--color-vcs-added-surface) 86%, var(--color-card) 14%);
              --diffs-bg-addition-hover-override: color-mix(in oklab, var(--color-vcs-added-surface) 92%, var(--color-accent) 8%);
              --diffs-bg-deletion-override: var(--color-vcs-deleted-surface);
              --diffs-bg-deletion-number-override: color-mix(in oklab, var(--color-vcs-deleted-surface) 86%, var(--color-card) 14%);
              --diffs-bg-deletion-hover-override: color-mix(in oklab, var(--color-vcs-deleted-surface) 92%, var(--color-accent) 8%);
            }

            [data-file],
            [data-diff] {
              background: transparent !important;
              border-radius: 0 !important;
            }

            [data-code] {
              background: transparent !important;
              padding-top: 1px !important;
              padding-bottom: 1px !important;
              font-size: 12px !important;
              line-height: 1.45 !important;
            }

            [data-code]::-webkit-scrollbar {
              height: 4px !important;
            }

            [data-code]::-webkit-scrollbar-thumb {
              background-color: transparent !important;
              border-width: 0 !important;
              border-radius: 9999px !important;
            }

            [data-diff]:hover [data-code]::-webkit-scrollbar-thumb,
            [data-file]:hover [data-code]::-webkit-scrollbar-thumb,
            [data-code]::-webkit-scrollbar-thumb:hover {
              background-color: var(--color-scrollbar-thumb) !important;
            }
          `,
        }}
        className="text-[12px]"
      />
    </div>
  )
}

export function ChangesPanel({ projectPath, changes }: ChangesPanelProps) {
  const visibleChanges = useMemo(
    () =>
      changes
        .filter((change) => change.status !== "untracked")
        .sort((a, b) => a.path.localeCompare(b.path)),
    [changes]
  )
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() =>
    readCollapsedKeysFromStorage(projectPath)
  )
  const [diffsByKey, setDiffsByKey] = useState<Record<string, GitFileDiff>>({})
  const [diffErrorsByKey, setDiffErrorsByKey] = useState<Record<string, string>>({})
  const inFlightDiffsRef = useRef(new Map<string, Promise<void>>())
  const diffGenerationRef = useRef(0)
  const projectPathRef = useRef(projectPath)

  // Persist collapsed keys per project so navigation away and back restores the exact state.
  useEffect(() => {
    writeCollapsedKeysToStorage(projectPath, collapsedKeys)
  }, [projectPath, collapsedKeys])

  // Drop collapsed entries that are no longer in the visible list (e.g. file no longer changed).
  useEffect(() => {
    setCollapsedKeys((current) => {
      if (current.size === 0) return current
      const visibleKeys = new Set(visibleChanges.map(getChangeKey))
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (visibleKeys.has(key)) {
          next.add(key)
        } else {
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [visibleChanges])

  useEffect(() => {
    diffGenerationRef.current += 1
    setDiffsByKey({})
    setDiffErrorsByKey({})
    inFlightDiffsRef.current.clear()
  }, [visibleChanges])

  const preloadDiff = useCallback(
    (change: FileChange) => {
      const changeKey = getChangeKey(change)

      if (diffsByKey[changeKey] || diffErrorsByKey[changeKey] || inFlightDiffsRef.current.has(changeKey)) {
        return
      }

      const requestProjectPath = projectPath
      const requestGeneration = diffGenerationRef.current
      const request = desktop.git
        .getFileDiff(requestProjectPath, change.path, change.previousPath)
        .then((nextDiff) => {
          if (
            projectPathRef.current !== requestProjectPath ||
            diffGenerationRef.current !== requestGeneration
          ) {
            return
          }

          setDiffsByKey((current) => ({ ...current, [changeKey]: nextDiff }))
          setDiffErrorsByKey((current) => {
            if (!(changeKey in current)) {
              return current
            }

            const { [changeKey]: _removed, ...next } = current
            return next
          })
        })
        .catch((error) => {
          console.error("Failed to preload changes panel diff:", error)
          if (
            projectPathRef.current !== requestProjectPath ||
            diffGenerationRef.current !== requestGeneration
          ) {
            return
          }

          setDiffErrorsByKey((current) => ({ ...current, [changeKey]: "Failed to load diff." }))
        })
        .finally(() => {
          if (inFlightDiffsRef.current.get(changeKey) === request) {
            inFlightDiffsRef.current.delete(changeKey)
          }
        })

      inFlightDiffsRef.current.set(changeKey, request)
    },
    [diffErrorsByKey, diffsByKey, projectPath]
  )

  useEffect(() => {
    for (const change of visibleChanges) {
      if (!collapsedKeys.has(getChangeKey(change))) {
        preloadDiff(change)
      }
    }
  }, [collapsedKeys, preloadDiff, visibleChanges])

  const allCollapsed =
    visibleChanges.length > 0 &&
    visibleChanges.every((change) => collapsedKeys.has(getChangeKey(change)))

  const toggleAll = useCallback(() => {
    setCollapsedKeys((current) => {
      const visibleKeys = visibleChanges.map(getChangeKey)
      const isEveryVisibleChangeCollapsed =
        visibleKeys.length > 0 && visibleKeys.every((key) => current.has(key))

      if (isEveryVisibleChangeCollapsed) {
        return new Set()
      }

      return new Set(visibleKeys)
    })
  }, [visibleChanges])

  useEffect(() => {
    projectPathRef.current = projectPath
    diffGenerationRef.current += 1
    setDiffsByKey({})
    setDiffErrorsByKey({})
    inFlightDiffsRef.current.clear()
    setCollapsedKeys(readCollapsedKeysFromStorage(projectPath))
  }, [projectPath])

  const totals = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const change of visibleChanges) {
      additions += change.additions ?? 0
      deletions += change.deletions ?? 0
    }
    return { additions, deletions }
  }, [visibleChanges])

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
            <span className={vcsTextClassNames.deleted}>−{totals.deletions}</span>
          ) : null}
          <button
            type="button"
            onClick={toggleAll}
            title={allCollapsed ? "Expand all" : "Collapse all"}
            aria-label={allCollapsed ? "Expand all" : "Collapse all"}
            className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-[var(--sidebar-item-hover)] hover:text-foreground"
          >
            {allCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
          </button>
        </div>
      </div>

      <div className="flex flex-col px-1 py-1">
        {visibleChanges.map((change) => {
          const changeKey = getChangeKey(change)
          const isOpen = !collapsedKeys.has(changeKey)
          const Chevron = isOpen ? CaretDown : CaretRight
          const { name, parent } = splitFilePath(change.path)

          return (
            <div key={changeKey} className="min-w-0">
              <button
                type="button"
                onMouseEnter={() => preloadDiff(change)}
                onFocus={() => preloadDiff(change)}
                onClick={() =>
                  setCollapsedKeys((current) => {
                    const next = new Set(current)
                    if (next.has(changeKey)) {
                      next.delete(changeKey)
                    } else {
                      next.add(changeKey)
                    }
                    return next
                  })
                }
                title={`${statusLabels[change.status]} · ${change.path}`}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm leading-tight",
                  "transition-colors hover:bg-[var(--sidebar-item-hover)]",
                  isOpen && "bg-[var(--sidebar-item-active)]"
                )}
              >
                <span
                  aria-label={statusLabels[change.status]}
                  className={cn(
                    "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] text-[10px] font-semibold leading-none tabular-nums",
                    statusPillClassNames[change.status]
                  )}
                >
                  {statusIndicators[change.status]}
                </span>

                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="truncate text-foreground">{name}</span>
                  {parent ? (
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
                      {parent}
                    </span>
                  ) : null}
                </span>

                {change.additions != null && change.additions > 0 ? (
                  <span className={cn("shrink-0 text-[11px] tabular-nums", vcsTextClassNames.added)}>
                    +{change.additions}
                  </span>
                ) : null}
                {change.deletions != null && change.deletions > 0 ? (
                  <span className={cn("shrink-0 text-[11px] tabular-nums", vcsTextClassNames.deleted)}>
                    −{change.deletions}
                  </span>
                ) : null}
                <Chevron
                  size={12}
                  className={cn(
                    "shrink-0 text-muted-foreground/50 transition-colors",
                    "group-hover:text-muted-foreground/80",
                    isOpen && "text-muted-foreground/80"
                  )}
                />
              </button>

              {isOpen ? (
                <div
                  className="ml-[14px] mb-1.5 mt-0.5 border-l-2 pl-2"
                  style={{ borderLeftColor: statusBorderColors[change.status] }}
                >
                  {diffErrorsByKey[changeKey] ? (
                    <div className="px-2 py-2 text-xs text-destructive">
                      {diffErrorsByKey[changeKey]}
                    </div>
                  ) : (
                    <ChangesPanelDiff diff={diffsByKey[changeKey] ?? null} />
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
