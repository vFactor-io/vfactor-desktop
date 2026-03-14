import { ArrowUp02, Brain, CaretDown, CheckCircle, Circle, Stop } from "@/components/icons"
import { useState, useRef, useCallback, useMemo, useEffect, type KeyboardEvent as ReactKeyboardEvent, type FormEvent } from "react"
import { SlashCommandMenu } from "./SlashCommandMenu"
import { AtMentionMenu, type FileItem } from "./AtMentionMenu"
import { useCommands, type NormalizedCommand } from "../hooks/useCommands"
import { useAgents, type NormalizedAgent } from "../hooks/useAgents"
import { useFileSearch } from "../hooks/useFileSearch"
import type { HarnessDefinition, HarnessId, RuntimePromptResponse } from "../types"
import type { ComposerPlan, ComposerPrompt } from "./composer/types"
import { REASONING_EFFORTS, getModelsForHarness } from "./composer/types"
import {
  createRuntimeApprovalResponse,
  createRuntimePromptResponse,
  isRuntimeApprovalPrompt,
  isRuntimePromptQuestionAnswered,
  isRuntimeQuestionPrompt,
} from "../domain/runtimePrompts"
import { populateComposerFromSerializedValue, serializeComposerState } from "./composer/composerSerialization"
import { ComposerEditorSurface } from "./composer/ComposerEditorSurface"
import { ApprovalPromptSurface } from "./composer/ApprovalPromptSurface"
import { StructuredPromptSurface } from "./composer/StructuredPromptSurface"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/features/shared/components/ui/dropdown-menu"
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
import { cn } from "@/lib/utils"

function getCodexModelId(model: string): string {
  switch (model) {
    case "GPT-5.4":
      return "gpt-5.4"
    case "GPT-5":
      return "gpt-5"
    case "GPT-5 mini":
      return "gpt-5-mini"
    default:
      return model.toLowerCase().replace(/\s+/g, "-")
  }
}

interface ChatInputProps {
  input: string
  setInput: (value: string) => void
  onSubmit: (
    text: string,
    options?: {
      agent?: string
      collaborationMode?: "default" | "plan"
      model?: string
      reasoningEffort?: "low" | "medium" | "high" | null
    }
  ) => void
  onAbort?: () => void
  onExecuteCommand?: (command: string, args?: string) => void
  harnesses: HarnessDefinition[]
  selectedHarnessId: HarnessId | null
  onSelectHarness?: (harnessId: HarnessId) => void
  status: "idle" | "streaming" | "error"
  activePlan?: ComposerPlan | null
  prompt?: ComposerPrompt | null
  onAnswerPrompt?: (response: RuntimePromptResponse) => void
  onDismissPrompt?: () => void
}

export function ChatInput({
  input,
  setInput,
  onSubmit,
  onAbort,
  onExecuteCommand,
  harnesses,
  selectedHarnessId,
  onSelectHarness,
  status,
  activePlan,
  prompt,
  onAnswerPrompt,
  onDismissPrompt,
}: ChatInputProps) {
  const [isImeComposing, setIsImeComposing] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dismissedMenuKey, setDismissedMenuKey] = useState<string | null>(null)
  const [slashQuery, setSlashQuery] = useState("")
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false)
  const [isPlanModeEnabled, setIsPlanModeEnabled] = useState(false)
  const [promptAnswers, setPromptAnswers] = useState<Record<string, string | string[]>>({})
  const [promptCustomAnswers, setPromptCustomAnswers] = useState<Record<string, string>>({})
  const [currentPromptQuestionIndex, setCurrentPromptQuestionIndex] = useState(0)
  const availableModels = useMemo(
    () => getModelsForHarness(selectedHarnessId),
    [selectedHarnessId]
  )
  const [selectedModel, setSelectedModel] = useState(availableModels[0] ?? "Default model")
  const [reasoningEffort, setReasoningEffort] = useState<(typeof REASONING_EFFORTS)[number]>("High")
  const editorRef = useRef<LexicalEditor | null>(null)
  const serializedComposerValueRef = useRef(input)
  const previousCommandSignatureRef = useRef("")

  const { commands, isLoading: isLoadingCommands } = useCommands()
  const { agents, isLoading: isLoadingAgents } = useAgents()
  const { results: fileResults, isLoading: isLoadingFiles, search: searchFiles, clear: clearFiles } = useFileSearch()
  const selectedHarness = harnesses.find((harness) => harness.id === selectedHarnessId) ?? null
  const isPlanModeAvailable = selectedHarnessId === "codex"
  const skillCommands = useMemo(
    () => commands.filter((command) => !!command.referenceName),
    [commands]
  )
  const commandsByReference = useMemo(
    () =>
      new Map(
        skillCommands.flatMap((command) =>
          command.referenceName ? [[command.referenceName.toLowerCase(), command] as const] : []
        )
      ),
    [skillCommands]
  )
  const commandSignature = useMemo(
    () => skillCommands.map((command) => command.referenceName).filter(Boolean).join("|"),
    [skillCommands]
  )

  const isStreaming = status === "streaming"
  const isPromptActive = !!prompt
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

  const atMenuKey = input.startsWith("@") ? `at:${input}` : null
  const showSlashMenu = !isPromptActive && isSlashMenuOpen && !isStreaming

  const showAtMenu = !isPromptActive && input.startsWith("@") && !isStreaming && dismissedMenuKey !== atMenuKey
  const atQuery = showAtMenu ? input.slice(1) : ""
  const canSubmit = activeQuestionPrompt
    ? !!currentPromptQuestion && currentPromptQuestionAnswered
    : activeApprovalPrompt
      ? false
    : input.trim().length > 0 && !isStreaming

  useEffect(() => {
    setPromptAnswers({})
    setPromptCustomAnswers({})
    setCurrentPromptQuestionIndex(0)
  }, [prompt?.id])

  useEffect(() => {
    setSelectedModel(availableModels[0] ?? "Default model")
  }, [availableModels])

  useEffect(() => {
    if (!isPlanModeAvailable) {
      setIsPlanModeEnabled(false)
    }
  }, [isPlanModeAvailable])

  useEffect(() => {
    if (isPromptActive) {
      setIsSlashMenuOpen(false)
      setSlashQuery("")
    }
  }, [isPromptActive])

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
      populateComposerFromSerializedValue(input, commandsByReference)
    })
    serializedComposerValueRef.current = input
  }, [commandSignature, commandsByReference, input, isPromptActive])

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
    
    const lowerQuery = slashQuery.toLowerCase()
    if (!lowerQuery) return skillCommands
    
    return skillCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lowerQuery) ||
        cmd.description.toLowerCase().includes(lowerQuery)
    )
  }, [showSlashMenu, skillCommands, slashQuery])

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

  const handleSelectCommand = useCallback(
    (command: NormalizedCommand) => {
      const referenceName = command.referenceName
      const editor = editorRef.current

      if (!referenceName || !editor) {
        return
      }

      editor.focus()
      editor.update(() => {
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
      setIsSlashMenuOpen(false)
      setSlashQuery("")
    },
    []
  )

  const handleSelectAgent = useCallback(
    (agent: NormalizedAgent) => {
      setDismissedMenuKey(null)
      setInput(`@${agent.name} `)
      requestAnimationFrame(() => {
        editorRef.current?.focus()
      })
    },
    [setInput]
  )

  const handleSelectFile = useCallback(
    (file: FileItem) => {
      setDismissedMenuKey(null)
      setInput(`${file.path} `)
      requestAnimationFrame(() => {
        editorRef.current?.focus()
      })
    },
    [setInput]
  )

  const closeSlashMenu = useCallback(() => {
    setIsSlashMenuOpen(false)
    setSlashQuery("")
  }, [])

  const closeAtMenu = useCallback(() => {
    if (atMenuKey) {
      setDismissedMenuKey(atMenuKey)
    }
  }, [atMenuKey])

  const deleteAdjacentSkillChip = useCallback(() => {
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

      if (!$isSkillChipNode(previousNode)) {
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
  }, [activeApprovalPrompt, handleDenyPrompt, handleDismissPrompt, isPromptActive])

  const promptProgressLabel = activeQuestionPrompt
    ? `${currentPromptQuestionIndex + 1} of ${activeQuestionPrompt.questions.length}`
    : null

  const isFirstPromptQuestion = currentPromptQuestionIndex === 0

  const selectorsRow = !isPromptActive
  const promptCtaLabel = isLastPromptQuestion ? "Submit" : "Continue"
  

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault()

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

      const trimmedInput = input.trim()
      if (trimmedInput.startsWith("/") && !trimmedInput.includes(" ")) {
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
      const agentMatch = input.match(/^@(\w+)\s+(.*)$/s)
      const collaborationMode = isPlanModeAvailable
        ? (isPlanModeEnabled ? "plan" : "default")
        : undefined
      const reasoningEffortValue =
        reasoningEffort.toLowerCase() as "low" | "medium" | "high"
      const selectedModelId = isPlanModeAvailable ? getCodexModelId(selectedModel) : selectedModel
      if (agentMatch) {
        const [, agentName, message] = agentMatch
        onSubmit(message.trim(), {
          agent: agentName,
          collaborationMode,
          model: selectedModelId,
          reasoningEffort: collaborationMode ? reasoningEffortValue : null,
        })
      } else {
        onSubmit(input.trim(), {
          collaborationMode,
          model: selectedModelId,
          reasoningEffort: collaborationMode ? reasoningEffortValue : null,
        })
      }
    },
    [
      canSubmit,
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
      selectedModel,
      reasoningEffort,
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
    ]
  )

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (isPromptActive) {
        return
      }

      if (
        e.key === "Backspace" &&
        !showSlashMenu &&
        !showAtMenu &&
        deleteAdjacentSkillChip()
      ) {
        e.preventDefault()
        return
      }

      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !showAtMenu
      ) {
        e.preventDefault()
        setDismissedMenuKey(null)
        setIsSlashMenuOpen(true)
        setSlashQuery("")
        setSelectedIndex(0)
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
        if (e.key === "Backspace") {
          e.preventDefault()

          if (slashQuery.length > 0) {
            setSlashQuery((current) => current.slice(0, -1))
          } else {
            closeSlashMenu()
          }

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
          const selectedCommand = filteredCommands[selectedIndex]
          if (selectedCommand) {
            handleSelectCommand(selectedCommand)
          }
          return
        }
        if (e.key === " " && slashQuery.length === 0) {
          e.preventDefault()
          closeSlashMenu()
          return
        }
        if (
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          e.preventDefault()
          setSlashQuery((current) => `${current}${e.key}`)
          setSelectedIndex(0)
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
      isPromptActive,
      showSlashMenu,
      slashQuery.length,
      filteredCommands,
      selectedIndex,
      closeSlashMenu,
      handleSelectCommand,
      showAtMenu,
      atMenuTotalItems,
      filteredAgents,
      filteredFiles,
      closeAtMenu,
      deleteAdjacentSkillChip,
    ]
  )

  const handleComposerChange = useCallback(
    (editorState: EditorState) => {
      const nextValue = editorState.read(() => serializeComposerState())
      serializedComposerValueRef.current = nextValue

      if (nextValue !== input) {
        setDismissedMenuKey(null)
        setInput(nextValue)
      }
    },
    [input, setInput]
  )

  const composerInitialConfig = useMemo(
    () => ({
      namespace: "nucleus-chat-composer",
      nodes: [SkillChipNode],
      onError(error: Error) {
        throw error
      },
      editorState() {
        populateComposerFromSerializedValue(input, commandsByReference)
      },
    }),
    [commandsByReference, input]
  )

  return (
    <form onSubmit={handleSubmit} className="bg-main-content px-10 pb-3">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors",
          isApprovalComposerState
            ? "border-[var(--color-chat-approval-border)] bg-[var(--color-chat-approval-surface)]"
            : "border-border"
        )}
      >
        {activePlan && (
          <div
            className={cn(
              "relative border-b",
              isApprovalComposerState
                ? "border-[var(--color-chat-approval-border)]"
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
          {isPromptActive && prompt ? (
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
            <>
              <ComposerEditorSurface
                editorRef={editorRef}
                initialConfig={composerInitialConfig}
                isStreaming={isStreaming}
                onChange={handleComposerChange}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => setIsImeComposing(true)}
                onCompositionEnd={() => setIsImeComposing(false)}
                placeholder="Ask anything"
              />

              {showSlashMenu && (
                <div className="mb-3">
                  <SlashCommandMenu
                    commands={filteredCommands}
                    query={slashQuery}
                    isLoading={isLoadingCommands}
                    onSelect={handleSelectCommand}
                    onClose={closeSlashMenu}
                    selectedIndex={selectedIndex}
                  />
                </div>
              )}

              {showAtMenu && (
                <div className="mb-3">
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
                </div>
              )}
            </>
          )}

          {!isPromptActive && (
            <div className="mt-4 flex items-center gap-2">
              {selectorsRow && selectedHarness && (
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-8 items-center gap-2 px-1 text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer">
                  <span>{selectedHarness.label}</span>
                  <CaretDown className="size-3 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {harnesses.map((harness) => (
                    <DropdownMenuItem
                      key={harness.id}
                      onClick={() => onSelectHarness?.(harness.id)}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <div className="flex w-full items-center justify-between gap-3">
                        <span className="font-medium">{harness.label}</span>
                        <span className="text-sm uppercase tracking-wide text-muted-foreground">
                          {harness.adapterStatus}
                        </span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {harness.description}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              )}

              {selectorsRow && isPlanModeAvailable && (
              <button
                type="button"
                onClick={() => setIsPlanModeEnabled((current) => !current)}
                className={`inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-sm transition-colors ${
                  isPlanModeEnabled
                    ? "border-border bg-muted text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Brain className="size-3.5" />
                <span>Plan mode</span>
              </button>
              )}

              {selectorsRow && <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 items-center gap-2 px-1 text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer">
                <span>{selectedModel}</span>
                <CaretDown className="size-3 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {availableModels.map((model) => (
                  <DropdownMenuItem
                    key={model}
                    onClick={() => setSelectedModel(model)}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{model}</span>
                    {model === selectedModel && <CheckCircle className="size-3.5 text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
              </DropdownMenu>}

              {selectorsRow && <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 items-center gap-2 px-1 text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer">
                <span>{reasoningEffort}</span>
                <CaretDown className="size-3 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                {REASONING_EFFORTS.map((effort) => (
                  <DropdownMenuItem
                    key={effort}
                    onClick={() => setReasoningEffort(effort)}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{effort}</span>
                    {effort === reasoningEffort && <CheckCircle className="size-3.5 text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
              </DropdownMenu>}

              <div className="ml-auto flex items-center gap-2">
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
