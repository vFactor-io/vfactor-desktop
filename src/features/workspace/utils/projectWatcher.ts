import { desktop, type ProjectFileSystemEvent } from "@/desktop/client"

type UnlistenFn = () => void

export async function startProjectFileWatcher(projectPath: string): Promise<void> {
  await desktop.watcher.start(projectPath)
}

export async function stopProjectFileWatcher(): Promise<void> {
  await desktop.watcher.stop()
}

export function listenToProjectFileEvents(
  listener: (event: ProjectFileSystemEvent) => void
): Promise<UnlistenFn> {
  return Promise.resolve(desktop.watcher.onEvent(listener))
}
