import { forwardRef, type Ref } from "react"
import { FileIcon as ReactSymbolsFileIcon } from "@react-symbols/icons/utils"
import type { Icon, IconProps } from "@/components/icons"

const fileIconCache = new Map<string, Icon>()

function createFileIcon(filename: string): Icon {
  const FileTypeIcon = forwardRef(function FileTypeIcon(
    { size = 24, weight: _weight, strokeWidth: _strokeWidth, ...props }: IconProps,
    ref: Ref<SVGSVGElement>,
  ) {
    return (
      <ReactSymbolsFileIcon
        ref={ref}
        autoAssign
        fileName={filename}
        width={size}
        height={size}
        aria-hidden="true"
        {...props}
      />
    )
  }) as Icon

  FileTypeIcon.displayName = `FileIcon(${filename})`
  return FileTypeIcon
}

export function getFileIcon(filename: string): Icon {
  const cachedIcon = fileIconCache.get(filename)
  if (cachedIcon) {
    return cachedIcon
  }

  const nextIcon = createFileIcon(filename)
  fileIconCache.set(filename, nextIcon)
  return nextIcon
}
