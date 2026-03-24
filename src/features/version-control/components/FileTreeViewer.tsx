import { useEffect, useRef } from "react"
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core"
import { useTree } from "@headless-tree/react"
import { DefaultFolderOpenedIcon, FolderIcon, FileIcon } from "@react-symbols/icons/utils"
import { Tree, TreeItem, TreeItemLabel } from "@/features/shared/components/ui/tree"
import type { FileTreeItem } from "../types"

interface FileTreeViewerProps {
  data: Record<string, FileTreeItem>
  rootId?: string
  initialExpanded?: string[]
  indent?: number
  className?: string
  onFileClick?: (filePath: string, fileName: string) => void
}

export function FileTreeViewer({
  data,
  rootId = "root",
  initialExpanded = [],
  indent = 16,
  className,
  onFileClick,
}: FileTreeViewerProps) {
  // Keep a ref to the latest data for the dataLoader callbacks
  const dataRef = useRef(data)
  dataRef.current = data

  const tree = useTree<FileTreeItem>({
    initialState: {
      expandedItems: initialExpanded,
    },
    indent,
    rootItemId: rootId,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => (item.getItemData()?.children?.length ?? 0) > 0,
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

  return (
    <Tree indent={indent} tree={tree} className={className}>
      {tree.getItems().map((item) => {
          const isFolder = item.isFolder()
          const handleClick = () => {
            if (!isFolder && onFileClick) {
              onFileClick(item.getId(), item.getItemName())
            }
          }

          return (
            <TreeItem key={item.getId()} item={item}>
              <TreeItemLabel
                className="before:bg-sidebar relative px-1.5 py-1 before:absolute before:inset-x-0 before:-inset-y-0.5 before:-z-10"
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
  )
}
