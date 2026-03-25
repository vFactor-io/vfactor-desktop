import { useEffect, useMemo, useRef, useState } from "react"
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core"
import { useTree } from "@headless-tree/react"
import { DefaultFolderOpenedIcon, FolderIcon, FileIcon } from "@react-symbols/icons/utils"
import { desktop } from "@/desktop/client"
import { Tree, TreeItem, TreeItemLabel } from "@/features/shared/components/ui/tree"
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

interface DropTargetDebugInfo {
  targetDirectory: string
  pointedTagName: string | null
  pointedClasses: string | null
  pointedText: string | null
  matchedDropTarget: string | null
}

function extractDroppedPaths(files: FileList): string[] {
  const sourcePaths = Array.from(files)
    .map((file) => desktop.fs.getPathForFile(file) ?? (file as ElectronFile).path?.trim())
    .filter((path): path is string => Boolean(path))

  return Array.from(new Set(sourcePaths))
}

function containsExternalFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false
  }

  return dataTransfer.files.length > 0 || Array.from(dataTransfer.types).includes("Files")
}

function getDropTargetDirectory(
  itemId: string,
  item: FileTreeItem | undefined,
  projectPath: string
): string {
  if (itemId === "root" || item?.isDirectory) {
    return itemId === "root" ? projectPath : itemId
  }

  const lastSlashIndex = itemId.lastIndexOf("/")
  return lastSlashIndex >= 0 ? itemId.slice(0, lastSlashIndex) : projectPath
}

function getDropTargetDirectoryFromPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
  projectPath: string
): DropTargetDebugInfo {
  const pointedElement = document.elementFromPoint(clientX, clientY)

  if (!(pointedElement instanceof Element) || !container.contains(pointedElement)) {
    return {
      targetDirectory: projectPath,
      pointedTagName: null,
      pointedClasses: null,
      pointedText: null,
      matchedDropTarget: null,
    }
  }

  const dropTargetElement = pointedElement.closest<HTMLElement>("[data-drop-target-directory]")
  const targetDirectory = dropTargetElement?.dataset.dropTargetDirectory

  return {
    targetDirectory: targetDirectory?.trim() || projectPath,
    pointedTagName: pointedElement.tagName,
    pointedClasses: pointedElement.className || null,
    pointedText: pointedElement.textContent?.trim().slice(0, 80) || null,
    matchedDropTarget: targetDirectory?.trim() || null,
  }
}

function formatDropDebugMessage(label: string, details: Record<string, unknown>): string {
  return `[file-tree-drop] ${label} ${JSON.stringify(details)}`
}

export function FileTreeViewer({
  data,
  rootId = "root",
  initialExpanded = [],
  indent = 16,
  className,
  projectPath,
  onFileClick,
  onExternalDrop,
}: FileTreeViewerProps) {
  // Keep a ref to the latest data for the dataLoader callbacks
  const dataRef = useRef(data)
  dataRef.current = data
  const treeContainerRef = useRef<HTMLDivElement | null>(null)
  const lastLoggedTargetRef = useRef<string | null>(null)
  const [expandedItems, setExpandedItems] = useState<string[]>(initialExpanded)
  const [focusedItem, setFocusedItem] = useState<string | null>(null)
  const [dropTargetDirectory, setDropTargetDirectory] = useState<string | null>(null)
  const [isDropActive, setIsDropActive] = useState(false)

  const sanitizedExpandedItems = useMemo(
    () =>
      expandedItems.filter((itemId) => {
        if (itemId === rootId) {
          return true
        }

        const item = data[itemId]
        if (!item) {
          return false
        }

        return item.isDirectory ?? (item.children?.length ?? 0) > 0
      }),
    [data, expandedItems, rootId]
  )

  const sanitizedFocusedItem = useMemo(() => {
    if (!focusedItem) {
      return null
    }

    return data[focusedItem] ? focusedItem : null
  }, [data, focusedItem])

  useEffect(() => {
    if (sanitizedExpandedItems.length !== expandedItems.length) {
      setExpandedItems(sanitizedExpandedItems)
    }
  }, [expandedItems.length, sanitizedExpandedItems])

  useEffect(() => {
    if (focusedItem !== sanitizedFocusedItem) {
      setFocusedItem(sanitizedFocusedItem)
    }
  }, [focusedItem, sanitizedFocusedItem])

  const tree = useTree<FileTreeItem>({
    state: {
      expandedItems: sanitizedExpandedItems,
      focusedItem: sanitizedFocusedItem,
    },
    setExpandedItems,
    setFocusedItem,
    indent,
    rootItemId: rootId,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) =>
      item.getItemData()?.isDirectory ?? (item.getItemData()?.children?.length ?? 0) > 0,
    dataLoader: {
      getItem: (itemId) => dataRef.current[itemId],
      getChildren: (itemId) => dataRef.current[itemId]?.children ?? [],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  })

  // Rebuild tree when data changes
  useEffect(() => {
    tree.rebuildTree()
  }, [data, tree])

  useEffect(() => {
    setDropTargetDirectory(null)
    setIsDropActive(false)
    lastLoggedTargetRef.current = null
  }, [projectPath])

  const canHandleExternalDrop = Boolean(projectPath && onExternalDrop)

  useEffect(() => {
    if (!canHandleExternalDrop || !projectPath || !onExternalDrop) {
      return
    }

    const container = treeContainerRef.current
    if (!container) {
      return
    }

    const handleDragEnter = (event: DragEvent) => {
      if (!containsExternalFiles(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy"
      }

      const debugInfo = getDropTargetDirectoryFromPoint(
        container,
        event.clientX,
        event.clientY,
        projectPath
      )

      setIsDropActive(true)
      setDropTargetDirectory(debugInfo.targetDirectory)
      lastLoggedTargetRef.current = debugInfo.targetDirectory

      console.debug(
        formatDropDebugMessage("dragenter", {
          x: event.clientX,
          y: event.clientY,
          files: event.dataTransfer?.files.length ?? 0,
          targetDirectory: debugInfo.targetDirectory,
          pointedTagName: debugInfo.pointedTagName,
          pointedClasses: debugInfo.pointedClasses,
          pointedText: debugInfo.pointedText,
          matchedDropTarget: debugInfo.matchedDropTarget,
        })
      )
    }

    const handleDragOver = (event: DragEvent) => {
      if (!containsExternalFiles(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy"
      }

      const debugInfo = getDropTargetDirectoryFromPoint(
        container,
        event.clientX,
        event.clientY,
        projectPath
      )

      setIsDropActive(true)
      setDropTargetDirectory(debugInfo.targetDirectory)

      if (lastLoggedTargetRef.current === debugInfo.targetDirectory) {
        return
      }

      lastLoggedTargetRef.current = debugInfo.targetDirectory

      console.debug(
        formatDropDebugMessage("dragover", {
          x: event.clientX,
          y: event.clientY,
          files: event.dataTransfer?.files.length ?? 0,
          targetDirectory: debugInfo.targetDirectory,
          pointedTagName: debugInfo.pointedTagName,
          pointedClasses: debugInfo.pointedClasses,
          pointedText: debugInfo.pointedText,
          matchedDropTarget: debugInfo.matchedDropTarget,
        })
      )
    }

    const handleDragLeave = (event: DragEvent) => {
      if (!containsExternalFiles(event.dataTransfer)) {
        return
      }

      const pointedElement = document.elementFromPoint(event.clientX, event.clientY)
      if (pointedElement instanceof Element && container.contains(pointedElement)) {
        return
      }

      lastLoggedTargetRef.current = null
      setIsDropActive(false)
      setDropTargetDirectory(null)

      console.debug(
        formatDropDebugMessage("dragleave", {
          x: event.clientX,
          y: event.clientY,
          pointedInsideTree: pointedElement instanceof Element && container.contains(pointedElement),
        })
      )
    }

    const handleDrop = (event: DragEvent) => {
      if (!containsExternalFiles(event.dataTransfer)) {
        return
      }

      event.preventDefault()

      const sourcePaths = extractDroppedPaths(event.dataTransfer?.files ?? new DataTransfer().files)
      const debugInfo = getDropTargetDirectoryFromPoint(
        container,
        event.clientX,
        event.clientY,
        projectPath
      )

      lastLoggedTargetRef.current = null
      setIsDropActive(false)
      setDropTargetDirectory(null)

      console.debug(
        formatDropDebugMessage("drop", {
          x: event.clientX,
          y: event.clientY,
          sourcePaths,
          files: event.dataTransfer?.files.length ?? 0,
          targetDirectory: debugInfo.targetDirectory,
          pointedTagName: debugInfo.pointedTagName,
          pointedClasses: debugInfo.pointedClasses,
          pointedText: debugInfo.pointedText,
          matchedDropTarget: debugInfo.matchedDropTarget,
        })
      )

      if (sourcePaths.length === 0) {
        console.warn(formatDropDebugMessage("drop-empty", {}))
        return
      }

      void onExternalDrop(sourcePaths, debugInfo.targetDirectory)
    }

    container.addEventListener("dragenter", handleDragEnter)
    container.addEventListener("dragover", handleDragOver)
    container.addEventListener("dragleave", handleDragLeave)
    container.addEventListener("drop", handleDrop)

    return () => {
      container.removeEventListener("dragenter", handleDragEnter)
      container.removeEventListener("dragover", handleDragOver)
      container.removeEventListener("dragleave", handleDragLeave)
      container.removeEventListener("drop", handleDrop)
    }
  }, [canHandleExternalDrop, onExternalDrop, projectPath])

  return (
    <div
      ref={treeContainerRef}
      className={cn(
        "rounded-xl transition-colors",
        isDropActive && dropTargetDirectory === projectPath && "bg-sidebar-accent/30",
        className
      )}
    >
      <Tree indent={indent} tree={tree}>
        {tree.getItems().map((item) => {
          const isFolder = item.isFolder()
          const itemData = item.getItemData()
          const itemTargetDirectory =
            projectPath != null
              ? getDropTargetDirectory(item.getId(), itemData, projectPath)
              : null

          const handleClick = () => {
            if (!isFolder && onFileClick) {
              onFileClick(item.getId(), item.getItemName())
            }
          }

          return (
            <TreeItem
              key={item.getId()}
              item={item}
            >
              <TreeItemLabel
                data-drop-target-directory={itemTargetDirectory ?? undefined}
                className={cn(
                  "before:bg-sidebar relative px-1.5 py-1 before:absolute before:inset-x-0 before:-inset-y-0.5 before:-z-10",
                  dropTargetDirectory === itemTargetDirectory && "bg-sidebar-accent text-sidebar-accent-foreground"
                )}
                onClick={handleClick}
              >
                <span className="flex items-center gap-1.5">
                  {isFolder ? (
                    item.isExpanded() ? (
                      <DefaultFolderOpenedIcon
                        aria-hidden="true"
                        className="pointer-events-none size-3.5 shrink-0"
                      />
                    ) : (
                      <FolderIcon
                        aria-hidden="true"
                        className="pointer-events-none size-3.5 shrink-0"
                        folderName={item.getItemName()}
                      />
                    )
                  ) : (
                    <FileIcon
                      aria-hidden="true"
                      autoAssign
                      className="pointer-events-none size-3.5 shrink-0"
                      fileName={item.getItemName()}
                    />
                  )}
                  {item.getItemName()}
                </span>
              </TreeItemLabel>
            </TreeItem>
          )
        })}
      </Tree>
    </div>
  )
}
