import chokidar, { type FSWatcher } from "chokidar"
import { basename, join, relative } from "node:path"
import type { ProjectFileSystemEvent } from "../../src/desktop/contracts"
import { EVENT_CHANNELS } from "../ipc/channels"
import { resolveGitDirectory } from "./git"

type EventSender = (channel: string, payload: unknown) => void

const GIT_METADATA_RESYNC_MS = 75

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
  private gitWatcher: FSWatcher | null = null
  private activePath: string | null = null
  private pendingUnlink: PendingUnlink | null = null
  private gitRescanTimeout: ReturnType<typeof setTimeout> | null = null

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

    const scheduleGitRescan = () => {
      if (this.gitRescanTimeout) {
        clearTimeout(this.gitRescanTimeout)
      }

      this.gitRescanTimeout = setTimeout(() => {
        this.gitRescanTimeout = null
        emit(createRescanEvent(projectPath))
      }, GIT_METADATA_RESYNC_MS)
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

    try {
      const gitDir = await resolveGitDirectory(projectPath)
      const gitMetadataPaths = [
        join(gitDir, "HEAD"),
        join(gitDir, "packed-refs"),
        join(gitDir, "refs", "heads"),
        join(gitDir, "refs", "remotes"),
      ]

      this.gitWatcher = chokidar.watch(gitMetadataPaths, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 10,
        },
      })

      this.gitWatcher
        .on("all", () => {
          scheduleGitRescan()
        })
        .on("error", (error) => {
          console.warn("[watcher] Git metadata watcher error:", error)
          emit(createRescanEvent(projectPath))
        })
    } catch (error) {
      console.warn("[watcher] Failed to resolve git metadata path:", error)
    }

    this.activePath = projectPath
  }

  async stop(): Promise<void> {
    if (this.gitRescanTimeout) {
      clearTimeout(this.gitRescanTimeout)
      this.gitRescanTimeout = null
    }

    if (this.pendingUnlink) {
      clearTimeout(this.pendingUnlink.timer)
      this.pendingUnlink = null
    }

    if (this.gitWatcher) {
      await this.gitWatcher.close()
    }

    if (this.watcher) {
      await this.watcher.close()
    }

    this.gitWatcher = null
    this.watcher = null
    this.activePath = null
  }
}
