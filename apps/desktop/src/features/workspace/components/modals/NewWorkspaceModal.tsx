import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/features/shared/components/ui/dialog"
import { ChatInput } from "@/features/chat/components"
import type { Project } from "@/features/workspace/types"

interface NewWorkspaceModalProps {
  open: boolean
  project: Project | null
  onOpenChange: (open: boolean) => void
  onContinue: (input: { prompt: string }) => Promise<void> | void
}

export function NewWorkspaceModal({
  open,
  project,
  onOpenChange,
  onContinue,
}: NewWorkspaceModalProps) {
  const [prompt, setPrompt] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const canContinue = prompt.trim().length > 0 && !isSubmitting

  useEffect(() => {
    if (!open) {
      return
    }

    setPrompt("")
    setIsSubmitting(false)
  }, [open, project?.id])

  const handleContinue = async (nextPrompt = prompt) => {
    const trimmedPrompt = nextPrompt.trim()
    if (!trimmedPrompt || isSubmitting) {
      return
    }

    setIsSubmitting(true)

    try {
      await onContinue({
        prompt: trimmedPrompt,
      })
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">
            What should we work on?
          </DialogTitle>
          <DialogDescription>
            Describe the work for this workspace, then continue with the usual setup flow.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0">
          <ChatInput
            placement="intro"
            allowSlashCommands={false}
            input={prompt}
            setInput={setPrompt}
            isLocked={isSubmitting}
            onSubmit={async (text) => {
              await handleContinue(text)
            }}
            status="idle"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
