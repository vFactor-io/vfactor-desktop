import type { Icon } from "@/components/icons"
import {
  CaretLeft,
  GitBranch,
  Refresh,
} from "@/components/icons"
import { listHarnesses } from "@/features/chat/runtime/harnesses"
import type { HarnessId } from "@/features/chat/types"
import type { ModelLogoKind } from "@/features/chat/components/ModelLogo"

export type SettingsSectionId =
  | "git"
  | "updates"
  | HarnessId

export interface SettingsSectionDefinition {
  id: SettingsSectionId
  label: string
  icon?: Icon
  logoKind?: ModelLogoKind
}

export interface SettingsSectionGroup {
  id: "general" | "agents"
  label?: string
  sections: SettingsSectionDefinition[]
}

export const SETTINGS_BACK_ICON = CaretLeft

export const SETTINGS_SECTION_GROUPS: SettingsSectionGroup[] = [
  {
    id: "general",
    sections: [
      { id: "git", label: "Git", icon: GitBranch },
      { id: "updates", label: "Updates", icon: Refresh },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    sections: listHarnesses().map((harness) => ({
      id: harness.id,
      label: harness.label,
      logoKind: harness.id === "claude-code" ? "claude" : "codex",
    })),
  },
]
