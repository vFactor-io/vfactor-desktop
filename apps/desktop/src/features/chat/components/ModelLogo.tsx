import { Circle } from "@/components/icons"
import { cn } from "@/lib/utils"
import openAiSymbolLightUrl from "@/assets/brands/openai-symbol-light.svg"
import openAiSymbolDarkUrl from "@/assets/brands/openai-symbol-dark.svg"

export type ModelLogoKind = "openai" | "claude" | "codex" | "default"

function OpenAILogo({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} aria-hidden="true">
      <img src={openAiSymbolLightUrl} alt="" className="size-full object-contain dark:hidden" />
      <img src={openAiSymbolDarkUrl} alt="" className="hidden size-full object-contain dark:block" />
    </span>
  )
}

function ClaudeLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3.5 13.9 8.1 18.5 10 13.9 11.9 12 16.5 10.1 11.9 5.5 10 10.1 8.1 12 3.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="10" r="1.35" fill="currentColor" />
    </svg>
  )
}

function CodexLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4.5" y="4.5" width="15" height="15" rx="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10.2 9.1 7.7 12 10.2 14.9M13.8 9.1 16.3 12 13.8 14.9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

export function ModelLogo({ kind, className }: { kind: ModelLogoKind; className?: string }) {
  if (kind === "openai") {
    return <OpenAILogo className={className} />
  }

  if (kind === "claude") {
    return <ClaudeLogo className={className} />
  }

  if (kind === "codex") {
    return <CodexLogo className={className} />
  }

  return <Circle className={className} />
}

export function getModelLogoKind(value: string, selectedHarnessId: "codex" | "claude-code" | null): ModelLogoKind {
  const normalized = value.toLowerCase()

  if (normalized.includes("claude")) {
    return "claude"
  }

  if (
    normalized.includes("gpt") ||
    normalized.includes("openai") ||
    normalized.includes("codex") ||
    /^o\d/.test(normalized) ||
    /^o[1-9]-/.test(normalized)
  ) {
    return "openai"
  }

  if (selectedHarnessId === "claude-code") {
    return "claude"
  }

  if (selectedHarnessId === "codex") {
    return "codex"
  }

  return "default"
}

export function getHarnessLogoKind(harnessId: "codex" | "claude-code"): ModelLogoKind {
  return harnessId === "claude-code" ? "claude" : "openai"
}
