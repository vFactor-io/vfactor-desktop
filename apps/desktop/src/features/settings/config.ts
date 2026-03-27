import type { Icon } from "@/components/icons"
import {
  CaretLeft,
  GitBranch,
  Refresh,
} from "@/components/icons"

export type SettingsSectionId =
  | "git"
  | "updates"

export interface SettingsSectionDefinition {
  id: SettingsSectionId
  label: string
  icon: Icon
}

export const SETTINGS_BACK_ICON = CaretLeft

export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  { id: "git", label: "Git", icon: GitBranch },
  { id: "updates", label: "Updates", icon: Refresh },
]
