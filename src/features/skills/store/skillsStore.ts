import { create } from "zustand"
import { desktop } from "@/desktop/client"
import type { ManagedSkill, SkillsSyncResponse } from "../types"

interface SkillsState {
  managedRootPath: string | null
  installedSkills: ManagedSkill[]
  isLoading: boolean
  hasLoaded: boolean
  error: string | null
  loadSkills: () => Promise<void>
}

export const useSkillsStore = create<SkillsState>((set) => ({
  managedRootPath: null,
  installedSkills: [],
  isLoading: false,
  hasLoaded: false,
  error: null,

  loadSkills: async () => {
    set((state) => ({
      ...state,
      isLoading: true,
      error: null,
    }))

    try {
      const response = await desktop.skills.list()

      set({
        managedRootPath: response.managedRootPath,
        installedSkills: response.skills,
        isLoading: false,
        hasLoaded: true,
        error: null,
      })
    } catch (error) {
      console.error("[skillsStore] Failed to load managed skills:", error)
      set({
        isLoading: false,
        hasLoaded: true,
        error: String(error),
      })
    }
  },
}))
