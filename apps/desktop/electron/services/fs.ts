import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path"
import type {
  CopyPathsIntoDirectoryOptions,
  DesktopDirEntry,
  ReadFileAsDataUrlOptions,
  WriteTextFileOptions,
} from "../../src/desktop/contracts"

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

export class DesktopFsService {
  private decodeDataUrl(dataUrl: string): Buffer {
    const match = dataUrl.match(/^data:[^;,]+(?:;charset=[^;,]+)?;base64,(.+)$/)

    if (!match) {
      throw new Error("Invalid data URL. Expected a base64-encoded data URL.")
    }

    return Buffer.from(match[1], "base64")
  }

  async readTextFile(path: string): Promise<string> {
    return readFile(path, "utf8")
  }

  async readFileAsDataUrl(path: string, options?: ReadFileAsDataUrlOptions): Promise<string> {
    const file = await readFile(path)
    const extension = extname(path).toLowerCase()
    const mimeType =
      options?.mimeType ?? MIME_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream"

    return `data:${mimeType};base64,${file.toString("base64")}`
  }

  async writeTextFile(
    path: string,
    content: string,
    _options?: WriteTextFileOptions
  ): Promise<void> {
    await writeFile(path, content, "utf8")
  }

  async writeDataUrlFile(path: string, dataUrl: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, this.decodeDataUrl(dataUrl))
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  async readDir(path: string): Promise<DesktopDirEntry[]> {
    const entries = await readdir(path, { withFileTypes: true })

    return Promise.all(
      entries.map(async (entry) => {
        const entryPath = `${path}/${entry.name}`
        const entryStats = await stat(entryPath).catch(() => null)

        return {
          name: entry.name,
          path: entryPath,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          sizeBytes: entryStats?.isFile() ? entryStats.size : undefined,
          modifiedAt: entryStats?.mtimeMs,
        }
      })
    )
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(path, { recursive: options?.recursive ?? false })
  }

  async removePath(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void> {
    await rm(path, {
      recursive: options?.recursive ?? false,
      force: options?.force ?? false,
    })
  }

  async copyPathsIntoDirectory(
    sourcePaths: string[],
    targetDirectory: string,
    options?: CopyPathsIntoDirectoryOptions
  ): Promise<void> {
    const resolvedTargetDirectory = resolve(targetDirectory)
    const targetStats = await stat(resolvedTargetDirectory)

    if (!targetStats.isDirectory()) {
      throw new Error("Drop target must be a directory.")
    }

    const allowOverwrite = options?.overwrite ?? false

    for (const sourcePath of sourcePaths) {
      const resolvedSourcePath = resolve(sourcePath)
      const sourceName = basename(resolvedSourcePath)
      const destinationPath = join(resolvedTargetDirectory, sourceName)
      const relativeTargetPath = relative(resolvedSourcePath, resolvedTargetDirectory)
      const isCopyingIntoSelf =
        relativeTargetPath === "" ||
        (!relativeTargetPath.startsWith(`..${sep}`) && relativeTargetPath !== "..")

      if (isCopyingIntoSelf) {
        throw new Error(`Can't copy ${sourceName} into itself.`)
      }

      if (!allowOverwrite && (await this.exists(destinationPath))) {
        throw new Error(`${sourceName} already exists in ${resolvedTargetDirectory}.`)
      }

      await cp(resolvedSourcePath, destinationPath, {
        recursive: true,
        force: allowOverwrite,
        errorOnExist: !allowOverwrite,
      })
    }
  }

  async homeDir(): Promise<string> {
    return os.homedir()
  }
}
