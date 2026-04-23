import { useEffect, useMemo, useState } from "react"
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

const statusToneClassNames: Record<FileStatus, string> = {
  modified: vcsTextClassNames.modified,
  added: vcsTextClassNames.added,
  deleted: vcsTextClassNames.deleted,
  untracked: vcsTextClassNames.ignored,
  renamed: vcsTextClassNames.renamed,
  copied: vcsTextClassNames.added,
  ignored: vcsTextClassNames.ignored,
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

  if (!diff) {
    return (
      <div className="px-6 py-4 text-[12px] text-muted-foreground">
        Loading diff...
      </div>
    )
  }

  if (!patch) {
    return (
      <div className="px-6 py-4 text-[12px] text-muted-foreground">
        Diff not available for this file.
      </div>
    )
  }

  return (
    <div className="app-scrollbar-sm overflow-x-auto overflow-y-hidden pb-2">
      <PatchDiff
        patch={patch}
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
            [data-code] {
              padding-top: 4px !important;
              padding-bottom: 4px !important;
              font-size: 12px !important;
              line-height: 1.45 !important;
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
  const [openKey, setOpenKey] = useState<string | null>(visibleChanges[0] ? getChangeKey(visibleChanges[0]) : null)
  const [activeDiff, setActiveDiff] = useState<GitFileDiff | null>(null)
  const [activeDiffError, setActiveDiffError] = useState<string | null>(null)

  useEffect(() => {
    if (visibleChanges.length === 0) {
      setOpenKey(null)
      return
    }

    setOpenKey((current) => {
      if (current && visibleChanges.some((change) => getChangeKey(change) === current)) {
        return current
      }

      return getChangeKey(visibleChanges[0])
    })
  }, [visibleChanges])

  const openChange =
    visibleChanges.find((change) => getChangeKey(change) === openKey) ?? null

  useEffect(() => {
    if (!openChange) {
      setActiveDiff(null)
      setActiveDiffError(null)
      return
    }

    let isCancelled = false

    setActiveDiff(null)
    setActiveDiffError(null)

    void desktop.git
      .getFileDiff(projectPath, openChange.path, openChange.previousPath)
      .then((nextDiff) => {
        if (!isCancelled) {
          setActiveDiff(nextDiff)
        }
      })
      .catch((error) => {
        console.error("Failed to load changes panel diff:", error)
        if (!isCancelled) {
          setActiveDiffError("Failed to load diff.")
        }
      })

    return () => {
      isCancelled = true
    }
  }, [openChange, projectPath])

  if (visibleChanges.length === 0) {
    return null
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-1 py-1">
      {visibleChanges.map((change) => {
        const changeKey = getChangeKey(change)
        const isOpen = changeKey === openKey
        const Chevron = isOpen ? CaretDown : CaretRight

        return (
          <div key={changeKey} className="min-w-0">
            <button
              type="button"
              onClick={() => setOpenKey((current) => (current === changeKey ? null : changeKey))}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] leading-5 text-foreground/92",
                "transition-colors hover:bg-[var(--sidebar-item-hover)]",
                isOpen && "bg-[var(--sidebar-item-active)]"
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {change.path}
              </span>
              {change.additions != null ? (
                <span className={cn("shrink-0 text-[0.95em] font-medium", vcsTextClassNames.added)}>
                  +{change.additions}
                </span>
              ) : null}
              {change.deletions != null ? (
                <span className={cn("shrink-0 text-[0.95em] font-medium", vcsTextClassNames.deleted)}>
                  -{change.deletions}
                </span>
              ) : null}
              <Chevron
                size={14}
                className={cn(
                  "shrink-0 text-muted-foreground/72",
                  isOpen && statusToneClassNames[change.status]
                )}
              />
            </button>

            {isOpen ? (
              activeDiffError ? (
                <div className="px-6 py-3 text-[12px] text-destructive">
                  {activeDiffError}
                </div>
              ) : (
                <div className="pb-2 pl-2">
                  <ChangesPanelDiff diff={activeDiff} />
                </div>
              )
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
