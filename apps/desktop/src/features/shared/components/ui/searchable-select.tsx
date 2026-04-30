import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CaretDown, CheckCircle, MagnifyingGlass } from "@/components/icons"
import { cn } from "@/lib/utils"
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group"

export interface SearchableSelectOption {
  value: string
  label: string
}

interface SearchableSelectProps<T extends SearchableSelectOption = SearchableSelectOption> {
  /** Currently selected value */
  value: string | null
  /** Called when a new value is selected */
  onValueChange: (value: string) => void
  /** Available options */
  options: T[]

  /** Text shown in trigger when no value is selected */
  placeholder?: string
  /** Override displayed value text in trigger */
  displayValue?: string
  /** Icon rendered before the label in the trigger */
  icon?: ReactNode

  /** Placeholder text for the search input */
  searchPlaceholder?: string
  /** Text shown when no options match the search */
  emptyMessage?: string
  /** Optional title shown in the rich empty state */
  emptyTitle?: string
  /** Optional icon shown in the rich empty state */
  emptyIcon?: ReactNode
  /** Label rendered above the option list */
  sectionLabel?: string

  /** Custom option body (replaces default label text) */
  renderOption?: (option: T, state: { isSelected: boolean }) => ReactNode
  /** Custom selection indicator (replaces default check icon) */
  renderIndicator?: (option: T, state: { isSelected: boolean }) => ReactNode

  /** Content rendered below the option list */
  footer?: ReactNode
  /** Error message shown above footer */
  errorMessage?: string | null
  /** Status message shown above footer (lower priority than error) */
  statusMessage?: string | null

  /** Disable the trigger button */
  disabled?: boolean
  /** Disables interactions inside the open dropdown (search input + items) */
  busy?: boolean

  /** Controlled open state */
  open?: boolean
  /** Called when the open state should change */
  onOpenChange?: (open: boolean) => void
  /** Called once each time the dropdown opens */
  onOpen?: () => void

  /** Trigger visual style — "input" looks like a form field, "ghost" is transparent, "text" is inline chrome-free */
  triggerVariant?: "input" | "ghost" | "text"

  /** Root wrapper className */
  className?: string
  /** Trigger button className (merged after variant styles) */
  triggerClassName?: string
  /** Dropdown panel className */
  dropdownClassName?: string
}

export function SearchableSelect<T extends SearchableSelectOption = SearchableSelectOption>({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  displayValue,
  icon,
  searchPlaceholder = "Search…",
  emptyMessage = "No results found.",
  emptyTitle = "Nothing found",
  emptyIcon,
  sectionLabel,
  renderOption,
  renderIndicator,
  footer,
  errorMessage,
  statusMessage,
  disabled = false,
  busy = false,
  open: openProp,
  onOpenChange,
  onOpen,
  triggerVariant = "input",
  className,
  triggerClassName,
  dropdownClassName,
}: SearchableSelectProps<T>) {
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = isControlled ? (openProp ?? false) : internalOpen

  const [searchQuery, setSearchQuery] = useState("")
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null)
  const [dropdownSide, setDropdownSide] = useState<"top" | "bottom">("bottom")

  const updateOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  // Reset search when dropdown closes
  useEffect(() => {
    if (!isOpen) setSearchQuery("")
  }, [isOpen])

  // Click-outside and Escape handling
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (busy) return
      const target = event.target as Node
      if (
        !dropdownRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        updateOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (busy) return
      if (event.key === "Escape") updateOpen(false)
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }, 0)

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, busy])

  useEffect(() => {
    if (!isOpen) return

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return

      const rect = trigger.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const viewportWidth = window.innerWidth
      const margin = 8
      const sideOffset = 6
      const estimatedHeight = 320
      const spaceBelow = viewportHeight - rect.bottom - margin
      const spaceAbove = rect.top - margin
      const openAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow

      const nextWidth =
        triggerVariant === "input" ? rect.width : Math.max(rect.width, 200)
      const nextMaxWidth = Math.max(0, viewportWidth - margin * 2)
      const clampedWidth = Math.min(nextWidth, nextMaxWidth)
      const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, viewportWidth - clampedWidth - margin),
      )
      const availableHeight = openAbove ? spaceAbove : spaceBelow

      setDropdownSide(openAbove ? "top" : "bottom")
      setDropdownStyle({
        position: "fixed",
        top: openAbove ? rect.top - sideOffset : rect.bottom + sideOffset,
        left,
        transform: openAbove ? "translateY(-100%)" : undefined,
        width: clampedWidth,
        maxHeight: Math.max(160, availableHeight),
      })
    }

    updatePosition()

    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)

    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [isOpen, triggerVariant])

  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (q.length === 0) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, searchQuery])

  // Resolve trigger label
  const selectedOption = options.find((o) => o.value === value) ?? null
  const resolvedLabel = displayValue ?? selectedOption?.label ?? value
  const triggerLabel = resolvedLabel || placeholder
  const isPlaceholder = !resolvedLabel

  const handleToggle = () => {
    if (disabled) return
    const next = !isOpen
    if (next) onOpen?.()
    updateOpen(next)
  }

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue)
    if (!isControlled) {
      setInternalOpen(false)
    }
  }

  const defaultIndicator = (_option: T, state: { isSelected: boolean }) =>
    state.isSelected ? <CheckCircle size={14} /> : null

  const variantStyles = {
    input: cn(
      "border-input bg-input h-8 w-full border",
      !disabled && "hover:border-ring/50",
      isOpen && "border-ring ring-ring/50 ring-[3px]",
    ),
    ghost: cn(
      "h-7 w-auto border-0 bg-transparent text-[color:var(--color-content-subtle)]",
      !disabled && "hover:bg-accent/45 hover:text-[color:var(--color-content-strong)]",
      isOpen && "bg-accent/55 text-[color:var(--color-content-strong)]",
    ),
    text: cn(
      "h-7 w-auto rounded-sm border-0 bg-transparent px-0 text-[color:var(--color-content-subtle)]",
      !disabled && "hover:text-[color:var(--color-content-strong)]",
      isOpen && "text-[color:var(--color-content-strong)]",
    ),
  }

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          "searchable-select-trigger group/select flex items-center gap-2 rounded-lg px-2.5 text-sm transition-colors",
          disabled && "cursor-default opacity-50",
          variantStyles[triggerVariant],
          triggerClassName,
        )}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {icon ? (
          <span
            className={cn(
              "shrink-0 text-[color:var(--color-icon-subtle)] transition-colors",
              !disabled && "group-hover/select:text-[color:var(--color-icon-strong)]",
              isOpen && "text-[color:var(--color-icon-strong)]"
            )}
          >
            {icon}
          </span>
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left",
            isPlaceholder && "text-muted-foreground",
          )}
        >
          {triggerLabel}
        </span>
        <CaretDown
          size={14}
          className={cn(
            "shrink-0 text-[color:var(--color-icon-subtle)] transition-colors",
            !disabled && "group-hover/select:text-[color:var(--color-icon-strong)]",
            isOpen && "text-[color:var(--color-icon-strong)]"
          )}
        />
      </button>

      {isOpen && dropdownStyle
        ? createPortal(
            <div
              ref={dropdownRef}
              data-side={dropdownSide}
              style={dropdownStyle}
              className={cn(
                "searchable-select-surface isolate z-50 flex min-w-[200px] flex-col overflow-hidden rounded-xl border border-border/80 bg-popover text-popover-foreground shadow-[0_16px_38px_color-mix(in_oklab,black_10%,transparent)]",
                "data-[side=bottom]:animate-in data-[side=bottom]:fade-in-0 data-[side=bottom]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2",
                "data-[side=top]:animate-in data-[side=top]:fade-in-0 data-[side=top]:zoom-in-95 data-[side=top]:slide-in-from-bottom-2",
                dropdownClassName,
              )}
            >
              <div className="border-b border-border/70 p-2">
                <InputGroup className="searchable-select-input h-8 rounded-lg border-input/80 bg-input/45">
                  <InputGroupAddon className="pl-2 text-[color:var(--color-icon-subtle)]">
                    <MagnifyingGlass size={16} />
                  </InputGroupAddon>
                  <InputGroupInput
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={searchPlaceholder}
                    className="h-full px-0 text-sm"
                    disabled={busy}
                  />
                </InputGroup>
              </div>

              {sectionLabel && filteredOptions.length > 0 ? (
                <div className="px-3 pt-3 pb-1 text-sm font-medium text-[color:var(--color-content-muted)]">
                  {sectionLabel}
                </div>
              ) : null}

              <div className="max-h-72 overflow-y-auto p-1">
                {filteredOptions.length > 0 ? (
                  <div className="space-y-0.5">
                    {filteredOptions.map((option) => {
                      const isSelected = option.value === value

                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleSelect(option.value)}
                          disabled={busy}
                          className={cn(
                            "searchable-select-row group flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/72 hover:text-accent-foreground",
                            isSelected ? "bg-accent text-accent-foreground" : "text-[color:var(--color-content)]",
                            busy && "opacity-80",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            {renderOption ? (
                              renderOption(option, { isSelected })
                            ) : (
                              <span className="block truncate text-sm font-medium">
                                {option.label}
                              </span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "mt-0.5 flex size-4 shrink-0 items-center justify-center",
                              isSelected
                                ? "text-accent-foreground"
                                : "text-[color:var(--color-icon-muted)] group-hover:text-accent-foreground"
                            )}
                          >
                            {(renderIndicator ?? defaultIndicator)(option, { isSelected })}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-32 flex-col items-center justify-center px-5 py-6 text-center">
                    {emptyIcon ? (
                      <div className="mb-3 flex size-9 items-center justify-center rounded-md border border-border/70 bg-muted/35 text-[color:var(--color-icon-subtle)]">
                        {emptyIcon}
                      </div>
                    ) : null}
                    <div className="text-sm font-medium text-[color:var(--color-content)]">
                      {emptyTitle}
                    </div>
                    <div className="mt-1 max-w-[22rem] text-sm leading-5 text-[color:var(--color-content-muted)]">
                      {emptyMessage}
                    </div>
                  </div>
                )}
              </div>

              {errorMessage ? (
                <div className="border-t border-border/70 px-3 py-2 text-sm text-[color:var(--color-destructive)]">
                  {errorMessage}
                </div>
              ) : statusMessage ? (
                <div className="border-t border-border/70 px-3 py-2 text-sm text-[color:var(--color-content-muted)]">
                  {statusMessage}
                </div>
              ) : null}

              {footer ? (
                <div className="sticky bottom-0 border-t border-border/70 bg-popover p-1">
                  {footer}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
