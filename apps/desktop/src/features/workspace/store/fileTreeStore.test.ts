import { beforeEach, describe, expect, mock, test } from "bun:test"

import type { FileTreeItem } from "@/features/version-control/types"

const projectTrees = new Map<string, Record<string, FileTreeItem>>()
const readCounts = new Map<string, number>()
const queuedReadWaits = new Map<string, Promise<void>[]>()
const startWatcherCalls: string[] = []
let stopWatcherCallCount = 0

mock.module("@/features/workspace/utils/fileSystem", () => ({
  readProjectFiles: async (projectPath: string) => {
    readCounts.set(projectPath, (readCounts.get(projectPath) ?? 0) + 1)

    const waits = queuedReadWaits.get(projectPath)
    const nextWait = waits?.shift()
    if (waits && waits.length === 0) {
      queuedReadWaits.delete(projectPath)
    }
    if (nextWait) {
      await nextWait
    }

    return structuredClone(projectTrees.get(projectPath) ?? {})
  },
  readProjectSubtree: async () => ({}),
  shouldIgnoreFileSystemEntry: () => false,
}))

mock.module("@/features/workspace/utils/projectWatcher", () => ({
  startProjectFileWatcher: async (projectPath: string) => {
    startWatcherCalls.push(projectPath)
  },
  stopProjectFileWatcher: async () => {
    stopWatcherCallCount += 1
  },
  listenToProjectFileEvents: async (_listener: (event: { rootPath: string }) => void) => () => {},
}))

const { useFileTreeStore } = await import("./fileTreeStore")

function createTree(projectPath: string, names: string[]): Record<string, FileTreeItem> {
  const children = names.map((name) => `${projectPath}/${name}`)

  return {
    root: {
      name: projectPath.split("/").pop() || "root",
      isDirectory: true,
      children,
    },
    ...Object.fromEntries(
      names.map((name) => [
        `${projectPath}/${name}`,
        {
          name,
          isDirectory: false,
        },
      ])
    ),
  }
}

function resetStoreState() {
  useFileTreeStore.setState({
    activeProjectPath: null,
    dataByProjectPath: {},
    loadedByProjectPath: {},
    loadingByProjectPath: {},
    lastEventByProjectPath: {},
    staleByProjectPath: {},
    isInitialized: false,
  })
}

function queueReadWait(projectPath: string): () => void {
  let release!: () => void
  const waitPromise = new Promise<void>((resolve) => {
    release = resolve
  })
  const existing = queuedReadWaits.get(projectPath) ?? []
  existing.push(waitPromise)
  queuedReadWaits.set(projectPath, existing)
  return release
}

describe("fileTreeStore", () => {
  beforeEach(() => {
    projectTrees.clear()
    readCounts.clear()
    queuedReadWaits.clear()
    startWatcherCalls.length = 0
    stopWatcherCallCount = 0
    resetStoreState()
  })

  test("reloads a primed tree when the project becomes active", async () => {
    const projectPath = "/tmp/project-alpha"
    projectTrees.set(projectPath, createTree(projectPath, ["before.ts"]))

    await useFileTreeStore.getState().primeProjectPath(projectPath)

    expect(readCounts.get(projectPath)).toBe(1)

    projectTrees.set(projectPath, createTree(projectPath, ["after.ts"]))

    await useFileTreeStore.getState().setActiveProjectPath(projectPath)

    expect(startWatcherCalls).toEqual([projectPath])
    expect(readCounts.get(projectPath)).toBe(2)
    expect(useFileTreeStore.getState().dataByProjectPath[projectPath]).toEqual(
      createTree(projectPath, ["after.ts"])
    )
    expect(useFileTreeStore.getState().staleByProjectPath[projectPath]).toBe(false)
  })

  test("reloads a previously active tree after switching back to it", async () => {
    const alphaPath = "/tmp/project-alpha"
    const betaPath = "/tmp/project-beta"
    projectTrees.set(alphaPath, createTree(alphaPath, ["one.ts"]))
    projectTrees.set(betaPath, createTree(betaPath, ["beta.ts"]))

    await useFileTreeStore.getState().setActiveProjectPath(alphaPath)
    await useFileTreeStore.getState().setActiveProjectPath(betaPath)

    projectTrees.set(alphaPath, createTree(alphaPath, ["two.ts"]))

    await useFileTreeStore.getState().setActiveProjectPath(alphaPath)

    expect(readCounts.get(alphaPath)).toBe(2)
    expect(readCounts.get(betaPath)).toBe(1)
    expect(useFileTreeStore.getState().dataByProjectPath[alphaPath]).toEqual(
      createTree(alphaPath, ["two.ts"])
    )
    expect(useFileTreeStore.getState().staleByProjectPath[alphaPath]).toBe(false)
    expect(useFileTreeStore.getState().staleByProjectPath[betaPath]).toBe(true)
    expect(stopWatcherCallCount).toBe(0)
  })

  test("forces a fresh reload when activation races with a priming load", async () => {
    const projectPath = "/tmp/project-alpha"
    const releasePrimingRead = queueReadWait(projectPath)
    projectTrees.set(projectPath, createTree(projectPath, ["before.ts"]))

    const primingPromise = useFileTreeStore.getState().primeProjectPath(projectPath)

    while ((readCounts.get(projectPath) ?? 0) === 0) {
      await Promise.resolve()
    }

    projectTrees.set(projectPath, createTree(projectPath, ["after.ts"]))

    const activationPromise = useFileTreeStore.getState().setActiveProjectPath(projectPath)

    releasePrimingRead()

    await primingPromise
    await activationPromise

    expect(startWatcherCalls).toEqual([projectPath])
    expect(readCounts.get(projectPath)).toBe(2)
    expect(useFileTreeStore.getState().dataByProjectPath[projectPath]).toEqual(
      createTree(projectPath, ["after.ts"])
    )
    expect(useFileTreeStore.getState().staleByProjectPath[projectPath]).toBe(false)
  })

  test("lets the latest project activation win during rapid switching", async () => {
    const alphaPath = "/tmp/project-alpha"
    const betaPath = "/tmp/project-beta"
    const gammaPath = "/tmp/project-gamma"
    const releaseAlphaRead = queueReadWait(alphaPath)
    const releaseBetaRead = queueReadWait(betaPath)

    projectTrees.set(alphaPath, createTree(alphaPath, ["alpha.ts"]))
    projectTrees.set(betaPath, createTree(betaPath, ["beta.ts"]))
    projectTrees.set(gammaPath, createTree(gammaPath, ["gamma.ts"]))

    const alphaPromise = useFileTreeStore.getState().setActiveProjectPath(alphaPath)

    while ((readCounts.get(alphaPath) ?? 0) === 0) {
      await Promise.resolve()
    }

    const betaPromise = useFileTreeStore.getState().setActiveProjectPath(betaPath)

    while ((readCounts.get(betaPath) ?? 0) === 0) {
      await Promise.resolve()
    }

    const gammaPromise = useFileTreeStore.getState().setActiveProjectPath(gammaPath)

    await gammaPromise

    expect(useFileTreeStore.getState().activeProjectPath).toBe(gammaPath)
    expect(useFileTreeStore.getState().dataByProjectPath[gammaPath]).toEqual(
      createTree(gammaPath, ["gamma.ts"])
    )
    expect(useFileTreeStore.getState().staleByProjectPath[gammaPath]).toBe(false)

    releaseAlphaRead()
    releaseBetaRead()
    await Promise.all([alphaPromise, betaPromise])

    expect(useFileTreeStore.getState().activeProjectPath).toBe(gammaPath)
    expect(useFileTreeStore.getState().dataByProjectPath[gammaPath]).toEqual(
      createTree(gammaPath, ["gamma.ts"])
    )
    expect(useFileTreeStore.getState().staleByProjectPath[gammaPath]).toBe(false)
  })
})
