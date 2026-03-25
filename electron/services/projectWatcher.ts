import chokidar, { type FSWatcher } from "chokidar"
import { basename, relative } from "node:path"
import type { ProjectFileSystemEvent } from "../../src/desktop/contracts"
import { EVENT_CHANNELS } from "../ipc/channels"

type EventSender = (channel: string, payload: unknown) => void

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  ".ruff_cache",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  ".venv",
  "venv",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  ".nyc_output",
  "target",
  ".cargo",
])

interface PendingUnlink {
  path: string
  isDirectory: boolean
  timer: ReturnType<typeof setTimeout>
}

function shouldIgnorePath(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath)
  if (!relativePath || relativePath.startsWith("..")) {
    return false
  }

  const segments = relativePath.split(/[/\\]+/).filter(Boolean)
  return segments.some((segment, index) => {
    if (index === segments.length - 1) {
      return false
    }

    return IGNORED_DIRECTORIES.has(segment)
  }) || IGNORED_DIRECTORIES.has(basename(candidatePath))
}

function createRescanEvent(rootPath: string): ProjectFileSystemEvent {
  return {
    rootPath,
    kind: "rescan",
    path: rootPath,
    oldPath: null,
    isDirectory: true,
    requiresRescan: true,
  }
}

export class ProjectWatcherService {
  private watcher: FSWatcher | null = null
  private activePath: string | null = null
  private pendingUnlink: PendingUnlink | null = null

  constructor(private readonly sendEvent: EventSender) {}

  async start(projectPath: string): Promise<void> {
    if (this.activePath === projectPath && this.watcher) {
      return
    }

    await this.stop()

    const watcher = chokidar.watch(projectPath, {
      ignoreInitial: true,
      ignored: (candidatePath) => shouldIgnorePath(projectPath, candidatePath),
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 10,
      },
    })

    const emit = (payload: ProjectFileSystemEvent) => {
      this.sendEvent(EVENT_CHANNELS.projectFs, payload)
    }

    const flushPendingUnlink = () => {
      if (!this.pendingUnlink) {
        return
      }

      const pending = this.pendingUnlink
      this.pendingUnlink = null
      clearTimeout(pending.timer)

      emit({
        rootPath: projectPath,
        kind: "unlink",
        path: pending.path,
        oldPath: null,
        isDirectory: pending.isDirectory,
        requiresRescan: false,
      })
    }

    watcher
      .on("add", (path) => {
        if (this.pendingUnlink) {
          const previous = this.pendingUnlink
          this.pendingUnlink = null
          clearTimeout(previous.timer)

          emit({
            rootPath: projectPath,
            kind: "rename",
            path,
            oldPath: previous.path,
            isDirectory: false,
            requiresRescan: false,
          })
          return
        }

        emit({
          rootPath: projectPath,
          kind: "add",
          path,
          oldPath: null,
          isDirectory: false,
          requiresRescan: false,
        })
      })
      .on("addDir", (path) => {
        emit({
          rootPath: projectPath,
          kind: "add",
          path,
          oldPath: null,
          isDirectory: true,
          requiresRescan: false,
        })
      })
      .on("change", (path) => {
        flushPendingUnlink()
        emit({
          rootPath: projectPath,
          kind: "modify",
          path,
          oldPath: null,
          isDirectory: false,
          requiresRescan: false,
        })
      })
      .on("unlink", (path) => {
        if (this.pendingUnlink) {
          flushPendingUnlink()
        }

        const timer = setTimeout(() => {
          flushPendingUnlink()
        }, 150)

        this.pendingUnlink = {
          path,
          isDirectory: false,
          timer,
        }
      })
      .on("unlinkDir", (path) => {
        emit({
          rootPath: projectPath,
          kind: "unlink",
          path,
          oldPath: null,
          isDirectory: true,
          requiresRescan: false,
        })
      })
      .on("error", (error) => {
        console.warn("[watcher] Project filesystem watcher error:", error)
        emit(createRescanEvent(projectPath))
      })

    this.watcher = watcher
    this.activePath = projectPath
  }

  async stop(): Promise<void> {
    if (this.pendingUnlink) {
      clearTimeout(this.pendingUnlink.timer)
      this.pendingUnlink = null
    }

    if (this.watcher) {
      await this.watcher.close()
    }

    this.watcher = null
    this.activePath = null
  }
}
