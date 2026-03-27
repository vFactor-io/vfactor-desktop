import { useEffect, useState } from "react"
import { CircleDashed } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { ProjectAction } from "@/features/workspace/types"
import {
  normalizeProjectIconPath,
  projectIconPathToSrc,
} from "@/features/workspace/utils/projectIcon"
import { getProjectActionIconOption } from "@/features/workspace/utils/projectActionIcons"

interface ProjectActionIconProps {
  action?: Pick<ProjectAction, "iconName" | "iconPath"> | null
  size?: number
  className?: string
}

export function ProjectActionIcon({
  action,
  size = 16,
  className,
}: ProjectActionIconProps) {
  const iconOption = getProjectActionIconOption(action?.iconName)
  const iconPath = normalizeProjectIconPath(action?.iconPath)
  const iconSrc = projectIconPathToSrc(iconPath)
  const [hasImageError, setHasImageError] = useState(false)

  useEffect(() => {
    setHasImageError(false)
  }, [iconSrc])

  if (iconOption) {
    const IconComponent = iconOption.icon
    return <IconComponent size={size} className={className} aria-hidden="true" />
  }

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

  return <CircleDashed size={size} className={className} aria-hidden="true" />
}
