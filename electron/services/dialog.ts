import { dialog, type BrowserWindow } from "electron"

export class DialogService {
  async openProjectFolder(window: BrowserWindow): Promise<string | null> {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "Select Project Folder",
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0] ?? null
  }
}
