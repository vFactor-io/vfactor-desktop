import * as React from "react"

import { CaretLeft, CaretRight } from "@/components/icons"
import { cn } from "@/lib/utils"

import { buttonVariants } from "./button"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem(props: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & React.ComponentProps<"button">

function PaginationLink({
  className,
  isActive,
  type = "button",
  ...props
}: PaginationLinkProps) {
  return (
    <button
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      type={type}
      className={cn(
        buttonVariants({
          variant: isActive ? "secondary" : "ghost",
          size: "icon-sm",
        }),
        "size-7",
        isActive && "bg-accent text-accent-foreground hover:bg-accent",
        className,
      )}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  children = <CaretLeft size={16} />,
  ...props
}: PaginationLinkProps) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      className={cn("text-muted-foreground", className)}
      {...props}
    >
      {children}
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  children = <CaretRight size={16} />,
  ...props
}: PaginationLinkProps) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      className={cn("text-muted-foreground", className)}
      {...props}
    >
      {children}
    </PaginationLink>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
