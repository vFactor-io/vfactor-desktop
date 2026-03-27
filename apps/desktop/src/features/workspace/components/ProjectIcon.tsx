import { useEffect, useState } from "react"
import { Folder, FolderOpen } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { Project } from "@/features/workspace/types"
import {
  normalizeProjectIconPath,
  projectIconPathToSrc,
} from "@/features/workspace/utils/projectIcon"

interface ProjectIconProps {
  project?: Pick<Project, "iconPath"> | null
  isExpanded?: boolean
  size?: number
  className?: string
}

export function ProjectIcon({
  project,
  isExpanded = false,
  size = 16,
  className,
}: ProjectIconProps) {
  const iconPath = normalizeProjectIconPath(project?.iconPath)
  const iconSrc = projectIconPathToSrc(iconPath)
  const [hasImageError, setHasImageError] = useState(false)

  useEffect(() => {
    setHasImageError(false)
  }, [iconSrc])

  if (iconSrc && !hasImageError) {
    return (
      <img
        aria-hidden="true"
        src={iconSrc}
        alt=""
        width={size}
        height={size}
        onError={() => setHasImageError(true)}
        className={cn("rounded-[4px] object-cover", className)}
      />
    )
  }

  const FallbackIcon = isExpanded ? FolderOpen : Folder
  return <FallbackIcon size={size} className={className} aria-hidden="true" />
}
