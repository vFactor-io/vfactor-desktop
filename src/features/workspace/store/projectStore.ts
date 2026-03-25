import { create } from "zustand"
import { desktop, loadDesktopStore, type DesktopStoreHandle } from "@/desktop/client"
import type { Project } from "../types"

const STORE_FILE = "projects.json"
const STORE_KEY = "projects"
const DEFAULT_LOCATION_KEY = "defaultLocation"
const SELECTED_PROJECT_KEY = "selectedProjectId"

interface ProjectState {
  projects: Project[]
  selectedProjectId: string | null
  defaultLocation: string
  isLoading: boolean

  // Actions
  loadProjects: () => Promise<void>
  addProject: (path: string, name?: string) => Promise<void>
  removeProject: (id: string) => Promise<void>
  setProjectOrder: (projects: Project[]) => Promise<void>
  selectProject: (id: string) => Promise<void>
  updateProject: (id: string, updates: Partial<Pick<Project, "name">>) => Promise<void>
  setDefaultLocation: (path: string) => Promise<void>
}

let storeInstance: DesktopStoreHandle | null = null

async function getStore(): Promise<DesktopStoreHandle> {
  if (!storeInstance) {
    storeInstance = await loadDesktopStore(STORE_FILE)
  }
  return storeInstance
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  defaultLocation: "",
  isLoading: true,

  loadProjects: async () => {
    try {
      const store = await getStore()
      const persisted = await store.get<Project[]>(STORE_KEY)
      const savedLocation = await store.get<string>(DEFAULT_LOCATION_KEY)
      const savedSelectedId = await store.get<string>(SELECTED_PROJECT_KEY)

      // Get default location: saved value, or fall back to home directory
      let defaultLoc = savedLocation || ""
      if (!defaultLoc) {
        try {
          defaultLoc = await desktop.fs.homeDir()
        } catch {
          defaultLoc = ""
        }
      }

      if (persisted && Array.isArray(persisted)) {
        const projects = persisted

        // Restore saved selection if valid, otherwise select first project
        const validSelectedId = savedSelectedId && projects.some(p => p.id === savedSelectedId)
          ? savedSelectedId
          : projects.length > 0 ? projects[0].id : null

        set({
          projects,
          defaultLocation: defaultLoc,
          isLoading: false,
          selectedProjectId: validSelectedId,
        })
      } else {
        set({ projects: [], defaultLocation: defaultLoc, isLoading: false })
      }
    } catch (error) {
      console.error("Failed to load projects:", error)
      set({ projects: [], defaultLocation: "", isLoading: false })
    }
  },

  addProject: async (path: string, name?: string) => {
    const { projects } = get()

    // Check if project with this path already exists
    if (projects.some((p) => p.path === path)) {
      console.warn("Project already exists:", path)
      return
    }

    // Use provided name or extract folder name from path
    const projectName = name || path.split("/").pop() || path

    const newProject: Project = {
      id: crypto.randomUUID(),
      name: projectName,
      path,
      addedAt: Date.now(),
    }

    const updatedProjects = [newProject, ...projects]

    // Persist to the desktop store
    const store = await getStore()
    await store.set(STORE_KEY, updatedProjects)
    await store.save()

    set({
      projects: updatedProjects,
      selectedProjectId: newProject.id, // Auto-select new project
    })
  },

  removeProject: async (id: string) => {
    const { projects, selectedProjectId } = get()
    const updatedProjects = projects.filter((p) => p.id !== id)

    let newSelectedId = selectedProjectId
    if (selectedProjectId === id) {
      newSelectedId = updatedProjects.length > 0 ? updatedProjects[0].id : null
    }

    const store = await getStore()
    await store.set(STORE_KEY, updatedProjects)
    await store.set(SELECTED_PROJECT_KEY, newSelectedId)
    await store.save()

    set({ projects: updatedProjects, selectedProjectId: newSelectedId })
  },

  setProjectOrder: async (projects: Project[]) => {
    const store = await getStore()
    await store.set(STORE_KEY, projects)
    await store.save()

    set({ projects })
  },

  selectProject: async (id: string) => {
    set({ selectedProjectId: id })

    void (async () => {
      try {
        const store = await getStore()
        await store.set(SELECTED_PROJECT_KEY, id)
        await store.save()
      } catch (error) {
        console.error("Failed to persist selected project:", error)
      }
    })()
  },

  updateProject: async (id, updates) => {
    const { projects } = get()
    const updatedProjects = projects.map((project) =>
      project.id === id
        ? {
            ...project,
            ...updates,
            name: updates.name?.trim() ? updates.name.trim() : project.name,
          }
        : project
    )

    const store = await getStore()
    await store.set(STORE_KEY, updatedProjects)
    await store.save()

    set({ projects: updatedProjects })
  },

  setDefaultLocation: async (path: string) => {
    const store = await getStore()
    await store.set(DEFAULT_LOCATION_KEY, path)
    await store.save()
    set({ defaultLocation: path })
  },
}))
