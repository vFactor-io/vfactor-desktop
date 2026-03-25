import nucleusLogoDarkUrl from "@/assets/brands/nucleus-logo-dark.png"
import nucleusLogoLightUrl from "@/assets/brands/nucleus-logo-light.png"
import { cn } from "@/lib/utils"

interface NucleusLogoProps {
  className?: string
  imageClassName?: string
  alt?: string
}

export function NucleusLogo({
  className,
  imageClassName,
  alt = "Nucleus logo",
}: NucleusLogoProps) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <img
        src={nucleusLogoLightUrl}
        alt={alt}
        className={cn("size-full object-contain dark:hidden", imageClassName)}
      />
      <img
        src={nucleusLogoDarkUrl}
        alt={alt}
        className={cn("hidden size-full object-contain dark:block", imageClassName)}
      />
    </span>
  )
}
