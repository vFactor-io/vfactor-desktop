import { useEffect, useMemo, useRef, useState } from "react"
import { FileTree as PierreTreeModel } from "@pierre/trees"
import { FileTree as PierreFileTree } from "@pierre/trees/react"
import { useAppearance } from "@/features/shared/appearance"
import { cn } from "@/lib/utils"
import type { FileTreeItem } from "../types"

type ExternalDropHandler = (sourcePaths: string[], targetDirectory: string) => Promise<void>

interface FileTreeViewerProps {
  data: Record<string, FileTreeItem>
  rootId?: string
  initialExpanded?: string[]
  indent?: number
  className?: string
  projectPath?: string | null
  onFileClick?: (filePath: string, fileName: string) => void
  onExternalDrop?: ExternalDropHandler
}

interface ElectronFile extends File {
  path?: string
}

interface CanonicalTreeEntry {
  absolutePath: string
  canonicalPath: string
  isDirectory: boolean
  name: string
}

interface DropTargetResolution {
  canonicalDirectoryPath: string | null
  hoveredPath: string | null
}

interface ResolvedTreeEntry {
  absolutePath: string
  canonicalPath: string
  isDirectory: boolean
  name: string
}

const TREE_UNSAFE_CSS = `
  [data-file-tree-virtualized-scroll='true'] {
    padding-bottom: 10px;
  }

  [data-type='item'] {
    border-radius: calc(var(--radius-sm, 0.5rem) + 1px);
  }

  [data-item-context-menu-trigger-mode] {
    cursor: default;
  }

  [data-nucleus-external-drop-target='true'] {
    background-color: var(--trees-selected-bg);
    color: var(--trees-selected-fg);
    --truncate-marker-background-overlay-color: var(--trees-selected-bg);
  }

  [data-nucleus-external-drop-target='true'] > [data-item-section='icon'],
  [data-nucleus-external-drop-target='true'] > [data-item-section='content'] {
    color: inherit;
  }
`

function extractDroppedPaths(files: FileList): string[] {
  const sourcePaths = Array.from(files)
    .map((file) => window.nucleus.fs.getPathForFile(file) ?? (file as ElectronFile).path?.trim())
    .filter((path): path is string => Boolean(path))

  return Array.from(new Set(sourcePaths))
}

function containsExternalFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false
  }

  return dataTransfer.files.length > 0 || Array.from(dataTransfer.types).includes("Files")
}

function getEventPathElements(event: Event): HTMLElement[] {
  return event.composedPath().filter((entry): entry is HTMLElement => entry instanceof HTMLElement)
}

function getRowElementFromEvent(event: Event): HTMLElement | null {
  return getEventPathElements(event).find((element) => element.dataset.itemPath != null) ?? null
}

function getFlattenedSegmentPathFromEvent(event: Event): string | null {
  return (
    getEventPathElements(event).find((element) => element.dataset.itemFlattenedSubitem != null)
      ?.dataset.itemFlattenedSubitem ?? null
  )
}

function resolveDropTargetFromEvent(event: DragEvent): DropTargetResolution {
  const rowElement = getRowElementFromEvent(event)

  if (!rowElement) {
    return {
      canonicalDirectoryPath: null,
      hoveredPath: null,
    }
  }

  const hoveredPath = rowElement.dataset.itemPath?.trim() || null
  const flattenedSegmentPath = getFlattenedSegmentPathFromEvent(event)

  if (flattenedSegmentPath?.endsWith("/")) {
    return {
      canonicalDirectoryPath: flattenedSegmentPath,
      hoveredPath,
    }
  }

  if (rowElement.dataset.itemType === "folder") {
    return {
      canonicalDirectoryPath: hoveredPath,
      hoveredPath,
    }
  }

  return {
    canonicalDirectoryPath: rowElement.dataset.itemParentPath?.trim() || null,
    hoveredPath,
  }
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/")
}

function getCanonicalPathFromItemId(
  itemId: string,
  item: FileTreeItem,
  projectPath?: string | null
): string | null {
  if (!projectPath) {
    return null
  }

  const normalizedProjectPath = normalizePathSeparators(projectPath).replace(/\/+$/, "")
  const normalizedItemId = normalizePathSeparators(itemId).replace(/\/+$/, "")

  if (!normalizedItemId.startsWith(`${normalizedProjectPath}/`)) {
    return null
  }

  const relativePath = normalizedItemId.slice(normalizedProjectPath.length + 1)
  if (!relativePath) {
    return null
  }

  return item.isDirectory ? `${relativePath}/` : relativePath
}

function buildCanonicalTreeEntries(
  data: Record<string, FileTreeItem>,
  rootId: string,
  projectPath?: string | null
): CanonicalTreeEntry[] {
  const root = data[rootId]

  if (!root?.children?.length) {
    return []
  }

  const entries: CanonicalTreeEntry[] = []

  const visit = (itemId: string, parentCanonicalPath = "") => {
    const item = data[itemId]
    if (!item) {
      return
    }

    const canonicalPath =
      getCanonicalPathFromItemId(itemId, item, projectPath) ??
      `${parentCanonicalPath}${item.name}${item.isDirectory ? "/" : ""}`
    entries.push({
      absolutePath: itemId,
      canonicalPath,
      isDirectory: Boolean(item.isDirectory),
      name: item.name,
    })

    if (!item.isDirectory || !item.children?.length) {
      return
    }

    for (const childId of item.children) {
      visit(childId, canonicalPath)
    }
  }

  for (const childId of root.children) {
    visit(childId)
  }

  return entries
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value)
  }

  return value.replace(/["\\]/g, "\\$&")
}

function getFileTreeHost(wrapper: HTMLDivElement | null): HTMLElement | null {
  return wrapper?.querySelector("file-tree-container") ?? null
}

function syncExternalDropHighlight(host: HTMLElement | null, hoveredPath: string | null): void {
  const shadowRoot = host?.shadowRoot
  if (!shadowRoot) {
    return
  }

  shadowRoot
    .querySelector<HTMLElement>("[data-nucleus-external-drop-target='true']")
    ?.removeAttribute("data-nucleus-external-drop-target")

  if (!hoveredPath) {
    return
  }

  shadowRoot
    .querySelector<HTMLElement>(`[data-item-path="${cssEscape(hoveredPath)}"]`)
    ?.setAttribute("data-nucleus-external-drop-target", "true")
}

function resolveTreeEntryFromCanonicalPath(
  canonicalPath: string,
  canonicalEntryMap: Map<string, CanonicalTreeEntry>,
  data: Record<string, FileTreeItem>,
  rootId: string
): ResolvedTreeEntry | null {
  const directEntry = canonicalEntryMap.get(canonicalPath)
  if (directEntry) {
    return directEntry
  }

  const normalizedSelection = normalizePathSeparators(canonicalPath).replace(/\/+$/, "")

  for (const [itemId, item] of Object.entries(data)) {
    if (itemId === rootId) {
      continue
    }

    const normalizedItemId = normalizePathSeparators(itemId).replace(/\/+$/, "")
    if (
      normalizedItemId === normalizedSelection ||
      normalizedItemId.endsWith(`/${normalizedSelection}`)
    ) {
      return {
        absolutePath: itemId,
        canonicalPath,
        isDirectory: Boolean(item.isDirectory),
        name: item.name,
      }
    }
  }

  return null
}

export function FileTreeViewer({
  data,
  rootId = "root",
  initialExpanded = [],
  indent,
  className,
  projectPath,
  onFileClick,
  onExternalDrop,
}: FileTreeViewerProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const previousCanonicalEntriesRef = useRef<CanonicalTreeEntry[]>([])
  const previousPathsSignatureRef = useRef("")
  const canonicalEntryMapRef = useRef<Map<string, CanonicalTreeEntry>>(new Map())
  const dataRef = useRef<Record<string, FileTreeItem>>(data)
  const onFileClickRef = useRef<FileTreeViewerProps["onFileClick"]>(onFileClick)
  const [isDropActive, setIsDropActive] = useState(false)
  const [isRootDropTarget, setIsRootDropTarget] = useState(false)
  const { resolvedAppearance } = useAppearance()

  const canonicalEntries = useMemo(
    () => buildCanonicalTreeEntries(data, rootId, projectPath),
    [data, projectPath, rootId]
  )
  const canonicalPaths = useMemo(
    () => canonicalEntries.map((entry) => entry.canonicalPath),
    [canonicalEntries]
  )
  const canonicalEntryMap = useMemo(
    () => new Map(canonicalEntries.map((entry) => [entry.canonicalPath, entry])),
    [canonicalEntries]
  )
  const canonicalDirectoryMap = useMemo(
    () =>
      new Map(
        canonicalEntries
          .filter((entry) => entry.isDirectory)
          .map((entry) => [entry.canonicalPath, entry.absolutePath] as const)
      ),
    [canonicalEntries]
  )
  const pathsSignature = useMemo(() => canonicalPaths.join("\n"), [canonicalPaths])

  useEffect(() => {
    canonicalEntryMapRef.current = canonicalEntryMap
  }, [canonicalEntryMap])

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    onFileClickRef.current = onFileClick
  }, [onFileClick])

  const treeModel = useMemo(
    () =>
      new PierreTreeModel({
        flattenEmptyDirectories: false,
        icons: {
          colored: true,
        },
        paths: canonicalPaths,
        initialExpansion: "closed",
        initialExpandedPaths: [],
        unsafeCSS: TREE_UNSAFE_CSS,
      }),
    [canonicalPaths, projectPath]
  )

  useEffect(() => {
    return () => {
      treeModel.cleanUp()
    }
  }, [treeModel])

  useEffect(() => {
    if (previousPathsSignatureRef.current === pathsSignature) {
      return
    }

    const nextPathSet = new Set(canonicalPaths)
    const preservedExpandedPaths = previousCanonicalEntriesRef.current
      .filter((entry) => {
        if (!entry.isDirectory || !nextPathSet.has(entry.canonicalPath)) {
          return false
        }

        const item = treeModel.getItem(entry.canonicalPath)
        return item?.isDirectory() === true && item.isExpanded()
      })
      .map((entry) => entry.canonicalPath)

    treeModel.resetPaths(canonicalPaths, {
      initialExpandedPaths:
        preservedExpandedPaths.length > 0
          ? preservedExpandedPaths
          : initialExpanded.filter((itemId) => itemId !== rootId),
    })

    previousCanonicalEntriesRef.current = canonicalEntries
    previousPathsSignatureRef.current = pathsSignature
  }, [canonicalEntries, canonicalPaths, initialExpanded, pathsSignature, rootId, treeModel])

  useEffect(() => {
    const wrapper = wrapperRef.current
    const host = getFileTreeHost(wrapper)
    const onFileClick = onFileClickRef.current

    if (!host || !onFileClick) {
      return
    }

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
        return
      }

      const rowElement = getRowElementFromEvent(event)
      const flattenedSegmentPath = getFlattenedSegmentPathFromEvent(event)
      const canonicalPath =
        (flattenedSegmentPath?.trim() || rowElement?.dataset.itemPath?.trim() || null)

      if (!canonicalPath) {
        return
      }

      const entry = resolveTreeEntryFromCanonicalPath(
        canonicalPath,
        canonicalEntryMapRef.current,
        dataRef.current,
        rootId
      )

      if (!entry) {
        return
      }

      if (entry.isDirectory) {
        return
      }

      onFileClick(entry.absolutePath, entry.name)
    }

    host.addEventListener("click", handleClick)

    return () => {
      host.removeEventListener("click", handleClick)
    }
  }, [projectPath, rootId, treeModel])

  useEffect(() => {
    const wrapper = wrapperRef.current
    const host = getFileTreeHost(wrapper)

    if (!host || !projectPath || !onExternalDrop) {
      return
    }

    const resetDropState = () => {
      syncExternalDropHighlight(host, null)
      setIsDropActive(false)
      setIsRootDropTarget(false)
    }

    const handleDragEnter = (event: DragEvent) => {
      if (!containsExternalFiles(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      event.dataTransfer!.dropEffect = "copy"

      const { hoveredPath, canonicalDirectoryPath } = resolveDropTargetFromEvent(event)
      syncExternalDropHighlight(host, hoveredPath)
      setIsDropActive(true)
      setIsRootDropTarget(canonicalDirectoryPath == null)
    }

    const handleDragOver = (event: DragEvent) => {
      if (!containsExternalFiles(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      event.dataTransfer!.dropEffect = "copy"

      const { hoveredPath, canonicalDirectoryPath } = resolveDropTargetFromEvent(event)
      syncExternalDropHighlight(host, hoveredPath)
      setIsDropActive(true)
      setIsRootDropTarget(canonicalDirectoryPath == null)
    }

    const handleDragLeave = (event: DragEvent) => {
      if (!containsExternalFiles(event.dataTransfer)) {
        return
      }

      const relatedTarget = document.elementFromPoint(event.clientX, event.clientY)
      if (relatedTarget instanceof Element && host.contains(relatedTarget)) {
        return
      }

      resetDropState()
    }

    const handleDrop = (event: DragEvent) => {
      if (!containsExternalFiles(event.dataTransfer)) {
        return
      }

      event.preventDefault()

      const sourcePaths = extractDroppedPaths(event.dataTransfer?.files ?? new DataTransfer().files)
      const { canonicalDirectoryPath } = resolveDropTargetFromEvent(event)
      const targetDirectory =
        (canonicalDirectoryPath ? canonicalDirectoryMap.get(canonicalDirectoryPath) : null) ??
        projectPath

      resetDropState()

      if (sourcePaths.length === 0) {
        return
      }

      void onExternalDrop(sourcePaths, targetDirectory)
    }

    host.addEventListener("dragenter", handleDragEnter)
    host.addEventListener("dragover", handleDragOver)
    host.addEventListener("dragleave", handleDragLeave)
    host.addEventListener("drop", handleDrop)

    return () => {
      host.removeEventListener("dragenter", handleDragEnter)
      host.removeEventListener("dragover", handleDragOver)
      host.removeEventListener("dragleave", handleDragLeave)
      host.removeEventListener("drop", handleDrop)
      syncExternalDropHighlight(host, null)
    }
  }, [canonicalDirectoryMap, onExternalDrop, projectPath, treeModel])

  const treeHostStyle = useMemo(
    () =>
      ({
        height: "100%",
        colorScheme: resolvedAppearance,
        "--trees-accent-override": "var(--accent)",
        "--trees-bg-muted-override": "var(--sidebar-item-hover)",
        "--trees-bg-override": "var(--sidebar)",
        "--trees-border-color-override": "transparent",
        "--trees-border-radius-override": "var(--radius-sm)",
        "--trees-density-override": "0.84",
        "--trees-fg-muted-override":
          "color-mix(in srgb, var(--sidebar-foreground) 56%, transparent)",
        "--trees-fg-override": "var(--sidebar-foreground)",
        "--trees-focus-ring-color-override": "color-mix(in srgb, var(--ring) 60%, transparent)",
        "--trees-font-family-override": "inherit",
        "--trees-font-size-override": "calc(var(--app-text-size, 13px) - 0px)",
        "--trees-item-margin-x-override": "1px",
        "--trees-item-padding-x-override": "8px",
        "--trees-item-row-gap-override": "7px",
        "--trees-level-gap-override": indent != null ? `${indent}px` : "10px",
        "--trees-padding-inline-override": "4px",
        "--trees-scrollbar-thumb-override":
          "color-mix(in srgb, var(--sidebar-foreground) 18%, transparent)",
        "--trees-search-bg-override": "var(--card)",
        "--trees-search-fg-override": "var(--foreground)",
        "--trees-selected-bg-override": "var(--sidebar-item-active)",
        "--trees-selected-fg-override": "var(--sidebar-accent-foreground)",
        width: "100%",
      }) as React.CSSProperties,
    [indent, resolvedAppearance]
  )

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col transition-colors",
        isDropActive && isRootDropTarget && "bg-sidebar-accent/20",
        className
      )}
    >
      <PierreFileTree
        key={projectPath ?? "file-tree"}
        model={treeModel}
        style={treeHostStyle}
      />
    </div>
  )
}
