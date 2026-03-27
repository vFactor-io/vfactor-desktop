import { useContext } from "react"
import { RightSidebarContext } from "./right-sidebar-context"

export function useRightSidebar() {
  const context = useContext(RightSidebarContext)
  if (!context) {
    throw new Error("useRightSidebar must be used within a RightSidebarProvider")
  }
  return context
}
