import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MutableRefObject,
} from "react"
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical"
import { desktop } from "@/desktop/client"
import { $createUploadChipNode } from "../UploadChipNode"
import {
  collectAttachmentIdsFromComposerValue,
  createDraftAttachment,
  isLargeTextPaste,
  type DraftChatAttachment,
} from "./attachments"

export function useComposerAttachments({
  attachments,
  editorRef,
  isComposerLocked,
  isPromptActive,
  selectedWorktreePath,
  stageWithoutGit = false,
  setAttachments,
  focusComposer,
}: {
  attachments: DraftChatAttachment[]
  editorRef: MutableRefObject<LexicalEditor | null>
  isComposerLocked: boolean
  isPromptActive: boolean
  selectedWorktreePath?: string | null
  stageWithoutGit?: boolean
  setAttachments: (attachments: DraftChatAttachment[]) => void
  focusComposer: () => void
}) {
  const [uploadError, setUploadError] = useState<string | null>(null)
  const latestAttachmentsRef = useRef<DraftChatAttachment[]>(attachments)
  const submittedAttachmentIdsRef = useRef<Set<string>>(new Set())

  const removeDraftAttachmentsFromDisk = useCallback(async (removedAttachments: DraftChatAttachment[]) => {
    await Promise.all(
      removedAttachments.map(async (attachment) => {
        try {
          await desktop.fs.removePath(attachment.absolutePath, { force: true })
        } catch (error) {
          console.warn("[chat] Failed to remove staged attachment:", attachment.absolutePath, error)
        }
      })
    )
  }, [])

  const insertAttachmentChips = useCallback(
    (nextAttachments: DraftChatAttachment[]) => {
      const editor = editorRef.current

      if (!editor || nextAttachments.length === 0) {
        return
      }

      editor.update(() => {
        let selection = $getSelection()

        if (!$isRangeSelection(selection)) {
          $getRoot().selectEnd()
          selection = $getSelection()
        }

        if (!$isRangeSelection(selection)) {
          return
        }

        for (const attachment of nextAttachments) {
          selection.insertNodes([
            $createUploadChipNode(attachment.id, attachment.kind, attachment.label),
            $createTextNode(" "),
          ])
        }
      })
    },
    [editorRef]
  )

  const appendDraftAttachments = useCallback(
    (nextAttachments: DraftChatAttachment[]) => {
      if (nextAttachments.length === 0) {
        return
      }

      setUploadError(null)
      const mergedAttachments = [...latestAttachmentsRef.current, ...nextAttachments]
      latestAttachmentsRef.current = mergedAttachments
      setAttachments(mergedAttachments)
      requestAnimationFrame(() => {
        focusComposer()
        insertAttachmentChips(nextAttachments)
      })
    },
    [focusComposer, insertAttachmentChips, setAttachments]
  )

  const ensureAttachmentStageRoot = useCallback(async () => {
    if (!selectedWorktreePath) {
      throw new Error("Select a project workspace before adding uploads.")
    }

    if (!stageWithoutGit) {
      await desktop.git.ensureInfoExcludeEntries(selectedWorktreePath, ["/.vfactor/"])
    }
    return selectedWorktreePath
  }, [selectedWorktreePath, stageWithoutGit])

  const readBrowserFileAsDataUrl = useCallback((file: Blob) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()

      reader.onerror = () => {
        reject(new Error("Failed to read the selected file."))
      }
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result)
          return
        }

        reject(new Error("Failed to read the selected file."))
      }

      reader.readAsDataURL(file)
    })
  }, [])

  const stageDataUrlAttachment = useCallback(
    async ({
      kind,
      label,
      fileName,
      dataUrl,
      mediaType,
      sizeBytes,
    }: {
      kind: DraftChatAttachment["kind"]
      label: string
      fileName: string
      dataUrl: string
      mediaType?: string
      sizeBytes?: number
    }) => {
      const worktreePath = await ensureAttachmentStageRoot()
      const attachment = createDraftAttachment({
        kind,
        label,
        worktreePath,
        fileName,
        mediaType,
        sizeBytes,
      })

      await desktop.fs.writeDataUrlFile(attachment.absolutePath, dataUrl)
      return attachment
    },
    [ensureAttachmentStageRoot]
  )

  const stageTextAttachment = useCallback(
    async (text: string) => {
      const worktreePath = await ensureAttachmentStageRoot()
      const attachment = createDraftAttachment({
        kind: "pasted_text",
        label: "Pasted text",
        worktreePath,
        fileName: "pasted-text.txt",
        mediaType: "text/plain",
        sizeBytes: new TextEncoder().encode(text).length,
      })

      await desktop.fs.writeTextFile(attachment.absolutePath, text)
      return attachment
    },
    [ensureAttachmentStageRoot]
  )

  const stageBrowserFiles = useCallback(
    async (files: File[]) => {
      const stagedAttachments: DraftChatAttachment[] = []

      for (const file of files) {
        const sourcePath = desktop.fs.getPathForFile(file)
        const dataUrl = sourcePath
          ? await desktop.fs.readFileAsDataUrl(sourcePath, {
              mimeType: file.type || undefined,
            })
          : await readBrowserFileAsDataUrl(file)
        const kind = file.type.startsWith("image/") ? "image" : "file"
        const attachment = await stageDataUrlAttachment({
          kind,
          label: file.name,
          fileName: file.name,
          dataUrl,
          mediaType: file.type || undefined,
          sizeBytes: file.size,
        })

        stagedAttachments.push(attachment)
      }

      return stagedAttachments
    },
    [readBrowserFileAsDataUrl, stageDataUrlAttachment]
  )

  const reconcileDraftAttachments = useCallback(
    (nextValue: string) => {
      const retainedIds = new Set(collectAttachmentIdsFromComposerValue(nextValue))
      const removedAttachments = attachments.filter((attachment) => !retainedIds.has(attachment.id))

      if (removedAttachments.length === 0) {
        return
      }

      const submittedIds = submittedAttachmentIdsRef.current
      const attachmentsToDelete = removedAttachments.filter(
        (attachment) => !submittedIds.has(attachment.id)
      )

      const nextAttachments = attachments.filter((attachment) => retainedIds.has(attachment.id))
      latestAttachmentsRef.current = nextAttachments
      setAttachments(nextAttachments)

      if (attachmentsToDelete.length > 0) {
        void removeDraftAttachmentsFromDisk(attachmentsToDelete)
      }

      if (removedAttachments.some((attachment) => submittedIds.has(attachment.id))) {
        submittedAttachmentIdsRef.current = new Set()
      }
    },
    [attachments, removeDraftAttachmentsFromDisk, setAttachments]
  )

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return
      }

      try {
        const stagedAttachments = await stageBrowserFiles(files)
        appendDraftAttachments(stagedAttachments)
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to stage the selected upload."
        setUploadError(message)
      }
    },
    [appendDraftAttachments, stageBrowserFiles]
  )

  const handleUploadInputChange = useCallback(
    async (event: ReactChangeEvent<HTMLInputElement>) => {
      const nextFiles = Array.from(event.target.files ?? [])
      event.target.value = ""
      await handleUploadFiles(nextFiles)
    },
    [handleUploadFiles]
  )

  const handleComposerPaste = useCallback(
    async (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (isComposerLocked || isPromptActive) {
        return
      }

      const clipboardItems = Array.from(event.clipboardData.items)
      const imageItem = clipboardItems.find((item) => item.type.startsWith("image/"))

      if (imageItem) {
        const imageFile = imageItem.getAsFile()
        if (!imageFile) {
          return
        }

        event.preventDefault()

        try {
          const dataUrl = await readBrowserFileAsDataUrl(imageFile)
          const attachment = await stageDataUrlAttachment({
            kind: "image",
            label: "Pasted image",
            fileName: "pasted-image.png",
            dataUrl,
            mediaType: "image/png",
            sizeBytes: imageFile.size,
          })

          appendDraftAttachments([attachment])
        } catch (error) {
          setUploadError(
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Failed to stage the pasted image."
          )
        }
        return
      }

      const plainText = event.clipboardData.getData("text/plain")
      if (!plainText || !isLargeTextPaste(plainText)) {
        return
      }

      event.preventDefault()

      try {
        const attachment = await stageTextAttachment(plainText)
        appendDraftAttachments([attachment])
      } catch (error) {
        setUploadError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to stage the pasted text."
        )
      }
    },
    [
      appendDraftAttachments,
      isComposerLocked,
      isPromptActive,
      readBrowserFileAsDataUrl,
      stageDataUrlAttachment,
      stageTextAttachment,
    ]
  )

  const handleComposerDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.files.length === 0) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])

  const handleComposerDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      if (event.dataTransfer.files.length === 0) {
        return
      }

      event.preventDefault()
      await handleUploadFiles(Array.from(event.dataTransfer.files))
    },
    [handleUploadFiles]
  )

  return {
    appendDraftAttachments,
    handleComposerDragOver,
    handleComposerDrop,
    handleComposerPaste,
    handleUploadInputChange,
    latestAttachmentsRef,
    reconcileDraftAttachments,
    submittedAttachmentIdsRef,
    uploadError,
  }
}
