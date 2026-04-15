import { Circle } from "@/components/icons"
import { cn } from "@/lib/utils"
import claudeColorUrl from "@/assets/brands/claude-color.svg"
import codexColorUrl from "@/assets/brands/codex.svg"
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
    <span className={cn("relative inline-flex shrink-0", className)} aria-hidden="true">
      <img src={claudeColorUrl} alt="" className="size-full scale-[0.84] object-contain" />
    </span>
  )
}

function CodexLogo({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} aria-hidden="true">
      <img src={codexColorUrl} alt="" className="size-full scale-[0.84] object-contain brightness-0 invert" />
    </span>
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
    /^o\d/.test(normalized) ||
    /^o[1-9]-/.test(normalized)
  ) {
    return "openai"
  }

  if (normalized.includes("codex")) {
    return "codex"
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
  return harnessId === "claude-code" ? "claude" : "codex"
}
