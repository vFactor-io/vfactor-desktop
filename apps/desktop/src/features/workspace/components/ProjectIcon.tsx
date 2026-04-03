import { useEffect, useState } from "react"
import { Folder, FolderOpen } from "@/components/icons"
import { desktop } from "@/desktop/client"
import { cn } from "@/lib/utils"
import type { Project } from "@/features/workspace/types"
import {
  normalizeProjectIconPath,
  projectIconPathToSrc,
  resolveProjectIconPath,
} from "@/features/workspace/utils/projectIcon"

interface ProjectIconProps {
  project?: Pick<Project, "iconPath" | "faviconPath"> | null
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
  const resolvedIconPath = normalizeProjectIconPath(resolveProjectIconPath(project))
  const [iconSrc, setIconSrc] = useState<string | null>(() => {
    if (!resolvedIconPath) {
      return null
    }

    if (resolvedIconPath.startsWith("data:") || /^[a-zA-Z]+:\/\//.test(resolvedIconPath)) {
      return projectIconPathToSrc(resolvedIconPath)
    }

    return null
  })
  const [hasImageError, setHasImageError] = useState(false)

  useEffect(() => {
    setHasImageError(false)

    let isDisposed = false

    if (!resolvedIconPath) {
      setIconSrc(null)
      return () => {
        isDisposed = true
      }
    }

    if (resolvedIconPath.startsWith("data:") || /^[a-zA-Z]+:\/\//.test(resolvedIconPath)) {
      setIconSrc(projectIconPathToSrc(resolvedIconPath))
      return () => {
        isDisposed = true
      }
    }

    // Don't clear iconSrc here — keep the previous icon visible until the new one loads
    void desktop.fs.readFileAsDataUrl(resolvedIconPath).then(
      (nextSrc) => {
        if (!isDisposed) {
          setIconSrc(nextSrc)
        }
      },
      () => {
        if (!isDisposed) {
          setIconSrc(null)
        }
      }
    )

    return () => {
      isDisposed = true
    }
  }, [resolvedIconPath])

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
