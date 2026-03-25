import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import { basename, join, relative, resolve, sep } from "node:path"
import type {
  CopyPathsIntoDirectoryOptions,
  DesktopDirEntry,
  WriteTextFileOptions,
} from "../../src/desktop/contracts"

export class DesktopFsService {
  async readTextFile(path: string): Promise<string> {
    return readFile(path, "utf8")
  }

  async writeTextFile(
    path: string,
    content: string,
    _options?: WriteTextFileOptions
  ): Promise<void> {
    await writeFile(path, content, "utf8")
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

    return entries.map((entry) => ({
      name: entry.name,
      path: `${path}/${entry.name}`,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }))
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(path, { recursive: options?.recursive ?? false })
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
