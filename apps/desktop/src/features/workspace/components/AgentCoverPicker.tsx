import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react"
import { CheckCircle, Image as ImageIcon, MagnifyingGlass } from "@/components/icons"
import { Button } from "@/features/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/features/shared/components/ui/dialog"
import { Input } from "@/features/shared/components/ui/input"
import { LoadingDots } from "@/features/shared/components/ui/loading-dots"
import { cn } from "@/lib/utils"
import { AGENT_HEADER_BACKGROUNDS } from "../utils/backgrounds"
import {
  fetchTrendingGifCovers,
  isGifSearchConfigured,
  searchGifCovers,
  type GifCoverResult,
} from "../utils/giphy"

type CoverPickerMode = "photos" | "gifs"

interface AgentCoverPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (coverUrl: string) => Promise<void> | void
  selectedCoverUrl?: string | null
  trigger: ReactElement
}

export function AgentCoverPicker({
  open,
  onOpenChange,
  onSelect,
  selectedCoverUrl,
  trigger,
}: AgentCoverPickerProps) {
  const [mode, setMode] = useState<CoverPickerMode>("photos")
  const [searchQuery, setSearchQuery] = useState("")
  const [gifResults, setGifResults] = useState<GifCoverResult[]>([])
  const [gifError, setGifError] = useState<string | null>(null)
  const [isLoadingGifs, setIsLoadingGifs] = useState(false)
  const [pendingCoverUrl, setPendingCoverUrl] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(searchQuery.trim())
  const gifSearchEnabled = isGifSearchConfigured()

  useEffect(() => {
    if (!open || mode !== "gifs") {
      return
    }

    if (!gifSearchEnabled) {
      setGifResults([])
      setGifError("Add VITE_GIPHY_API_KEY to enable GIF search.")
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setIsLoadingGifs(true)
      setGifError(null)

      try {
        const nextResults = deferredQuery
          ? await searchGifCovers(deferredQuery, controller.signal)
          : await fetchTrendingGifCovers(controller.signal)

        if (controller.signal.aborted) {
          return
        }

        startTransition(() => {
          setGifResults(nextResults)
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setGifError(error instanceof Error ? error.message : "Could not load GIFs right now.")
        setGifResults([])
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingGifs(false)
        }
      }
    }, deferredQuery ? 280 : 0)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [deferredQuery, gifSearchEnabled, mode, open])

  const gifHeadline = useMemo(() => {
    if (deferredQuery) {
      return `Results for "${deferredQuery}"`
    }

    return "Trending GIF covers"
  }, [deferredQuery])

  const handleSelect = async (coverUrl: string) => {
    setPendingCoverUrl(coverUrl)

    try {
      await onSelect(coverUrl)
      onOpenChange(false)
    } finally {
      setPendingCoverUrl(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent
        className="w-[min(92vw,1120px)] max-w-[1120px] overflow-hidden rounded-[2rem] p-0 sm:max-w-[1120px]"
        showCloseButton={false}
      >
        <div className="border-b border-border/70 px-5 py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <DialogHeader className="space-y-1">
              <DialogTitle>Choose a cover</DialogTitle>
              <DialogDescription>
                Pick from curated backgrounds or search GIFs for a more animated agent cover.
              </DialogDescription>
            </DialogHeader>

            <div className="inline-flex w-fit rounded-xl border border-border/70 bg-muted/40 p-1">
              {(["photos", "gifs"] as const).map((nextMode) => {
                const isActive = mode === nextMode

                return (
                  <Button
                    key={nextMode}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "rounded-[10px] px-3.5 text-sm capitalize",
                      isActive
                        ? "bg-background text-foreground shadow-sm hover:bg-background"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setMode(nextMode)}
                  >
                    {nextMode}
                  </Button>
                )
              })}
            </div>
          </div>

          {mode === "gifs" ? (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="sr-only">Search GIFs</span>
                <div className="relative">
                  <MagnifyingGlass
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search GIF covers like ocean, focus, synthwave..."
                    className="h-10 rounded-xl bg-background pl-9"
                  />
                </div>
              </label>
              <p className="text-xs text-muted-foreground">
                Animated search is powered by <a className="underline underline-offset-4" href="https://developers.giphy.com/" target="_blank" rel="noreferrer">GIPHY</a>.
              </p>
            </div>
          ) : null}
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-5">
          {mode === "photos" ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {AGENT_HEADER_BACKGROUNDS.map((background) => {
                const isSelected = selectedCoverUrl === background.imageUrl
                const isPending = pendingCoverUrl === background.imageUrl

                return (
                  <button
                    key={background.id}
                    type="button"
                    onClick={() => void handleSelect(background.imageUrl)}
                    className={cn(
                      "group overflow-hidden rounded-[1.35rem] border text-left transition-transform hover:-translate-y-0.5",
                      isSelected ? "border-foreground/70 ring-1 ring-foreground/20" : "border-border/60"
                    )}
                  >
                    <div className="relative">
                      <img
                        src={background.imageUrl}
                        alt={background.label}
                        className="h-32 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,12,17,0.02)_0%,rgba(8,12,17,0.46)_100%)]" />
                      {isSelected || isPending ? (
                        <div className="absolute right-3 top-3 rounded-full bg-background/88 p-1 text-foreground shadow-sm">
                          <CheckCircle size={14} />
                        </div>
                      ) : null}
                      <div className="absolute inset-x-0 bottom-0 p-3">
                        <span className="text-sm font-medium text-white">{background.label}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{gifHeadline}</p>
                  <p className="text-xs text-muted-foreground">
                    Select any preview to use it as the agent cover.
                  </p>
                </div>
                {!isLoadingGifs && gifResults.length > 0 ? (
                  <span className="text-xs text-muted-foreground">{gifResults.length} available</span>
                ) : null}
              </div>

              {gifError ? (
                <div className="rounded-[1.2rem] border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                  {gifError}
                </div>
              ) : null}

              {isLoadingGifs ? (
                <div className="rounded-[1.2rem] border border-border/60 bg-muted/30 px-4 py-8 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <LoadingDots />
                    Loading GIF previews
                  </span>
                </div>
              ) : null}

              {!gifError && !isLoadingGifs && gifResults.length === 0 ? (
                <div className="rounded-[1.2rem] border border-dashed border-border/70 bg-muted/30 px-4 py-8 text-sm text-muted-foreground">
                  No GIF covers found for that search.
                </div>
              ) : null}

              {gifResults.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {gifResults.map((gif) => {
                    const isSelected = selectedCoverUrl === gif.coverUrl
                    const isPending = pendingCoverUrl === gif.coverUrl

                    return (
                      <button
                        key={gif.id}
                        type="button"
                        onClick={() => void handleSelect(gif.coverUrl)}
                        className={cn(
                          "group overflow-hidden rounded-[1.35rem] border text-left transition-transform hover:-translate-y-0.5",
                          isSelected ? "border-foreground/70 ring-1 ring-foreground/20" : "border-border/60"
                        )}
                      >
                        <div className="relative">
                          <img
                            src={gif.previewUrl}
                            alt={gif.title}
                            className="h-32 w-full object-cover"
                          />
                          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,12,17,0.04)_0%,rgba(8,12,17,0.58)_100%)] opacity-90 transition-opacity group-hover:opacity-100" />
                          {isSelected || isPending ? (
                            <div className="absolute right-3 top-3 rounded-full bg-background/88 p-1 text-foreground shadow-sm">
                              <CheckCircle size={14} />
                            </div>
                          ) : null}
                          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
                            <div className="min-w-0">
                              <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-black/30 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/84">
                                <ImageIcon size={12} />
                                GIF
                              </span>
                              <p className="truncate text-sm font-medium text-white">{gif.title}</p>
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
