import { createContext } from "react"

export type RightSidebarTab = "files" | "changes" | "checks" | "browser"

export interface RightSidebarContextValue {
  isAvailable: boolean
  isCollapsed: boolean
  width: number
  activeTab: RightSidebarTab
  toggle: () => void
  expand: () => void
  collapse: () => void
  clampWidth: (width: number) => number
  setWidth: (width: number) => void
  persistWidth: () => void
  setActiveTab: (tab: RightSidebarTab) => void
}

export const RightSidebarContext = createContext<RightSidebarContextValue | null>(null)
