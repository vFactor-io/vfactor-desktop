import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
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

  /** Trigger visual style — "input" looks like a form field, "ghost" is transparent */
  triggerVariant?: "input" | "ghost"

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
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

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
      if (!dropdownRef.current?.contains(event.target as Node)) {
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
      "h-7 w-auto border-0 bg-transparent",
      !disabled && "hover:bg-muted/70",
      isOpen && "bg-muted",
    ),
  }

  return (
    <div ref={dropdownRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 rounded-lg px-2.5 text-sm transition-colors",
          disabled && "cursor-default opacity-50",
          variantStyles[triggerVariant],
          triggerClassName,
        )}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-left",
            isPlaceholder && "text-muted-foreground",
          )}
        >
          {triggerLabel}
        </span>
        <CaretDown size={14} className="shrink-0 text-muted-foreground" />
      </button>

      {isOpen ? (
        <div
          className={cn(
            "absolute top-[calc(100%+6px)] left-0 z-50 flex min-w-[200px] flex-col overflow-hidden rounded-xl border border-sidebar-border bg-popover shadow-md ring-1 ring-foreground/10",
            triggerVariant === "input" && "w-full",
            dropdownClassName,
          )}
        >
          <div className="border-b border-sidebar-border p-2">
            <InputGroup className="h-8 rounded-lg border-input/80 bg-input/30">
              <InputGroupAddon className="pl-2 text-muted-foreground">
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

          {sectionLabel ? (
            <div className="px-3 pt-3 pb-1 text-sm font-medium text-muted-foreground">
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
                        "group flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
                        isSelected ? "text-foreground" : "text-foreground/92",
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
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-foreground">
                        {(renderIndicator ?? defaultIndicator)(option, { isSelected })}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            )}
          </div>

          {errorMessage ? (
            <div className="border-t border-sidebar-border px-3 py-2 text-sm text-[#F08BA7]">
              {errorMessage}
            </div>
          ) : statusMessage ? (
            <div className="border-t border-sidebar-border px-3 py-2 text-sm text-muted-foreground">
              {statusMessage}
            </div>
          ) : null}

          {footer ? (
            <div className="sticky bottom-0 border-t border-sidebar-border bg-popover p-1">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
