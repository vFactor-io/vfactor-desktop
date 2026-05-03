import type { Icon } from "@/components/icons"
import {
  CaretLeft,
  Bell,
  Eye,
  GitBranch,
  Refresh,
} from "@/components/icons"
import { listHarnesses } from "@/features/chat/runtime/harnesses"
import type { HarnessId } from "@/features/chat/types"
import { getHarnessLogoKind, type ModelLogoKind } from "@/features/chat/components/ModelLogo"

export type SettingsSectionId =
  | "appearance"
  | "notifications"
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
  id: "general" | "harnesses"
  label?: string
  sections: SettingsSectionDefinition[]
}

export const SETTINGS_BACK_ICON = CaretLeft

export const SETTINGS_SECTION_GROUPS: SettingsSectionGroup[] = [
  {
    id: "general",
    sections: [
      { id: "appearance", label: "Appearance", icon: Eye },
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "git", label: "Git", icon: GitBranch },
      { id: "updates", label: "Updates", icon: Refresh },
    ],
  },
  {
    id: "harnesses",
    label: "Harnesses",
    sections: listHarnesses().map((harness) => ({
      id: harness.id,
      label: harness.label,
      logoKind: getHarnessLogoKind(harness.id),
    })),
  },
]
