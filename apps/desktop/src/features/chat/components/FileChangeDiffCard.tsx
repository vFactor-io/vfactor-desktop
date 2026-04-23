import { useMemo, type ReactNode } from "react"
import { PatchDiff, WorkerPoolContextProvider } from "@pierre/diffs/react"
import PierreDiffWorker from "@pierre/diffs/worker/worker-portable.js?worker"
import { useAppearance, vcsTextClassNames } from "@/features/shared/appearance"
import { cn } from "@/lib/utils"
import type { TimelineFileChangeEntry } from "./timelineActivity"

function getBaseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function normalizePatchText(value: string): string {
  return value.replace(/\r\n/g, "\n")
}

function normalizePatchHeaderForDisplay(path: string, patch: string): string {
  const fileName = getBaseName(path)
  const normalizedPatch = normalizePatchText(patch)
  const lines = normalizedPatch.split("\n")
  const renameFromName = lines
    .find((line) => line.startsWith("rename from "))
    ?.slice("rename from ".length)
  const renameToName = lines
    .find((line) => line.startsWith("rename to "))
    ?.slice("rename to ".length)
  const previousName = renameFromName ? getBaseName(renameFromName) : fileName
  const nextName = renameToName ? getBaseName(renameToName) : fileName
  const isRename = previousName !== nextName

  return lines
    .map((line) => {
      if (line.startsWith("diff --git ")) {
        return `diff --git ${previousName} ${nextName}`
      }

      if (line.startsWith("--- ")) {
        return line === "--- /dev/null" ? line : `--- ${previousName}`
      }

      if (line.startsWith("+++ ")) {
        return line === "+++ /dev/null" ? line : `+++ ${nextName}`
      }

      if (line.startsWith("rename from ")) {
        return isRename ? `rename from ${previousName}` : line
      }

      if (line.startsWith("rename to ")) {
        return isRename ? `rename to ${nextName}` : line
      }

      return line
    })
    .join("\n")
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

function buildSyntheticFilePatch(
  path: string,
  kind: string,
  rawContent: string
): string | null {
  const fileName = getBaseName(path)
  const normalizedContent = normalizePatchText(rawContent).trimEnd()
  if (!normalizedContent) {
    return null
  }

  const { lines, hadTrailingNewline } = splitPatchContentLines(rawContent)
  if (lines.length === 0) {
    return null
  }

  if (kind === "add") {
    return [
      "--- /dev/null",
      `+++ ${fileName}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
      ...(hadTrailingNewline ? [] : ["\\ No newline at end of file"]),
    ].join("\n")
  }

  if (kind === "delete") {
    return [
      `--- ${fileName}`,
      "+++ /dev/null",
      `@@ -1,${lines.length} +0,0 @@`,
      ...lines.map((line) => `-${line}`),
      ...(hadTrailingNewline ? [] : ["\\ No newline at end of file"]),
    ].join("\n")
  }

  return null
}

export function buildFileChangePatch(change: TimelineFileChangeEntry): string | null {
  const normalizedDiff = change.diff?.trim()
  if (!normalizedDiff) {
    return null
  }

  if (normalizedDiff.startsWith("diff --git") || normalizedDiff.startsWith("--- ")) {
    return normalizePatchHeaderForDisplay(change.path, normalizedDiff)
  }

  if (normalizedDiff.startsWith("@@ ")) {
    const fileName = getBaseName(change.path)
    return `--- ${fileName}\n+++ ${fileName}\n${normalizePatchText(normalizedDiff)}`
  }

  return buildSyntheticFilePatch(change.path, change.kind, change.diff ?? "")
}

export function countDiffLinesFromPatch(diff: string | undefined): { added: number; removed: number } {
  if (!diff) {
    return { added: 0, removed: 0 }
  }

  return diff.split("\n").reduce(
    (totals, line) => {
      if (line.startsWith("+++ ") || line.startsWith("--- ")) {
        return totals
      }
      if (line.startsWith("+")) {
        return { ...totals, added: totals.added + 1 }
      }
      if (line.startsWith("-")) {
        return { ...totals, removed: totals.removed + 1 }
      }
      return totals
    },
    { added: 0, removed: 0 }
  )
}

export function renderDiffStats({
  added,
  removed,
}: {
  added: number
  removed: number
}): ReactNode {
  if (added === 0 && removed === 0) {
    return null
  }

  return (
    <span className="ml-1.5 text-[0.9em]">
      {added > 0 ? <span className={cn("font-medium", vcsTextClassNames.added)}>+{added}</span> : null}
      {added > 0 && removed > 0 ? " " : null}
      {removed > 0 ? <span className={cn("font-medium", vcsTextClassNames.deleted)}>-{removed}</span> : null}
    </span>
  )
}

function DeferredPierrePatchDiff({
  patch,
  maxHeightClassName = "max-h-[22rem]",
}: {
  patch: string
  maxHeightClassName?: string
}) {
  const { pierreDiffTheme } = useAppearance()

  return (
    <div
      className={cn(
        "chat-file-change-diff app-scrollbar-sm overflow-y-auto rounded-lg border border-border/70 bg-card/75 shadow-sm",
        maxHeightClassName
      )}
    >
      <WorkerPoolContextProvider
        key={pierreDiffTheme}
        poolOptions={{
          workerFactory: () => new PierreDiffWorker(),
          poolSize: 1,
        }}
        highlighterOptions={{
          theme: pierreDiffTheme,
        }}
      >
        <PatchDiff
          patch={patch}
          options={{
            theme: pierreDiffTheme,
            themeType: pierreDiffTheme === "pierre-dark" ? "dark" : "light",
            diffStyle: "unified",
            diffIndicators: "classic",
            hunkSeparators: "line-info-basic",
            overflow: "scroll",
            disableFileHeader: false,
            disableBackground: false,
            lineDiffType: "word",
            unsafeCSS: `
              :host {
                --diffs-header-font-family: var(--font-sans);
                --diffs-font-size: 12px;
                --diffs-line-height: 1.4;
                --diffs-light-bg: var(--color-card);
                --diffs-dark-bg: var(--color-card);
                --diffs-light: var(--color-card-foreground);
                --diffs-dark: var(--color-card-foreground);
                --diffs-fg-number-override: color-mix(in oklab, var(--color-muted-foreground) 88%, var(--color-card) 12%);
                --diffs-bg-buffer-override: color-mix(in oklab, var(--color-card) 96%, var(--color-background) 4%);
                --diffs-bg-hover-override: color-mix(in oklab, var(--color-accent) 12%, var(--color-card) 88%);
                --diffs-bg-context-override: color-mix(in oklab, var(--color-card) 98%, var(--color-background) 2%);
                --diffs-bg-context-number-override: color-mix(in oklab, var(--color-card) 92%, var(--color-border) 8%);
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
                border-radius: 0 !important;
                background: transparent !important;
              }

              [data-diffs-header] {
                background: color-mix(in oklab, var(--color-card) 94%, var(--color-background) 6%) !important;
                border-bottom: 1px solid color-mix(in oklab, var(--color-border) 78%, transparent) !important;
              }

              [data-header-content] {
                padding: 8px 12px !important;
              }

              [data-title] {
                color: var(--color-foreground) !important;
              }

              [data-code] {
                padding-top: 1px !important;
                padding-bottom: 7px !important;
                font-size: 12px !important;
                line-height: 1.4 !important;
              }

              [data-code]::-webkit-scrollbar {
                height: 2px !important;
              }

              [data-code]::-webkit-scrollbar-thumb {
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
      </WorkerPoolContextProvider>
    </div>
  )
}

export function FileChangeDiffCard({
  change,
  maxHeightClassName,
}: {
  change: TimelineFileChangeEntry
  maxHeightClassName?: string
}) {
  const patch = useMemo(() => buildFileChangePatch(change), [change])

  if (patch) {
    return <DeferredPierrePatchDiff patch={patch} maxHeightClassName={maxHeightClassName} />
  }

  if (change.diff) {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-card/70 px-3 py-3 font-mono text-[12px] leading-5 text-foreground/78">
        {change.diff}
      </pre>
    )
  }

  return (
    <div className="rounded-md border border-border/70 bg-card/70 px-3 py-3 text-xs text-muted-foreground">
      Diff not available for this change.
    </div>
  )
}
