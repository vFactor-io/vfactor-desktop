import { createContext } from "react"

export interface SidebarContextValue {
  isCollapsed: boolean
  width: number
  toggle: () => void
  expand: () => void
  collapse: () => void
  setWidth: (width: number) => void
}

export const SidebarContext = createContext<SidebarContextValue | null>(null)
