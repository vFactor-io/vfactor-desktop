import { ArrowUp02, Brain, CaretDown, CheckCircle, Circle, DocumentValidation, Paperclip, Stop, X, Zap } from "@/components/icons"
import { desktop } from "@/desktop/client"
import {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type FormEvent,
} from "react"
import { SlashCommandMenu } from "./SlashCommandMenu"
import { AtMentionMenu, type FileItem } from "./AtMentionMenu"
import { useCommands, type NormalizedCommand } from "../hooks/useCommands"
import { useAgents, type NormalizedAgent } from "../hooks/useAgents"
import { useFileSearch } from "../hooks/useFileSearch"
import { useModels } from "../hooks/useModels"
import type { RuntimePromptResponse, RuntimeReasoningEffort } from "../types"
import type { ComposerPlan, ComposerPrompt } from "./composer/types"
import { getRuntimeModelLabel } from "../domain/runtimeModels"
import {
  createRuntimeApprovalResponse,
  createRuntimePromptResponse,
  isRuntimeApprovalPrompt,
  isRuntimePromptQuestionAnswered,
  isRuntimeQuestionPrompt,
} from "../domain/runtimePrompts"
import { populateComposerFromSerializedValue, serializeComposerState } from "./composer/composerSerialization"
import { Loader } from "./ai-elements/loader"
import { ComposerEditorSurface } from "./composer/ComposerEditorSurface"
import { ApprovalPromptSurface } from "./composer/ApprovalPromptSurface"
import { StructuredPromptSurface } from "./composer/StructuredPromptSurface"
import { ComposerFloatingOverlay } from "./composer/ComposerFloatingOverlay"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/features/shared/components/ui/tooltip"
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
import { $isUploadChipNode, $createUploadChipNode, UploadChipNode } from "./UploadChipNode"
import { cn } from "@/lib/utils"
import { useCurrentProjectWorktree } from "@/features/shared/hooks"
import { useChatStore } from "../store"
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
import {
  resolveDefaultFastMode,
  resolveDefaultReasoningEffort,
  resolveEffectiveComposerModelId,
  resolveSessionSelectedModelId,
} from "./chatInputModelSelection"
import { ModelLogo, getModelLogoKind, type ModelLogoKind } from "./ModelLogo"
import {
  collectAttachmentIdsFromComposerValue,
  createDraftAttachment,
  getComposerTextInput,
  isLargeTextPaste,
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
  isLocked?: boolean
  placement?: "docked" | "intro"
  allowSlashCommands?: boolean
  onSubmit: (
    text: string,
    options?: {
      attachments?: DraftChatAttachment[]
      agent?: string
      collaborationMode?: "default" | "plan"
      model?: string
      reasoningEffort?: string | null
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
}

function getHarnessGroupMeta(selectedHarnessId: "codex" | "claude-code" | null): {
  key: string
  label: string
  logoKind: ModelLogoKind
} {
  if (selectedHarnessId === "claude-code") {
    return {
      key: "claude",
      label: "Claude",
      logoKind: "claude",
    }
  }

  return {
    key: "codex",
    label: "Codex",
    logoKind: "codex",
  }
}

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

function formatReasoningEffortLabel(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function ChatInput({
  sessionId = null,
  input,
  setInput,
  attachments: rawAttachments,
  setAttachments = noopSetChatInputAttachments,
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
}: ChatInputProps) {
  const attachments = normalizeChatInputAttachments(rawAttachments)
  const { selectedProject, selectedWorktreeId, selectedWorktreePath } = useCurrentProjectWorktree()
  const projectChat = useChatStore((state) =>
    selectedWorktreeId ? state.getProjectChat(selectedWorktreeId) : null
  )
  const createOptimisticSession = useChatStore((state) => state.createOptimisticSession)
  const setSessionModel = useChatStore((state) => state.setSessionModel)
  const openChatSession = useTabStore((state) => state.openChatSession)
  const openTerminalTab = useTabStore((state) => state.openTerminalTab)
  const initializeSettings = useSettingsStore((state) => state.initialize)
  const codexDefaultModel = useSettingsStore((state) => state.codexDefaultModel)
  const codexDefaultReasoningEffort = useSettingsStore((state) => state.codexDefaultReasoningEffort)
  const codexDefaultFastMode = useSettingsStore((state) => state.codexDefaultFastMode)
  const activeSession = useMemo(
    () =>
      sessionId
        ? projectChat?.sessions.find((session) => session.id === sessionId) ?? null
        : null,
    [projectChat, sessionId]
  )
  const activeSessionModelId = activeSession?.model?.trim() || null
  const selectedHarnessId = activeSession?.harnessId ?? projectChat?.selectedHarnessId ?? null
  const [isImeComposing, setIsImeComposing] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dismissedMenuKey, setDismissedMenuKey] = useState<string | null>(null)
  const [isSlashMenuDismissed, setIsSlashMenuDismissed] = useState(false)
  const [isPlanModeEnabled, setIsPlanModeEnabled] = useState(false)
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [reasoningEffortOverride, setReasoningEffortOverride] = useState<RuntimeReasoningEffort | null>(null)
  const [fastModeOverride, setFastModeOverride] = useState<boolean | null>(null)
  const [promptAnswers, setPromptAnswers] = useState<Record<string, string | string[]>>({})
  const [promptCustomAnswers, setPromptCustomAnswers] = useState<Record<string, string>>({})
  const [currentPromptQuestionIndex, setCurrentPromptQuestionIndex] = useState(0)
  const { models: availableModels, isLoading: isLoadingModels } = useModels(selectedHarnessId)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
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
  const skipNextPlanToggleClickRef = useRef(false)
  const suppressNextSubmitRef = useRef(false)
  const submittedAttachmentIdsRef = useRef<Set<string>>(new Set())
  const latestAttachmentsRef = useRef<DraftChatAttachment[]>(attachments)
  const attachmentsById = useMemo(
    () => new Map(attachments.map((attachment) => [attachment.id, attachment] as const)),
    [attachments]
  )
  const composerTextInput = useMemo(() => getComposerTextInput(input), [input])
  const slashCommandQuery = useMemo(
    () => getActiveSlashCommandQuery(composerTextInput),
    [composerTextInput]
  )

  useEffect(() => {
    latestAttachmentsRef.current = attachments
  }, [attachments])

  const togglePlanMode = useCallback(() => {
    setIsPlanModeEnabled((current) => !current)
  }, [])

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
    selectedHarnessId,
    selectedProject?.actions ?? []
  )
  const { agents, isLoading: isLoadingAgents } = useAgents(selectedHarnessId)
  const { results: fileResults, isLoading: isLoadingFiles, search: searchFiles, clear: clearFiles } = useFileSearch()
  const isCodexHarness = selectedHarnessId === "codex"
  const defaultModel = useMemo(
    () => availableModels.find((model) => model.isDefault) ?? availableModels[0] ?? null,
    [availableModels]
  )
  const effectiveModelId = useMemo(
    () =>
      resolveEffectiveComposerModelId({
        activeSessionModelId,
        composerSelectedModelId: selectedModelId,
        defaultModelId: isCodexHarness ? codexDefaultModel : null,
        availableModelIds: availableModels.map((model) => model.id),
        runtimeDefaultModelId: defaultModel?.id ?? null,
      }),
    [
      activeSessionModelId,
      availableModels,
      codexDefaultModel,
      defaultModel?.id,
      isCodexHarness,
      selectedModelId,
    ]
  )
  const effectiveModel = useMemo(
    () => availableModels.find((model) => model.id === effectiveModelId) ?? null,
    [availableModels, effectiveModelId]
  )
  const composerBaselineModelId = useMemo(
    () =>
      resolveEffectiveComposerModelId({
        activeSessionModelId: null,
        defaultModelId: isCodexHarness ? codexDefaultModel : null,
        availableModelIds: availableModels.map((model) => model.id),
        runtimeDefaultModelId: defaultModel?.id ?? null,
      }),
    [availableModels, codexDefaultModel, defaultModel?.id, isCodexHarness]
  )
  const selectedModelLogoKind = useMemo(
    () =>
      effectiveModel
        ? getModelLogoKind(
            `${effectiveModel.displayName ?? ""} ${effectiveModel.id ?? ""}`,
            selectedHarnessId
          )
        : selectedModelId
          ? getModelLogoKind(selectedModelId, selectedHarnessId)
          : (selectedHarnessId === "claude-code" ? "claude" : selectedHarnessId === "codex" ? "codex" : "default"),
    [effectiveModel, selectedHarnessId, selectedModelId]
  )
  const modelGroups = useMemo(() => {
    const harnessGroup = getHarnessGroupMeta(selectedHarnessId)

    return [
      {
        ...harnessGroup,
        models: availableModels.map((model) => ({
          model,
          logoKind: getModelLogoKind(
            `${model.displayName ?? ""} ${model.id ?? ""}`,
            selectedHarnessId
          ),
        })),
      },
    ]
  }, [availableModels, selectedHarnessId])
  const availableReasoningEfforts = useMemo(() => {
    const supported = effectiveModel?.supportedReasoningEfforts?.filter((effort) => effort.trim().length > 0) ?? []
    const defaultEffort = effectiveModel?.defaultReasoningEffort?.trim() ?? null

    if (supported.length > 0) {
      return Array.from(new Set(supported))
    }

    return defaultEffort ? [defaultEffort] : []
  }, [effectiveModel])
  const reasoningEffort = useMemo(
    () =>
      resolveDefaultReasoningEffort({
        overrideReasoningEffort: reasoningEffortOverride,
        defaultReasoningEffort: isCodexHarness ? codexDefaultReasoningEffort : null,
        modelDefaultReasoningEffort: effectiveModel?.defaultReasoningEffort ?? null,
        supportedReasoningEfforts: availableReasoningEfforts,
      }),
    [
      availableReasoningEfforts,
      codexDefaultReasoningEffort,
      effectiveModel?.defaultReasoningEffort,
      isCodexHarness,
      reasoningEffortOverride,
    ]
  )
  const supportsFastMode = isCodexHarness && effectiveModel?.supportsFastMode === true
  const fastMode = useMemo(
    () =>
      resolveDefaultFastMode({
        overrideFastMode: fastModeOverride,
        defaultFastMode: isCodexHarness ? codexDefaultFastMode : false,
        supportsFastMode,
      }),
    [codexDefaultFastMode, fastModeOverride, isCodexHarness, supportsFastMode]
  )
  const selectedModelLabel = effectiveModel
    ? getRuntimeModelLabel(effectiveModel)
    : selectedModelId
      ? selectedModelId
      : (isLoadingModels ? "Loading models..." : "Select model")
  const reasoningEffortLabel = reasoningEffort
    ? formatReasoningEffortLabel(reasoningEffort)
    : isLoadingModels
      ? "Loading effort..."
      : "Default"
  const fastModeTooltipLabel = !isCodexHarness
    ? ""
    : !supportsFastMode
      ? "Fast mode is only available on GPT-5.4."
      : fastMode
        ? "Fast mode is on. Codex will prefer faster responses with higher credit usage."
        : "Fast mode is off. Enable it for faster Codex responses on GPT-5.4."
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

  const isStreaming = status === "streaming"
  const isWorking = status === "connecting" || status === "streaming"
  const isPromptActive = !!prompt
  const isComposerLocked = isLocked && !isPromptActive
  const activeQuestionPrompt = isRuntimeQuestionPrompt(prompt) ? prompt : null
  const activeApprovalPrompt = isRuntimeApprovalPrompt(prompt) ? prompt : null
  const isApprovalComposerState = !!activeApprovalPrompt
  const currentPromptQuestion = activeQuestionPrompt?.questions[currentPromptQuestionIndex] ?? null
  const currentPromptQuestionAnswered = currentPromptQuestion
    ? isRuntimePromptQuestionAnswered(
        currentPromptQuestion,
        promptAnswers[currentPromptQuestion.id],
        promptCustomAnswers[currentPromptQuestion.id]
      )
    : false
  const isLastPromptQuestion = activeQuestionPrompt
    ? currentPromptQuestionIndex === activeQuestionPrompt.questions.length - 1
    : false

  const atMenuKey = composerTextInput.startsWith("@") ? `at:${composerTextInput}` : null
  const showSlashMenu =
    allowSlashCommands &&
    !isPromptActive &&
    !isComposerLocked &&
    !isWorking &&
    slashCommandQuery !== null &&
    !isSlashMenuDismissed

  const showAtMenu =
    !isPromptActive &&
    !isComposerLocked &&
    composerTextInput.startsWith("@") &&
    !isWorking &&
    dismissedMenuKey !== atMenuKey
  const atQuery = showAtMenu ? composerTextInput.slice(1) : ""
  const canSubmit = activeQuestionPrompt
    ? !!currentPromptQuestion && currentPromptQuestionAnswered
    : activeApprovalPrompt
      ? false
    : (composerTextInput.trim().length > 0 || attachments.length > 0) &&
        !isWorking &&
        !isComposerLocked

  useEffect(() => {
    void initializeSettings()
  }, [initializeSettings])

  useEffect(() => {
    setPromptAnswers({})
    setPromptCustomAnswers({})
    setCurrentPromptQuestionIndex(0)
  }, [prompt?.id])

  useEffect(() => {
    setSelectedModelId(
      resolveSessionSelectedModelId(
        activeSessionModelId,
        availableModels.map((model) => model.id)
      )
    )
  }, [activeSession?.id, activeSessionModelId, availableModels, selectedWorktreeId])

  useEffect(() => {
    setReasoningEffortOverride(null)
    setFastModeOverride(null)
  }, [activeSession?.id, effectiveModel?.id, selectedHarnessId, selectedWorktreeId])

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
    }
  }, [slashCommandQuery])

  useEffect(() => {
    if (
      !currentPromptQuestion ||
      currentPromptQuestion.kind !== "single_select" ||
      !currentPromptQuestion.options?.length
    ) {
      return
    }

    const existingAnswer = promptAnswers[currentPromptQuestion.id]
    const existingCustomAnswer = promptCustomAnswers[currentPromptQuestion.id]?.trim()
    if (
      (typeof existingAnswer === "string" && existingAnswer.trim().length > 0) ||
      (Array.isArray(existingAnswer) && existingAnswer.length > 0) ||
      existingCustomAnswer
    ) {
      return
    }

    setPromptAnswers((current) => ({
      ...current,
      [currentPromptQuestion.id]: currentPromptQuestion.options?.[0]?.label ?? "",
    }))
  }, [currentPromptQuestion, promptAnswers, promptCustomAnswers])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || isPromptActive) {
      return
    }

    const commandSignatureChanged = previousCommandSignatureRef.current !== commandSignature
    previousCommandSignatureRef.current = commandSignature

    if (!commandSignatureChanged && input === serializedComposerValueRef.current) {
      return
    }

    editor.update(() => {
      populateComposerFromSerializedValue(input, commandsByReference, attachmentsById)
    })
    serializedComposerValueRef.current = input
  }, [attachmentsById, commandSignature, commandsByReference, input, isPromptActive])

  // Search files when @ query changes
  useEffect(() => {
    if (showAtMenu && atQuery.length > 0) {
      searchFiles(atQuery)
    } else {
      clearFiles()
    }
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

  // Reset selected index when filtered items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredCommands.length, atMenuTotalItems])

  const runSystemSlashCommand = useCallback(
    (command: NormalizedCommand) => {
      if (command.action === "new-chat") {
        if (!selectedWorktreeId || !selectedWorktreePath) {
          return
        }

        const session = createOptimisticSession(selectedWorktreeId, selectedWorktreePath)
        if (session) {
          setInput("")
          setDismissedMenuKey(null)
          setIsSlashMenuDismissed(false)
          openChatSession(session.id, session.title)
        }
        return
      }

      if (command.action === "new-terminal") {
        if (!selectedWorktreeId) {
          return
        }

        setInput("")
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

        setInput("")
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
      createOptimisticSession,
      openTerminalTab,
      openChatSession,
      selectedProject,
      selectedWorktreeId,
      selectedWorktreePath,
      setInput,
    ]
  )

  const handleSelectCommand = useCallback(
    (command: NormalizedCommand) => {
      if (command.execution === "run") {
        suppressNextSubmitRef.current = true
        runSystemSlashCommand(command)
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
    [focusComposer, runSystemSlashCommand]
  )

  const handleSelectAgent = useCallback(
    (agent: NormalizedAgent) => {
      setDismissedMenuKey(null)
      setInput(`@${agent.name} `)
      requestAnimationFrame(() => {
        focusComposer()
      })
    },
    [focusComposer, setInput]
  )

  const handleSelectFile = useCallback(
    (file: FileItem) => {
      setDismissedMenuKey(null)
      setInput(`${file.path} `)
      requestAnimationFrame(() => {
        focusComposer()
      })
    },
    [focusComposer, setInput]
  )

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
    []
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

    await desktop.git.ensureInfoExcludeEntries(selectedWorktreePath, ["/.nucleus/"])
    return selectedWorktreePath
  }, [selectedWorktreePath])

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

  const closeSlashMenu = useCallback(() => {
    setIsSlashMenuDismissed(true)
  }, [])

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

  const handlePromptAnswerChange = useCallback(
    (questionId: string, value: string | string[]) => {
      setPromptAnswers((current) => ({
        ...current,
        [questionId]: value,
      }))

      if (
        activeQuestionPrompt &&
        currentPromptQuestion &&
        currentPromptQuestion.id === questionId &&
        currentPromptQuestion.kind === "single_select" &&
        !currentPromptQuestion.allowOther &&
        isRuntimePromptQuestionAnswered(
          currentPromptQuestion,
          value,
          promptCustomAnswers[currentPromptQuestion.id]
        ) &&
        !isLastPromptQuestion
      ) {
        setCurrentPromptQuestionIndex((index) =>
          Math.min(index + 1, activeQuestionPrompt.questions.length - 1)
        )
      }
    },
    [activeQuestionPrompt, currentPromptQuestion, isLastPromptQuestion, promptCustomAnswers]
  )

  const handlePromptCustomAnswerChange = useCallback(
    (questionId: string, value: string) => {
      const question = activeQuestionPrompt?.questions.find((candidate) => candidate.id === questionId)

      setPromptCustomAnswers((current) => ({
        ...current,
        [questionId]: value,
      }))

      if (question?.kind === "single_select" && question.allowOther) {
        setPromptAnswers((current) => ({
          ...current,
          [questionId]: "",
        }))
      }
    },
    [activeQuestionPrompt]
  )

  const handlePromptCustomAnswerFocus = useCallback(
    (questionId: string) => {
      const question = activeQuestionPrompt?.questions.find((candidate) => candidate.id === questionId)

      if (!question?.allowOther) {
        return
      }

      setPromptAnswers((current) => {
        if (question.kind === "multi_select") {
          return {
            ...current,
            [questionId]: [],
          }
        }

        return {
          ...current,
          [questionId]: "",
        }
      })
    },
    [activeQuestionPrompt]
  )

  const handleDismissPrompt = useCallback(() => {
    onDismissPrompt?.()
  }, [onDismissPrompt])

  const handleApprovePrompt = useCallback(() => {
    if (!activeApprovalPrompt) {
      return
    }

    onAnswerPrompt?.(createRuntimeApprovalResponse(activeApprovalPrompt, "approve"))
  }, [activeApprovalPrompt, onAnswerPrompt])

  const handleDenyPrompt = useCallback(() => {
    if (!activeApprovalPrompt) {
      handleDismissPrompt()
      return
    }

    onAnswerPrompt?.(createRuntimeApprovalResponse(activeApprovalPrompt, "deny"))
  }, [activeApprovalPrompt, handleDismissPrompt, onAnswerPrompt])

  const handleGoToPreviousPromptQuestion = useCallback(() => {
    setCurrentPromptQuestionIndex((index) => Math.max(index - 1, 0))
  }, [])

  const handleGoToNextPromptQuestion = useCallback(() => {
    if (!activeQuestionPrompt) {
      return
    }

    setCurrentPromptQuestionIndex((index) =>
      Math.min(index + 1, activeQuestionPrompt.questions.length - 1)
    )
  }, [activeQuestionPrompt])

  useEffect(() => {
    if (!isPromptActive) {
      return
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || event.isComposing) {
        return
      }

      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        activeApprovalPrompt
      ) {
        event.preventDefault()
        handleApprovePrompt()
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        if (activeApprovalPrompt) {
          handleDenyPrompt()
          return
        }

        handleDismissPrompt()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    activeApprovalPrompt,
    handleApprovePrompt,
    handleDenyPrompt,
    handleDismissPrompt,
    isPromptActive,
  ])

  const promptProgressLabel = activeQuestionPrompt
    ? `${currentPromptQuestionIndex + 1} of ${activeQuestionPrompt.questions.length}`
    : null

  const isFirstPromptQuestion = currentPromptQuestionIndex === 0

  const selectorsRow = !isPromptActive
  const promptCtaLabel = isLastPromptQuestion ? "Submit" : "Continue"

  const handlePlanModeMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    skipNextPlanToggleClickRef.current = true
    togglePlanMode()
  }, [togglePlanMode])

  const handlePlanModeClick = useCallback(() => {
    if (skipNextPlanToggleClickRef.current) {
      skipNextPlanToggleClickRef.current = false
      return
    }

    togglePlanMode()
  }, [togglePlanMode])

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

      if (activeApprovalPrompt) {
        return
      }

      if (activeQuestionPrompt) {
        if (!currentPromptQuestion || !currentPromptQuestionAnswered) {
          return
        }

        if (!isLastPromptQuestion) {
          setCurrentPromptQuestionIndex((index) =>
            Math.min(index + 1, activeQuestionPrompt.questions.length - 1)
          )
          return
        }

        onAnswerPrompt?.(
          createRuntimePromptResponse(activeQuestionPrompt, promptAnswers, promptCustomAnswers)
        )
        setCurrentPromptQuestionIndex(0)
        setPromptAnswers({})
        setPromptCustomAnswers({})
        return
      }

      const activeSlashCommandQuery = allowSlashCommands
        ? getActiveSlashCommandQuery(composerTextInput)
        : null

      if (activeSlashCommandQuery !== null) {
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
        collectAttachmentIdsFromComposerValue(input).includes(attachment.id)
      )
      if (allowSlashCommands && trimmedInput.startsWith("/") && !trimmedInput.includes(" ")) {
        const commandName = trimmedInput.slice(1)
        const matchingCommand = commands.find((command) => command.name === commandName)

        if (matchingCommand?.isPreview) {
          return
        }

        if (matchingCommand && onExecuteCommand) {
          onExecuteCommand(matchingCommand.name, "")
          setDismissedMenuKey(null)
          setInput("")
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
          agent: agentName,
          collaborationMode,
          model: effectiveModel?.id ?? undefined,
          reasoningEffort: collaborationMode ? reasoningEffort : null,
          fastMode: collaborationMode ? fastMode : false,
        })
      } else {
        onSubmit(trimmedInput, {
          attachments: attachmentsForSubmit,
          collaborationMode,
          model: effectiveModel?.id ?? undefined,
          reasoningEffort: collaborationMode ? reasoningEffort : null,
          fastMode: collaborationMode ? fastMode : false,
        })
      }
    },
    [
      canSubmit,
      composerTextInput,
      input,
      isPromptActive,
      onSubmit,
      onAnswerPrompt,
      activeQuestionPrompt,
      activeApprovalPrompt,
      promptAnswers,
      promptCustomAnswers,
      isPlanModeAvailable,
      isPlanModeEnabled,
      effectiveModel?.id,
      reasoningEffort,
      fastMode,
      currentPromptQuestion,
      currentPromptQuestionAnswered,
      isLastPromptQuestion,
      commands,
      onExecuteCommand,
      setInput,
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

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (isComposerLocked) {
        e.preventDefault()
        return
      }

      if (isPromptActive) {
        return
      }

      if (
        e.key === "Backspace" &&
        !showSlashMenu &&
        !showAtMenu &&
        deleteAdjacentChip()
      ) {
        e.preventDefault()
        return
      }

      if (showSlashMenu) {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          )
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          )
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          closeSlashMenu()
          return
        }
        if (e.key === "Tab") {
          e.preventDefault()
          const selectedCommand = filteredCommands[selectedIndex]
          if (selectedCommand) {
            handleSelectCommand(selectedCommand)
          }
          return
        }
        if (e.key === "Enter" && !e.shiftKey && !isImeComposing) {
          e.preventDefault()
          e.stopPropagation()
          const selectedCommand = filteredCommands[selectedIndex]
          if (selectedCommand) {
            handleSelectCommand(selectedCommand)
          }
          return
        }
      }

      // Handle @ menu navigation
      if (showAtMenu && atMenuTotalItems > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev < atMenuTotalItems - 1 ? prev + 1 : 0
          )
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : atMenuTotalItems - 1
          )
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          closeAtMenu()
          return
        }
        if (e.key === "Tab") {
          e.preventDefault()
          if (selectedIndex < filteredAgents.length) {
            setInput(`@${filteredAgents[selectedIndex].name} `)
          } else {
            setInput(`${filteredFiles[selectedIndex - filteredAgents.length].path} `)
          }
          return
        }
      }

      if (e.key === "Enter" && !e.shiftKey && !isImeComposing) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [
      handleSubmit,
      isImeComposing,
      isComposerLocked,
      isPromptActive,
      showSlashMenu,
      slashCommandQuery,
      filteredCommands,
      selectedIndex,
      closeSlashMenu,
      handleSelectCommand,
      showAtMenu,
      atMenuTotalItems,
      filteredAgents,
      filteredFiles,
      closeAtMenu,
      deleteAdjacentChip,
    ]
  )

  const handleComposerChange = useCallback(
    (editorState: EditorState) => {
      const nextValue = editorState.read(() => serializeComposerState())
      serializedComposerValueRef.current = nextValue
      reconcileDraftAttachments(nextValue)

      if (nextValue !== input) {
        setDismissedMenuKey(null)
        setInput(nextValue)
      }
    },
    [input, reconcileDraftAttachments, setInput]
  )

  const composerInitialConfig = useMemo(
    () => ({
      namespace: "nucleus-chat-composer",
      nodes: [SkillChipNode, UploadChipNode],
      onError(error: Error) {
        throw error
      },
      editorState() {
        populateComposerFromSerializedValue(input, commandsByReference, attachmentsById)
      },
    }),
    [attachmentsById, commandsByReference, input]
  )

  const placeholder = getChatInputPlaceholder(placement)

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

  const handleSelectModel = useCallback(
    (modelId: string | null) => {
      const trimmedModelId = modelId?.trim() || null
      const normalizedModelId =
        trimmedModelId && composerBaselineModelId === trimmedModelId ? null : trimmedModelId
      setSelectedModelId(normalizedModelId)

      if (!activeSession?.id) {
        return
      }

      void setSessionModel(activeSession.id, normalizedModelId)
    },
    [activeSession?.id, composerBaselineModelId, setSessionModel]
  )

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        placement === "intro" ? "w-full bg-transparent px-0 pb-0" : "bg-main-content px-10 pb-3"
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
      <div
        ref={composerMenuAnchorRef}
        className={cn(
          "relative overflow-hidden border bg-card shadow-sm",
          placement === "intro" ? "rounded-xl" : "rounded-2xl",
          isApprovalComposerState
            ? "border-[var(--color-chat-approval-border)] bg-[var(--color-chat-approval-surface)]"
            : isPlanModeEnabled
              ? "border-[var(--color-chat-plan-border)] bg-[var(--color-chat-plan-surface)] shadow-[0_0_0_1px_var(--color-chat-plan-border)]"
            : "border-border"
        )}
      >
        {activePlan && (
          <div
            className={cn(
              "relative border-b",
              isApprovalComposerState
                ? "border-[var(--color-chat-approval-border)]"
                : isPlanModeEnabled
                  ? "border-[var(--color-chat-plan-border)]"
                : "border-border"
            )}
          >
            {activePlan && (
              <div className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                    <Brain className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{activePlan.title}</p>
                        {activePlan.summary && (
                          <p className="mt-0.5 text-sm text-muted-foreground">{activePlan.summary}</p>
                        )}
                      </div>
                      <span className="rounded-full border border-border bg-muted px-2 py-1 text-sm text-muted-foreground">
                        {activePlan.steps.length} steps
                      </span>
                    </div>
                    <div className="mt-3 flex flex-col gap-2">
                      {activePlan.steps.map((step, index) => {
                        const StepIcon =
                          step.status === "completed" ? CheckCircle : Circle

                        return (
                          <div key={step.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <StepIcon
                              className={
                                step.status === "completed"
                                  ? "size-3.5 text-foreground"
                                  : "size-3.5 text-muted-foreground/60"
                              }
                            />
                            <span className="text-sm text-muted-foreground/70">{index + 1}.</span>
                            <span className={step.status === "completed" ? "text-foreground" : ""}>
                              {step.label}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div
          className={cn(
            "relative px-4 pt-3 pb-3"
          )}
        >
          {isComposerLocked ? (
            <div className="flex items-center gap-3 py-2 px-1">
              <Loader size={14} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Setting up workspace…</span>
            </div>
          ) : isPromptActive && prompt ? (
            activeApprovalPrompt ? (
              <ApprovalPromptSurface
                prompt={activeApprovalPrompt}
                onApprove={handleApprovePrompt}
                onDeny={handleDenyPrompt}
              />
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
            ) : null
          ) : (
            <div>
              <ComposerEditorSurface
                editorRef={editorRef}
                initialConfig={composerInitialConfig}
                isLocked={isComposerLocked}
                isStreaming={isWorking}
                onChange={handleComposerChange}
                onKeyDown={handleKeyDown}
                onPaste={handleComposerPaste}
                onDragOver={handleComposerDragOver}
                onDrop={handleComposerDrop}
                onCompositionStart={() => setIsImeComposing(true)}
                onCompositionEnd={() => setIsImeComposing(false)}
                onFocus={() => setIsComposerFocused(true)}
                onBlur={() => setIsComposerFocused(false)}
                placeholder={placeholder}
              />

              {!isComposerFocused ? (
                <div className="pointer-events-none absolute top-3 right-4 z-10 text-sm leading-5 text-muted-foreground/58">
                  <span className="text-foreground/84">{focusChatInputHint}</span>
                  <span className="text-muted-foreground/58"> to focus</span>
                </div>
              ) : null}

              {showSlashMenu ? (
                <ComposerFloatingOverlay anchorRef={composerMenuAnchorRef}>
                  <SlashCommandMenu
                    commands={filteredCommands}
                    query={slashCommandQuery ?? ""}
                    isLoading={isLoadingCommands}
                    onSelect={handleSelectCommand}
                    onClose={closeSlashMenu}
                    selectedIndex={selectedIndex}
                  />
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
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {uploadError}
            </div>
          ) : null}

          {!isPromptActive && !isComposerLocked && (
            <div className="mt-2 flex items-center gap-2">
              {selectorsRow && <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex h-8 items-center gap-2 px-1 text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
                aria-label={selectedModelLabel}
                title={selectedModelLabel}
              >
                <ModelLogo kind={selectedModelLogoKind} className="size-[18px] shrink-0" />
                <span>{selectedModelLabel}</span>
                <CaretDown className="size-3 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {availableModels.length > 0 ? (
                  <>
                    {modelGroups.map((group, groupIndex) => (
                      <div key={group.key}>
                        {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="px-2 py-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/78">
                            <span>{group.label}</span>
                          </DropdownMenuLabel>
                          {group.models.map(({ model, logoKind }) => (
                            <DropdownMenuItem
                              key={model.id}
                              onClick={() => handleSelectModel(model.id)}
                              className="flex items-center justify-between gap-3"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <ModelLogo kind={logoKind} className="size-5 shrink-0 text-muted-foreground/82" />
                                <span className="truncate">{getRuntimeModelLabel(model)}</span>
                              </span>
                              {model.id === effectiveModelId ? (
                                <CheckCircle className="size-3.5 text-muted-foreground" />
                              ) : null}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuGroup>
                      </div>
                    ))}
                  </>
                ) : (
                  <DropdownMenuItem disabled>
                    <span>{isLoadingModels ? "Loading models..." : "No models available"}</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
              </DropdownMenu>}

              {selectorsRow && <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 items-center gap-2 px-1 text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer">
                <span>{reasoningEffortLabel}</span>
                <CaretDown className="size-3 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                {availableReasoningEfforts.length > 0 ? (
                  availableReasoningEfforts.map((effort) => (
                    <DropdownMenuItem
                      key={effort}
                      onClick={() => setReasoningEffortOverride(effort)}
                      className="flex items-center justify-between gap-3"
                    >
                      <span>{formatReasoningEffortLabel(effort)}</span>
                      {effort === reasoningEffort && <CheckCircle className="size-3.5 text-muted-foreground" />}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>
                    <span>{isLoadingModels ? "Loading effort..." : "No effort options"}</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
              </DropdownMenu>}

              {selectorsRow && isCodexHarness && supportsFastMode && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setFastModeOverride((current) => (current == null ? !fastMode : !current))}
                      aria-label={fastMode ? "Disable fast mode" : "Enable fast mode"}
                      className={cn(
                        "inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-transparent text-muted-foreground transition-colors",
                        "hover:text-foreground",
                        fastMode && supportsFastMode ? "bg-amber-500/10 px-2" : "w-7",
                        fastMode &&
                          supportsFastMode &&
                          "text-amber-500 hover:text-amber-600 dark:text-amber-300 dark:hover:text-amber-200"
                      )}
                    >
                      <Zap className="size-4 shrink-0" />
                      {fastMode && supportsFastMode ? (
                        <span className="overflow-hidden text-[10px] font-semibold uppercase tracking-[0.08em]">
                          Fast
                        </span>
                      ) : null}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{fastModeTooltipLabel}</TooltipContent>
                </Tooltip>
              )}

              {selectorsRow && isPlanModeAvailable && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onMouseDown={handlePlanModeMouseDown}
                      onClick={handlePlanModeClick}
                      aria-label={isPlanModeEnabled ? "Disable plan mode" : "Toggle plan mode"}
                      className={cn(
                        "inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-transparent text-muted-foreground transition-colors",
                        "hover:text-foreground",
                        isPlanModeEnabled ? "bg-[var(--color-chat-plan-surface)] px-2" : "w-7",
                        isPlanModeEnabled &&
                          "text-[var(--color-chat-plan-accent)] hover:text-[var(--color-chat-plan-accent)]"
                      )}
                    >
                      <DocumentValidation className="size-4 shrink-0" />
                      {isPlanModeEnabled ? (
                        <span className="overflow-hidden text-[10px] font-semibold uppercase tracking-[0.08em]">
                          Plan
                        </span>
                      ) : null}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{`Plan mode (${planModeShortcutLabel})`}</TooltipContent>
                </Tooltip>
              )}

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isWorking}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Add upload"
                >
                  <Paperclip className="size-4" />
                </button>
                {isStreaming ? (
                <button
                  type="button"
                  onClick={onAbort}
                  className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-85"
                >
                  <Stop weight="fill" className="size-4" />
                </button>
                ) : (
                <button
                  type="submit"
                  disabled={!canSubmit && !showSlashMenu && !showAtMenu}
                  className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                >
                  <ArrowUp02 weight="bold" className="size-4" />
                </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </form>
  )
}
