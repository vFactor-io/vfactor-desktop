import { desktop } from "@/desktop/client"

/**
 * Opens a native folder picker dialog
 * @returns The selected folder path, or null if cancelled
 */
export async function openFolderPicker(): Promise<string | null> {
  try {
    return await desktop.dialog.openProjectFolder()
  } catch (error) {
    console.error("Failed to open folder picker:", error)
    return null
  }
}
