import { feedbackSurfaceClassName } from "@/features/shared/appearance"
import { THEME_OPTIONS } from "@/features/shared/appearance"
import {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  useDeferredValue,
  type FormEvent,
} from "react"
import { useShallow } from "zustand/react/shallow"
import { SlashCommandMenu } from "./SlashCommandMenu"
import { AtMentionMenu, type FileItem } from "./AtMentionMenu"
import { useCommands, type NormalizedCommand } from "../hooks/useCommands"
import { useAgents, type NormalizedAgent } from "../hooks/useAgents"
import { useFileSearch } from "../hooks/useFileSearch"
import {
  DEFAULT_RUNTIME_MODE,
  type HarnessId,
  type QueuedChatMessage,
  type RuntimeModeKind,
  type RuntimePromptResponse,
} from "../types"
import type { ComposerPlan, ComposerPrompt } from "./composer/types"
import { populateComposerFromSerializedValue, serializeComposerState } from "./composer/composerSerialization"
import { Loader } from "./ai-elements/loader"
import { ComposerToolbar } from "./ComposerToolbar"
import { RuntimeModePicker } from "./RuntimeModePicker"
import { ComposerEditorSurface } from "./composer/ComposerEditorSurface"
import { useComposerAttachments } from "./composer/useComposerAttachments"
import { useDeferredComposerInput } from "./composer/useDeferredComposerInput"
import { useComposerKeyboardNavigation } from "./composer/useComposerKeyboardNavigation"
import { useRuntimePromptState } from "./composer/useRuntimePromptState"
import { ComposerPlanPreview } from "./composer/ComposerPlanPreview"
import { ApprovalPromptSurface } from "./composer/ApprovalPromptSurface"
import { StructuredPromptSurface } from "./composer/StructuredPromptSurface"
import { ComposerFloatingOverlay } from "./composer/ComposerFloatingOverlay"
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
} from "lexical"
import { $createSkillChipNode, $isSkillChipNode, SkillChipNode } from "./SkillChipNode"
import { $isUploadChipNode, UploadChipNode } from "./UploadChipNode"
import { cn } from "@/lib/utils"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { useChatStore } from "../store"
import { createProjectChatSession } from "../store/projectChatSession"
import { createDefaultProjectChat } from "../store/sessionState"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { useTabStore } from "@/features/editor/store"
import { runCommandInProjectTerminal } from "@/features/terminal/utils/projectTerminal"
import { getProjectActionCommands } from "@/features/workspace/utils/projectActions"
import {
  formatShortcutBinding,
  getShortcutBinding,
  matchesShortcutBinding,
} from "@/features/settings/shortcuts"
import { getChatInputPlaceholder } from "./chatInputConfig"
import { useComposerModelSelection } from "./useComposerModelSelection"
import { QueuedMessageDeck } from "./QueuedMessageDeck"
import {
  collectAttachmentIdsFromComposerValue,
  getComposerTextInput,
  type DraftChatAttachment,
} from "./composer/attachments"
import { getActiveSlashCommandQuery } from "./chatInputSlashCommands"
import { normalizeChatInputAttachments, noopSetChatInputAttachments } from "./chatInputAttachments"

interface ChatInputProps {
  sessionId?: string | null
  input: string
  setInput: (value: string) => void
  attachments?: DraftChatAttachment[]
  setAttachments?: (attachments: DraftChatAttachment[]) => void
  queuedMessages?: QueuedChatMessage[]
  isLocked?: boolean
  placement?: "docked" | "intro"
  allowSlashCommands?: boolean
  onSubmit: (
    text: string,
    options?: {
      attachments?: DraftChatAttachment[]
      harnessId?: HarnessId
      agent?: string
      collaborationMode?: "default" | "plan"
      runtimeMode?: RuntimeModeKind
      model?: string
      reasoningEffort?: string | null
      modelVariant?: string | null
      fastMode?: boolean
    }
  ) => void
  onAbort?: () => void
  onExecuteCommand?: (command: string, args?: string) => void
  status: "idle" | "connecting" | "streaming" | "error"
  activePlan?: ComposerPlan | null
  prompt?: ComposerPrompt | null
  onAnswerPrompt?: (response: RuntimePromptResponse) => void
  onDismissPrompt?: () => void
  onRemoveQueuedMessage?: (queuedMessageId: string) => void
  onEditQueuedMessage?: (queuedMessageId: string) => void
}

const FILE_SEARCH_DEBOUNCE_MS = 120

function formatFocusShortcutHint(binding: ReturnType<typeof getShortcutBinding>): string {
  const modifierSymbols = binding.modifiers.map((modifier) => {
    switch (modifier) {
      case "meta":
        return "\u2318"
      case "ctrl":
        return "\u2303"
      case "alt":
        return "\u2325"
      case "shift":
        return "\u21e7"
      default:
        return ""
    }
  })

  const key = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key
  return `${modifierSymbols.join("")}${key}`
}

export function ChatInput({
  sessionId = null,
  input,
  setInput,
  attachments: rawAttachments,
  setAttachments = noopSetChatInputAttachments,
  queuedMessages = [],
  isLocked = false,
  placement = "docked",
  allowSlashCommands = true,
  onSubmit,
  onAbort,
  onExecuteCommand,
  status,
  activePlan,
  prompt,
  onAnswerPrompt,
  onDismissPrompt,
  onRemoveQueuedMessage,
  onEditQueuedMessage,
}: ChatInputProps) {
  const attachments = normalizeChatInputAttachments(rawAttachments)
  const { selectedProject, selectedWorktreeId, selectedWorktreePath } = useCurrentProjectWorktree()
  const storedProjectChat = useChatStore((state) =>
    selectedWorktreeId ? state.chatByWorktree[selectedWorktreeId] ?? null : null
  )
  const projectChat = useMemo(
    () =>
      selectedWorktreeId
        ? (storedProjectChat ?? createDefaultProjectChat(selectedWorktreePath ?? undefined))
        : null,
    [selectedWorktreeId, selectedWorktreePath, storedProjectChat]
  )
  const {
    setSessionRuntimeMode,
  } = useChatStore(
    useShallow((state) => ({
      setSessionRuntimeMode: state.setSessionRuntimeMode,
    }))
  )
  const { openTerminalTab } = useTabStore(
    useShallow((state) => ({
      openTerminalTab: state.openTerminalTab,
    }))
  )
  const {
    initialize: initializeSettings,
    appearanceThemeId,
    setAppearanceThemeId,
  } = useSettingsStore(
    useShallow((state) => ({
      initialize: state.initialize,
      appearanceThemeId: state.appearanceThemeId,
      setAppearanceThemeId: state.setAppearanceThemeId,
    }))
  )
  const activeSession = useMemo(
    () =>
      sessionId
        ? projectChat?.sessions.find((session) => session.id === sessionId) ?? null
        : null,
    [projectChat, sessionId]
  )
  const activeSessionModelId = activeSession?.model?.trim() || null
  const activeSessionRuntimeMode = activeSession?.runtimeMode ?? null
  const isDraftSession = !!activeSession && !activeSession.remoteId
  const persistedHarnessId = activeSession?.harnessId ?? projectChat?.selectedHarnessId ?? null
  const {
    availableModelVariants,
    availableReasoningEfforts,
    effectiveModel,
    fastMode,
    fastModeTooltipLabel,
    handleSelectModelVariant,
    handleSelectReasoningEffort,
    isLoadingModels,
    modelVariant,
    modelPickerProps,
    reasoningEffort,
    selectedHarnessId,
    showModelVariantSelector,
    showReasoningEffortSelector,
    supportsFastMode,
    toggleFastMode,
  } = useComposerModelSelection({
    activeSession,
    activeSessionModelId,
    isDraftSession,
    persistedHarnessId,
    selectedWorktreeId,
  })
  const [isImeComposing, setIsImeComposing] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [slashMenuPage, setSlashMenuPage] = useState<"commands" | "themes">("commands")
  const [dismissedMenuKey, setDismissedMenuKey] = useState<string | null>(null)
  const [isSlashMenuDismissed, setIsSlashMenuDismissed] = useState(false)
  const [isPlanModeEnabled, setIsPlanModeEnabled] = useState(false)
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [runtimeModeOverride, setRuntimeModeOverride] = useState<RuntimeModeKind | null>(null)
  const runtimeMode = activeSessionRuntimeMode ?? runtimeModeOverride ?? DEFAULT_RUNTIME_MODE
  const focusChatInputShortcut = useMemo(() => getShortcutBinding("focus-chat-input"), [])
  const focusChatInputHint = useMemo(
    () => formatFocusShortcutHint(focusChatInputShortcut),
    [focusChatInputShortcut]
  )
  const planModeShortcut = useMemo(() => getShortcutBinding("toggle-plan-mode"), [])
  const planModeShortcutLabel = useMemo(
    () => formatShortcutBinding(planModeShortcut),
    [planModeShortcut]
  )
  const editorRef = useRef<LexicalEditor | null>(null)
  const composerMenuAnchorRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const serializedComposerValueRef = useRef(input)
  const previousCommandSignatureRef = useRef("")
  const suppressNextSubmitRef = useRef(false)
  const attachmentsById = useMemo(
    () => new Map(attachments.map((attachment) => [attachment.id, attachment] as const)),
    [attachments]
  )
  const { commitComposerInput, liveInput, liveInputRef, pendingLocalInputRef } =
    useDeferredComposerInput({
      input,
      resetKey: `${selectedWorktreeId ?? "no-worktree"}:${sessionId ?? "draft"}`,
      setInput,
    })
  const composerTextInput = useMemo(() => getComposerTextInput(liveInput), [liveInput])
  const slashCommandQuery = useMemo(
    () => getActiveSlashCommandQuery(composerTextInput),
    [composerTextInput]
  )

  const togglePlanMode = useCallback(() => {
    setIsPlanModeEnabled((current) => !current)
  }, [])

  const deferredHarnessId = useDeferredValue(selectedHarnessId)

  const disablePlanMode = useCallback(() => {
    setIsPlanModeEnabled(false)
  }, [])

  const focusComposer = useCallback(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    editor.focus()
  }, [])

  const { commands, isLoading: isLoadingCommands } = useCommands(
    deferredHarnessId,
    selectedProject?.actions ?? [],
    selectedWorktreePath
  )
  const { agents, isLoading: isLoadingAgents } = useAgents(deferredHarnessId)
  const { results: fileResults, isLoading: isLoadingFiles, search: searchFiles, clear: clearFiles } = useFileSearch()
  const isPlanModeAvailable = true
  const insertableCommands = useMemo(
    () => commands.filter((command) => command.execution === "insert" && !!command.referenceName),
    [commands]
  )
  const commandsByReference = useMemo(
    () =>
      new Map(
        insertableCommands.flatMap((command) =>
          command.referenceName ? [[command.referenceName.toLowerCase(), command] as const] : []
        )
      ),
    [insertableCommands]
  )
  const commandSignature = useMemo(
    () => insertableCommands.map((command) => command.referenceName).filter(Boolean).join("|"),
    [insertableCommands]
  )

  const isWorking = status === "connecting" || status === "streaming"
  const {
    activeApprovalPrompt,
    activeQuestionPrompt,
    currentPromptQuestion,
    currentPromptQuestionAnswered,
    currentPromptQuestionIndex,
    handleApprovePrompt,
    handleDenyPrompt,
    handleDismissPrompt,
    handleGoToNextPromptQuestion,
    handleGoToPreviousPromptQuestion,
    handlePromptAnswerChange,
    handlePromptCustomAnswerChange,
    handlePromptCustomAnswerFocus,
    isFirstPromptQuestion,
    isLastPromptQuestion,
    isPromptActive,
    promptAnswers,
    promptCtaLabel,
    promptCustomAnswers,
    promptProgressLabel,
    submitActivePrompt,
  } = useRuntimePromptState({
    prompt,
    onAnswerPrompt,
    onDismissPrompt,
  })
  const isComposerLocked = isLocked && !isPromptActive
  const {
    handleComposerDragOver,
    handleComposerDrop,
    handleComposerPaste,
    handleUploadInputChange,
    latestAttachmentsRef,
    reconcileDraftAttachments,
    submittedAttachmentIdsRef,
    uploadError,
  } = useComposerAttachments({
    attachments,
    editorRef,
    focusComposer,
    isComposerLocked,
    isPromptActive,
    selectedWorktreePath,
    setAttachments,
  })
  const atMenuKey = composerTextInput.startsWith("@") ? `at:${composerTextInput}` : null
  const showSlashMenu =
    allowSlashCommands &&
    !isPromptActive &&
    !isComposerLocked &&
    (slashCommandQuery !== null || slashMenuPage === "themes") &&
    !isSlashMenuDismissed

  const showAtMenu =
    !isPromptActive &&
    !isComposerLocked &&
    composerTextInput.startsWith("@") &&
    dismissedMenuKey !== atMenuKey
  const atQuery = showAtMenu ? composerTextInput.slice(1) : ""
  const canSubmit = activeQuestionPrompt
    ? !!currentPromptQuestion && currentPromptQuestionAnswered
    : activeApprovalPrompt
      ? false
      : (composerTextInput.trim().length > 0 || attachments.length > 0) &&
        !isComposerLocked
  const shouldShowSendAction = !isWorking || canSubmit || showSlashMenu || showAtMenu
  const showQueuedDeck = !isPromptActive && !isComposerLocked && queuedMessages.length > 0

  useEffect(() => {
    void initializeSettings()
  }, [initializeSettings])

  useEffect(() => {
    setRuntimeModeOverride(null)
  }, [activeSession?.id, selectedWorktreeId])

  useEffect(() => {
    if (!isPlanModeAvailable) {
      setIsPlanModeEnabled(false)
    }
  }, [isPlanModeAvailable])

  useEffect(() => {
    if (!isPlanModeAvailable || isPromptActive) {
      return
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !matchesShortcutBinding(event, planModeShortcut)) {
        return
      }

      event.preventDefault()
      togglePlanMode()
    }

    window.addEventListener("keydown", handleWindowKeyDown)
    return () => window.removeEventListener("keydown", handleWindowKeyDown)
  }, [isPlanModeAvailable, isPromptActive, planModeShortcut, togglePlanMode])

  useEffect(() => {
    if (isPromptActive || isComposerLocked) {
      return
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !matchesShortcutBinding(event, focusChatInputShortcut)) {
        return
      }

      event.preventDefault()
      focusComposer()
    }

    window.addEventListener("keydown", handleWindowKeyDown)
    return () => window.removeEventListener("keydown", handleWindowKeyDown)
  }, [focusChatInputShortcut, focusComposer, isComposerLocked, isPromptActive])

  useEffect(() => {
    if (isPromptActive) {
      setIsSlashMenuDismissed(false)
    }
  }, [isPromptActive])

  useEffect(() => {
    if (!isComposerLocked) {
      return
    }

    setIsSlashMenuDismissed(false)
    setDismissedMenuKey(null)
    setIsImeComposing(false)
    editorRef.current?.blur()

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [isComposerLocked])

  useEffect(() => {
    if (slashCommandQuery === null) {
      setIsSlashMenuDismissed(false)
      setSlashMenuPage("commands")
      return
    }

    if (slashMenuPage === "themes" && slashCommandQuery !== "theme") {
      setSlashMenuPage("commands")
    }
  }, [slashCommandQuery, slashMenuPage])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || isPromptActive) {
      return
    }

    const commandSignatureChanged = previousCommandSignatureRef.current !== commandSignature
    previousCommandSignatureRef.current = commandSignature

    const pendingLocalInput = pendingLocalInputRef.current
    const nextValue = pendingLocalInput !== null ? liveInputRef.current : input

    if (!commandSignatureChanged && nextValue === serializedComposerValueRef.current) {
      return
    }

    editor.update(() => {
      populateComposerFromSerializedValue(nextValue, commandsByReference, attachmentsById)
    })
    serializedComposerValueRef.current = nextValue
  }, [attachmentsById, commandSignature, commandsByReference, input, isPromptActive])

  // Search files when @ query changes
  useEffect(() => {
    if (!showAtMenu || atQuery.length === 0) {
      clearFiles()
      return
    }

    const timeoutId = window.setTimeout(() => {
      searchFiles(atQuery)
    }, FILE_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [showAtMenu, atQuery, searchFiles, clearFiles])

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!showSlashMenu) return []
    
    const lowerQuery = slashCommandQuery?.toLowerCase() ?? ""
    if (!lowerQuery) return commands
    
    return commands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lowerQuery) ||
        cmd.description.toLowerCase().includes(lowerQuery)
    )
  }, [commands, showSlashMenu, slashCommandQuery])

  // Filter agents based on query
  const filteredAgents = useMemo(() => {
    if (!showAtMenu) return []
    
    const lowerQuery = atQuery.toLowerCase()
    if (!lowerQuery) return agents
    
    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(lowerQuery) ||
        agent.description.toLowerCase().includes(lowerQuery)
    )
  }, [agents, showAtMenu, atQuery])

  // Convert file results to FileItem format
  const filteredFiles: FileItem[] = useMemo(() => {
    if (!showAtMenu) return []
    return fileResults.map((f) => ({ path: f.path, type: f.type }))
  }, [showAtMenu, fileResults])

  // Total items in @ menu
  const atMenuTotalItems = filteredAgents.length + filteredFiles.length

  useEffect(() => {
    if (slashMenuPage !== "themes") {
      return
    }

    const selectedThemeOption = THEME_OPTIONS[selectedIndex] ?? THEME_OPTIONS[0] ?? null
    if (!selectedThemeOption || selectedThemeOption.id === appearanceThemeId) {
      return
    }

    setAppearanceThemeId(selectedThemeOption.id)
  }, [appearanceThemeId, selectedIndex, setAppearanceThemeId, slashMenuPage])

  // Reset selected index when filtered items change
  useEffect(() => {
    if (slashMenuPage === "themes") {
      return
    }

    setSelectedIndex(0)
  }, [atMenuTotalItems, filteredCommands.length, slashMenuPage])

  const openThemeSlashMenu = useCallback(() => {
    const currentThemeIndex = THEME_OPTIONS.findIndex((option) => option.id === appearanceThemeId)
    setDismissedMenuKey(null)
    setIsSlashMenuDismissed(false)
    setSlashMenuPage("themes")
    commitComposerInput("/theme")
    setSelectedIndex(currentThemeIndex >= 0 ? currentThemeIndex : 0)
    suppressNextSubmitRef.current = true
    requestAnimationFrame(() => {
      focusComposer()
    })
  }, [appearanceThemeId, commitComposerInput, focusComposer])

  const handleSelectThemeOption = useCallback(
    (themeId: (typeof THEME_OPTIONS)[number]["id"], index: number) => {
      setSelectedIndex(index)
      setAppearanceThemeId(themeId)
      requestAnimationFrame(() => {
        focusComposer()
      })
    },
    [focusComposer, setAppearanceThemeId]
  )

  const runSystemSlashCommand = useCallback(
    (command: NormalizedCommand) => {
      if (command.action === "theme") {
        openThemeSlashMenu()
        return
      }

      if (command.action === "new-chat") {
        if (!selectedWorktreeId || !selectedWorktreePath) {
          return
        }

        void createProjectChatSession({
          worktreeId: selectedWorktreeId,
          worktreePath: selectedWorktreePath,
        })
          .then((result) => {
            if (!result.ok) {
              return
            }

            commitComposerInput("")
            setDismissedMenuKey(null)
            setIsSlashMenuDismissed(false)
          })
          .catch((error) => {
            console.error("[ChatInput] Failed to create a chat session:", error)
          })
        return
      }

      if (command.action === "new-terminal") {
        if (!selectedWorktreeId) {
          return
        }

        commitComposerInput("")
        setDismissedMenuKey(null)
        setIsSlashMenuDismissed(false)
        openTerminalTab(selectedWorktreeId)
        return
      }

      if (command.projectAction) {
        if (!selectedWorktreeId || !selectedWorktreePath) {
          return
        }

        const commandLines = getProjectActionCommands(command.projectAction.command)
        if (commandLines.length === 0) {
          return
        }

        commitComposerInput("")
        setDismissedMenuKey(null)
        setIsSlashMenuDismissed(false)

        void runCommandInProjectTerminal({
          projectId: selectedWorktreeId,
          cwd: selectedWorktreePath,
          command: commandLines.join("\n"),
        }).catch((error) => {
          console.error(`Failed to run project action "${command.projectAction?.name}":`, error)
        })
      }
    },
    [
      openTerminalTab,
      openThemeSlashMenu,
      selectedProject,
      selectedWorktreeId,
      selectedWorktreePath,
      commitComposerInput,
    ]
  )

  const handleSelectCommand = useCallback(
    (command: NormalizedCommand) => {
      if (command.execution === "run") {
        suppressNextSubmitRef.current = true
        runSystemSlashCommand(command)
        return
      }

      if (command.insertText) {
        setDismissedMenuKey(null)
        setIsSlashMenuDismissed(false)
        commitComposerInput(command.insertText)
        suppressNextSubmitRef.current = true
        requestAnimationFrame(() => {
          focusComposer()
        })
        return
      }

      const referenceName = command.referenceName
      const editor = editorRef.current

      if (!referenceName || !editor) {
        return
      }

      focusComposer()
      editor.update(() => {
        if (getActiveSlashCommandQuery(getComposerTextInput(serializedComposerValueRef.current)) !== null) {
          $getRoot().clear()
        }

        let selection = $getSelection()

        if (!$isRangeSelection(selection)) {
          $getRoot().selectEnd()
          selection = $getSelection()
        }

        if (!$isRangeSelection(selection)) {
          return
        }

        selection.insertNodes([
          $createSkillChipNode(referenceName, command.name),
          $createTextNode(" "),
        ])
      })
      setDismissedMenuKey(null)
      setIsSlashMenuDismissed(false)
      suppressNextSubmitRef.current = true
    },
    [commitComposerInput, focusComposer, runSystemSlashCommand]
  )

  const handleSelectAgent = useCallback(
    (agent: NormalizedAgent) => {
      setDismissedMenuKey(null)
      commitComposerInput(`@${agent.name} `)
      requestAnimationFrame(() => {
        focusComposer()
      })
    },
    [commitComposerInput, focusComposer]
  )

  const handleSelectFile = useCallback(
    (file: FileItem) => {
      setDismissedMenuKey(null)
      commitComposerInput(`${file.path} `)
      requestAnimationFrame(() => {
        focusComposer()
      })
    },
    [commitComposerInput, focusComposer]
  )

  const closeSlashMenu = useCallback(() => {
    setIsSlashMenuDismissed(true)
  }, [])

  const finalizeThemeSlashMenu = useCallback(() => {
    setSlashMenuPage("commands")
    commitComposerInput("")
    setDismissedMenuKey(null)
    setIsSlashMenuDismissed(true)
    requestAnimationFrame(() => {
      focusComposer()
    })
  }, [commitComposerInput, focusComposer])

  const closeAtMenu = useCallback(() => {
    if (atMenuKey) {
      setDismissedMenuKey(atMenuKey)
    }
  }, [atMenuKey])

  const deleteAdjacentChip = useCallback(() => {
    const editor = editorRef.current

    if (!editor) {
      return false
    }

    let handled = false

    editor.update(() => {
      const selection = $getSelection()

      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return
      }

      const anchor = selection.anchor
      let previousNode: LexicalNode | null = null
      let leadingWhitespaceToTrim = 0
      let whitespaceNodeToTrim: LexicalNode | null = null

      if (anchor.type === "text") {
        const anchorNode = anchor.getNode()
        const anchorText = anchorNode.getTextContent()

        if (anchor.offset === 0) {
          previousNode = anchorNode.getPreviousSibling()
        } else {
          const textBeforeCaret = anchorText.slice(0, anchor.offset)

          if (textBeforeCaret.trim().length > 0) {
            return
          }

          previousNode = anchorNode.getPreviousSibling()
          leadingWhitespaceToTrim = anchor.offset
          whitespaceNodeToTrim = anchorNode
        }
      } else {
        const anchorNode = anchor.getNode()
        const directPreviousNode =
          anchor.offset > 0
            ? anchorNode.getChildAtIndex(anchor.offset - 1)
            : anchorNode.getPreviousSibling()

        if ($isTextNode(directPreviousNode)) {
          const previousText = directPreviousNode.getTextContent()

          if (previousText.trim().length > 0) {
            return
          }

          previousNode = directPreviousNode.getPreviousSibling()
          leadingWhitespaceToTrim = previousText.length
          whitespaceNodeToTrim = directPreviousNode
        } else {
          previousNode = directPreviousNode
        }
      }

      if (!$isSkillChipNode(previousNode) && !$isUploadChipNode(previousNode)) {
        return
      }

      if ($isTextNode(whitespaceNodeToTrim) && leadingWhitespaceToTrim > 0) {
        const remainingText = whitespaceNodeToTrim.getTextContent().slice(leadingWhitespaceToTrim)

        if (remainingText.length === 0) {
          whitespaceNodeToTrim.remove()
        } else {
          whitespaceNodeToTrim.setTextContent(remainingText)
        }
      }

      const nextSibling = previousNode.getNextSibling()
      if ($isTextNode(nextSibling)) {
        const nextText = nextSibling.getTextContent()

        if (nextText === " ") {
          nextSibling.remove()
        } else if (nextText.startsWith(" ")) {
          nextSibling.setTextContent(nextText.slice(1))
        }
      }

      previousNode.remove()
      handled = true
    })

    return handled
  }, [])

  const selectorsRow = !isPromptActive

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault()

      if (suppressNextSubmitRef.current) {
        suppressNextSubmitRef.current = false
        return
      }

      if (isComposerLocked) {
        return
      }

      if (submitActivePrompt()) {
        return
      }

      const activeSlashCommandQuery = allowSlashCommands
        ? getActiveSlashCommandQuery(composerTextInput)
        : null

      if (activeSlashCommandQuery !== null) {
        if (slashMenuPage === "themes") {
          return
        }

        const selectedCommand = filteredCommands[selectedIndex] ?? filteredCommands[0]
        if (selectedCommand) {
          handleSelectCommand(selectedCommand)
        }
        return
      }

      // If @ menu is open, select the item
      if (showAtMenu && atMenuTotalItems > 0) {
        if (selectedIndex < filteredAgents.length) {
          handleSelectAgent(filteredAgents[selectedIndex])
        } else {
          handleSelectFile(filteredFiles[selectedIndex - filteredAgents.length])
        }
        return
      }

      if (!canSubmit) return

      const trimmedInput = composerTextInput.trim()
      const attachmentsForSubmit = latestAttachmentsRef.current.filter((attachment) =>
        collectAttachmentIdsFromComposerValue(liveInputRef.current).includes(attachment.id)
      )
      if (allowSlashCommands && trimmedInput.startsWith("/") && !trimmedInput.includes(" ")) {
        const commandName = trimmedInput.slice(1)
        const matchingCommand = commands.find((command) => command.name === commandName)

        if (matchingCommand?.isPreview) {
          return
        }

        if (matchingCommand?.execution === "run" && onExecuteCommand) {
          onExecuteCommand(matchingCommand.name, "")
          setDismissedMenuKey(null)
          commitComposerInput("")
          return
        }
      }

      // Check if message starts with @agent pattern
      const agentMatch = composerTextInput.match(/^@(\w+)\s+(.*)$/s)
      const collaborationMode = isPlanModeAvailable
        ? (isPlanModeEnabled ? "plan" : "default")
        : undefined
      submittedAttachmentIdsRef.current = new Set(attachmentsForSubmit.map((attachment) => attachment.id))
      if (agentMatch) {
        const [, agentName, message] = agentMatch
        onSubmit(message.trim(), {
          attachments: attachmentsForSubmit,
          harnessId: selectedHarnessId ?? undefined,
          agent: agentName,
          collaborationMode,
          runtimeMode,
          model: effectiveModel?.id ?? undefined,
          reasoningEffort: collaborationMode ? reasoningEffort : null,
          modelVariant,
          fastMode: collaborationMode ? fastMode : false,
        })
      } else {
        onSubmit(trimmedInput, {
          attachments: attachmentsForSubmit,
          harnessId: selectedHarnessId ?? undefined,
          collaborationMode,
          runtimeMode,
          model: effectiveModel?.id ?? undefined,
          reasoningEffort: collaborationMode ? reasoningEffort : null,
          modelVariant,
          fastMode: collaborationMode ? fastMode : false,
        })
      }
    },
    [
      canSubmit,
      composerTextInput,
      onSubmit,
      submitActivePrompt,
      isPlanModeAvailable,
      isPlanModeEnabled,
      selectedHarnessId,
      runtimeMode,
      effectiveModel?.id,
      reasoningEffort,
      modelVariant,
      fastMode,
      commands,
      onExecuteCommand,
      commitComposerInput,
      showAtMenu,
      atMenuTotalItems,
      filteredAgents,
      filteredFiles,
      handleSelectAgent,
      handleSelectFile,
      showSlashMenu,
      filteredCommands,
      selectedIndex,
      handleSelectCommand,
      allowSlashCommands,
      isComposerLocked,
    ]
  )

  const handleKeyDown = useComposerKeyboardNavigation({
    atMenuTotalItems,
    closeAtMenu,
    closeSlashMenu,
    commitComposerInput,
    deleteAdjacentChip,
    filteredAgents,
    filteredCommands,
    filteredFiles,
    finalizeThemeSlashMenu,
    handleSelectCommand,
    handleSubmit,
    isComposerLocked,
    isImeComposing,
    isPromptActive,
    selectedIndex,
    showAtMenu,
    showSlashMenu,
    slashMenuPage,
    setSelectedIndex,
  })

  const handleComposerChange = useCallback(
    (editorState: EditorState) => {
      const nextValue = editorState.read(() => serializeComposerState())
      serializedComposerValueRef.current = nextValue
      reconcileDraftAttachments(nextValue)

      if (nextValue !== liveInputRef.current) {
        setDismissedMenuKey(null)
        commitComposerInput(nextValue, { deferParent: true })
      }
    },
    [commitComposerInput, reconcileDraftAttachments]
  )

  const composerCommandsByReferenceRef = useRef(commandsByReference)
  const composerAttachmentsByIdRef = useRef(attachmentsById)

  useEffect(() => {
    composerCommandsByReferenceRef.current = commandsByReference
  }, [commandsByReference])

  useEffect(() => {
    composerAttachmentsByIdRef.current = attachmentsById
  }, [attachmentsById])

  const composerInitialConfig = useMemo(
    () => ({
      namespace: "vfactor-chat-composer",
      nodes: [SkillChipNode, UploadChipNode],
      onError(error: Error) {
        throw error
      },
      editorState() {
        populateComposerFromSerializedValue(
          liveInputRef.current,
          composerCommandsByReferenceRef.current,
          composerAttachmentsByIdRef.current
        )
      },
    }),
    []
  )

  const placeholder = getChatInputPlaceholder(placement)

  const handleCompositionStart = useCallback(() => {
    setIsImeComposing(true)
  }, [])

  const handleCompositionEnd = useCallback(() => {
    setIsImeComposing(false)
  }, [])

  const handleComposerFocus = useCallback(() => {
    setIsComposerFocused(true)
  }, [])

  const handleComposerBlur = useCallback(() => {
    setIsComposerFocused(false)
  }, [])

  const handleSelectRuntimeMode = useCallback(
    async (nextRuntimeMode: RuntimeModeKind) => {
      if (activeSession?.id) {
        await setSessionRuntimeMode(activeSession.id, nextRuntimeMode)
        return
      }

      setRuntimeModeOverride(nextRuntimeMode)
    },
    [activeSession?.id, setSessionRuntimeMode]
  )
  const handleRuntimeModePickerSelect = useCallback(
    (nextRuntimeMode: RuntimeModeKind) => {
      void handleSelectRuntimeMode(nextRuntimeMode)
    },
    [handleSelectRuntimeMode]
  )
  const handleAttachFiles = useCallback(() => {
    fileInputRef.current?.click()
  }, [])


  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        placement === "intro" ? "w-full bg-transparent px-0 pb-0" : "chat-main-surface px-6 pb-1.5"
      )}
      aria-busy={isComposerLocked}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={handleUploadInputChange}
      />
      <div className="flex flex-col">
        {showQueuedDeck ? (
          <QueuedMessageDeck
            placement={placement}
            queuedMessages={queuedMessages}
            onEditQueuedMessage={onEditQueuedMessage}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
          />
        ) : null}

        <div className={cn("relative z-10", showQueuedDeck ? "-mt-1" : "")}>
          <div
            ref={composerMenuAnchorRef}
            className={cn(
              "chat-composer-shell chat-composer-input-surface relative overflow-hidden border shadow-sm",
              isPlanModeEnabled
                ? "border-[var(--color-chat-plan-border)] bg-[var(--color-chat-plan-surface)] shadow-[0_0_0_1px_var(--color-chat-plan-border)]"
                : "border-transparent"
              )}
            >
            {activePlan ? (
              <ComposerPlanPreview
                isPlanModeEnabled={isPlanModeEnabled}
                plan={activePlan}
              />
            ) : null}

            <div className="relative px-4 pt-2.5 pb-2.5">
            {isComposerLocked ? (
              <div className="flex items-center gap-3 px-1 py-1.5">
                <Loader size={14} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Setting up workspace…</span>
              </div>
            ) : activeQuestionPrompt ? (
              <StructuredPromptSurface
                prompt={activeQuestionPrompt}
                answers={promptAnswers}
                customAnswers={promptCustomAnswers}
                onAnswerChange={handlePromptAnswerChange}
                onCustomAnswerChange={handlePromptCustomAnswerChange}
                onCustomAnswerFocus={handlePromptCustomAnswerFocus}
                currentQuestionIndex={currentPromptQuestionIndex}
                progressLabel={promptProgressLabel ?? ""}
                onPreviousQuestion={handleGoToPreviousPromptQuestion}
                onNextQuestion={handleGoToNextPromptQuestion}
                canGoPrevious={!isFirstPromptQuestion}
                canGoNext={!isLastPromptQuestion}
                canSubmitCurrentQuestion={canSubmit}
                submitLabel={promptCtaLabel}
                onDismissPrompt={handleDismissPrompt}
              />
            ) : (
              <div>
                <ComposerEditorSurface
                  editorRef={editorRef}
                  initialConfig={composerInitialConfig}
                  isLocked={isComposerLocked}
                  onChange={handleComposerChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handleComposerPaste}
                  onDragOver={handleComposerDragOver}
                  onDrop={handleComposerDrop}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onFocus={handleComposerFocus}
                  onBlur={handleComposerBlur}
                  placeholder={placeholder}
                />

                {!isComposerFocused ? (
                  <div className="pointer-events-none absolute top-2.5 right-4 z-10 text-sm leading-5 text-muted-foreground/58">
                    <span className="text-foreground/84">{focusChatInputHint}</span>
                    <span className="text-muted-foreground/58"> to focus</span>
                  </div>
                ) : null}

                {showSlashMenu ? (
                  <ComposerFloatingOverlay anchorRef={composerMenuAnchorRef}>
                    {slashMenuPage === "themes" ? (
                      <SlashCommandMenu
                        page="themes"
                        themes={THEME_OPTIONS}
                        activeThemeId={appearanceThemeId}
                        onSelectTheme={handleSelectThemeOption}
                        onClose={closeSlashMenu}
                        selectedIndex={selectedIndex}
                      />
                    ) : (
                      <SlashCommandMenu
                        page="commands"
                        commands={filteredCommands}
                        query={slashCommandQuery ?? ""}
                        isLoading={isLoadingCommands}
                        onSelect={handleSelectCommand}
                        onClose={closeSlashMenu}
                        selectedIndex={selectedIndex}
                      />
                    )}
                  </ComposerFloatingOverlay>
                ) : null}

                {showAtMenu ? (
                  <ComposerFloatingOverlay anchorRef={composerMenuAnchorRef}>
                    <AtMentionMenu
                      agents={filteredAgents}
                      files={filteredFiles}
                      query={atQuery}
                      isLoading={isLoadingAgents || isLoadingFiles}
                      onSelectAgent={handleSelectAgent}
                      onSelectFile={handleSelectFile}
                      onClose={closeAtMenu}
                      selectedIndex={selectedIndex}
                    />
                  </ComposerFloatingOverlay>
                ) : null}
              </div>
            )}

            {!isPromptActive && !isComposerLocked && uploadError ? (
              <div className={cn(feedbackSurfaceClassName("destructive"), "mt-2.5 rounded-lg px-3 py-2 text-sm")}>
                {uploadError}
              </div>
            ) : null}

            <ComposerToolbar
              availableModelVariants={availableModelVariants}
              availableReasoningEfforts={availableReasoningEfforts}
              canSubmit={canSubmit}
              fastMode={fastMode}
              fastModeTooltipLabel={fastModeTooltipLabel}
              isLoadingModels={isLoadingModels}
              isPlanModeAvailable={isPlanModeAvailable}
              isPlanModeEnabled={isPlanModeEnabled}
              modelVariant={modelVariant}
              modelPickerProps={modelPickerProps}
              onAbort={onAbort}
              onAttachFiles={handleAttachFiles}
              onSelectModelVariant={handleSelectModelVariant}
              onSelectReasoningEffort={handleSelectReasoningEffort}
              onToggleFastMode={toggleFastMode}
              onTogglePlanMode={togglePlanMode}
              planModeShortcutLabel={planModeShortcutLabel}
              reasoningEffort={reasoningEffort}
              shouldShowModelVariantSelector={showModelVariantSelector}
              shouldShowReasoningEffortSelector={showReasoningEffortSelector}
              shouldShowSendAction={shouldShowSendAction}
              showAtMenu={showAtMenu}
              showControls={!isPromptActive && !isComposerLocked && selectorsRow}
              showSlashMenu={showSlashMenu}
              supportsFastMode={supportsFastMode}
            />
          </div>
        </div>

        {!isPromptActive && !isComposerLocked && selectorsRow ? (
          <div className="mt-1 flex h-6 items-center overflow-hidden px-1 text-muted-foreground">
            <RuntimeModePicker
              runtimeMode={runtimeMode}
              onSelectRuntimeMode={handleRuntimeModePickerSelect}
            />
          </div>
        ) : null}

        {activeApprovalPrompt ? (
          <div className="mt-2 rounded-2xl border border-[var(--color-chat-approval-border)] bg-[var(--color-chat-approval-surface)] p-4 shadow-sm">
            <ApprovalPromptSurface
              prompt={activeApprovalPrompt}
              onApprove={handleApprovePrompt}
              onDeny={handleDenyPrompt}
            />
          </div>
        ) : null}
        </div>

      </div>
    </form>
  )
}
