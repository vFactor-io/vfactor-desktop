import * as React from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const switchVariants = cva(
  "group/switch inline-flex shrink-0 items-center rounded-full border transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] data-[checked]:border-toggle-on/30 data-[checked]:bg-toggle-on data-[unchecked]:border-border data-[unchecked]:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        default: "h-8 w-[52px] p-1",
        sm: "h-6 w-10 p-0.5",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
)

const switchThumbVariants = cva(
  "block rounded-full bg-white shadow-sm transition-transform group-data-[unchecked]/switch:translate-x-0",
  {
    variants: {
      size: {
        default: "size-[26px] group-data-[checked]/switch:translate-x-5",
        sm: "size-[18px] group-data-[checked]/switch:translate-x-[18px]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
)

function Switch({
  className,
  size,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> &
  VariantProps<typeof switchVariants>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(switchVariants({ size, className }))}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(switchThumbVariants({ size }))}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
