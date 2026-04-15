import { type FormEvent, useEffect, useRef, useState } from "react"
import { CaretLeft, CaretRight, Globe, Refresh } from "@/components/icons"
import { RightSidebarEmptyState } from "@/features/shared/components/layout/RightSidebarEmptyState"
import { Button } from "@/features/shared/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/features/shared/components/ui/input-group"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import {
  getBrowserUrlForWorktree,
  useBrowserSidebarStore,
} from "../store/browserSidebarStore"

type BrowserWebviewElement = HTMLElement & {
  canGoBack: () => boolean
  canGoForward: () => boolean
  getTitle: () => string
  getURL: () => string
  goBack: () => void
  goForward: () => void
  isLoading: () => boolean
  reload: () => void
}

function isInteractiveWebview(value: HTMLElement | null): value is BrowserWebviewElement {
  if (!value) {
    return false
  }

  return (
    typeof (value as BrowserWebviewElement).getURL === "function" &&
    typeof (value as BrowserWebviewElement).getTitle === "function" &&
    typeof (value as BrowserWebviewElement).canGoBack === "function" &&
    typeof (value as BrowserWebviewElement).canGoForward === "function" &&
    typeof (value as BrowserWebviewElement).goBack === "function" &&
    typeof (value as BrowserWebviewElement).goForward === "function" &&
    typeof (value as BrowserWebviewElement).reload === "function"
  )
}

function resolveBrowserDestination(value: string): string | null {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  if (trimmedValue === "about:blank") {
    return trimmedValue
  }

  if (/\s/.test(trimmedValue)) {
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmedValue)}`
  }

  try {
    const parsed = new URL(trimmedValue)
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString()
    }
    return null
  } catch {
    try {
      return new URL(`https://${trimmedValue}`).toString()
    } catch {
      return null
    }
  }
}

export function BrowserSidebar() {
  const { selectedWorktreeId } = useCurrentProjectWorktree()
  const worktreeId = selectedWorktreeId ?? null
  const browserUrl = useBrowserSidebarStore((state) =>
    getBrowserUrlForWorktree(state.entriesByWorktreeId, worktreeId)
  )
  const setBrowserUrl = useBrowserSidebarStore((state) => state.setUrl)
  const webviewRef = useRef<HTMLElement | null>(null)
  const [addressValue, setAddressValue] = useState(browserUrl ?? "")
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isWebviewReady, setIsWebviewReady] = useState(false)

  useEffect(() => {
    setAddressValue(browserUrl ?? "")
  }, [browserUrl])

  useEffect(() => {
    if (!browserUrl) {
      setIsWebviewReady(false)
      setIsLoading(false)
      return
    }

    const element = webviewRef.current
    if (!element) {
      return
    }

    if (!isInteractiveWebview(element)) {
      setIsWebviewReady(false)
      setIsLoading(false)
      setLoadError(
        "The embedded browser is not ready yet. Fully restart the Nucleus desktop app to enable this panel."
      )
      return
    }

    const webview = element

    const syncNavigationState = () => {
      try {
        const nextUrl = webview.getURL() || browserUrl
        setCanGoBack(webview.canGoBack())
        setCanGoForward(webview.canGoForward())
        setIsLoading(webview.isLoading())
        setAddressValue(nextUrl)
      } catch (error) {
        console.debug("[BrowserSidebar] webview state unavailable before dom-ready", error)
      }
    }

    const handleStartLoading = () => {
      setIsLoading(true)
      setLoadError(null)
      syncNavigationState()
    }

    const handleStopLoading = () => {
      setIsLoading(false)
      syncNavigationState()
    }

    const handleDidNavigate = () => {
      setLoadError(null)
      syncNavigationState()
    }

    const handleDomReady = () => {
      setIsWebviewReady(true)
      setLoadError(null)
      syncNavigationState()
    }

    const handlePageTitleUpdated = () => {
      syncNavigationState()
    }

    const handleLoadFailure = (event: Event & { errorCode?: number; errorDescription?: string }) => {
      if (event.errorCode === -3) {
        return
      }

      setIsLoading(false)
      setLoadError(event.errorDescription ?? "The page couldn't be loaded.")
      syncNavigationState()
    }

    setIsWebviewReady(false)
    setIsLoading(true)
    webview.addEventListener("dom-ready", handleDomReady)
    webview.addEventListener("did-start-loading", handleStartLoading)
    webview.addEventListener("did-stop-loading", handleStopLoading)
    webview.addEventListener("did-navigate", handleDidNavigate)
    webview.addEventListener("did-navigate-in-page", handleDidNavigate)
    webview.addEventListener("page-title-updated", handlePageTitleUpdated)
    webview.addEventListener("did-fail-load", handleLoadFailure as EventListener)

    return () => {
      webview.removeEventListener("dom-ready", handleDomReady)
      webview.removeEventListener("did-start-loading", handleStartLoading)
      webview.removeEventListener("did-stop-loading", handleStopLoading)
      webview.removeEventListener("did-navigate", handleDidNavigate)
      webview.removeEventListener("did-navigate-in-page", handleDidNavigate)
      webview.removeEventListener("page-title-updated", handlePageTitleUpdated)
      webview.removeEventListener("did-fail-load", handleLoadFailure as EventListener)
    }
  }, [browserUrl])

  if (!worktreeId) {
    return (
      <RightSidebarEmptyState
        title="No project selected"
        description="Choose a worktree to open the browser panel."
      />
    )
  }

  const navigate = (value: string) => {
    const destination = resolveBrowserDestination(value)

    if (!destination) {
      setLoadError("Enter a valid http(s) URL or search phrase.")
      return
    }

    setLoadError(null)
    setAddressValue(destination)
    setBrowserUrl(worktreeId, destination)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigate(addressValue)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form onSubmit={handleSubmit} className="shrink-0 px-1.5">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-sidebar-foreground/64 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
            onClick={() => (webviewRef.current as BrowserWebviewElement | null)?.goBack()}
            disabled={!isWebviewReady || !canGoBack}
            aria-label="Go back"
          >
            <CaretLeft size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-sidebar-foreground/64 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
            onClick={() => (webviewRef.current as BrowserWebviewElement | null)?.goForward()}
            disabled={!isWebviewReady || !canGoForward}
            aria-label="Go forward"
          >
            <CaretRight size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-sidebar-foreground/64 hover:bg-[var(--sidebar-item-hover)] hover:text-sidebar-foreground"
            onClick={() => (webviewRef.current as BrowserWebviewElement | null)?.reload()}
            disabled={!isWebviewReady}
            aria-label="Refresh page"
          >
            <Refresh size={14} className={isLoading ? "animate-spin" : undefined} />
          </Button>
          <InputGroup className="h-8 bg-background/70">
            <InputGroupAddon align="inline-start" className="pl-2 pr-0 text-sidebar-foreground/42">
              <InputGroupText>
                <Globe size={14} />
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={addressValue}
              onChange={(event) => setAddressValue(event.target.value)}
              placeholder="Enter a URL or search the web"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <InputGroupAddon align="inline-end" className="pr-1">
              <InputGroupButton type="submit" size="icon-xs" variant="ghost" aria-label="Go to address">
                <CaretRight size={14} />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </form>

      {loadError ? (
        <div className="mx-1.5 mt-1.5 shrink-0 rounded-xl border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs leading-5 text-destructive">
          {loadError}
        </div>
      ) : null}

      {browserUrl ? (
        <div className="mt-1.5 min-h-0 flex-1 overflow-hidden border-t border-sidebar-border/70 bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <webview
            ref={webviewRef}
            src={browserUrl}
            partition="persist:nucleus-browser"
            className="h-full w-full bg-white"
          />
        </div>
      ) : (
        <div className="mt-1.5 flex min-h-0 flex-1 border-t border-sidebar-border/70 bg-background">
          <RightSidebarEmptyState
            title="Open a page"
            description="Enter a URL above to load a site in the browser panel."
          />
        </div>
      )}
    </div>
  )
}
