import { createContext } from "react"

export interface RightSidebarContextValue {
  isCollapsed: boolean
  width: number
  toggle: () => void
  expand: () => void
  collapse: () => void
  setWidth: (width: number) => void
}

export const RightSidebarContext = createContext<RightSidebarContextValue | null>(null)
