import { CheckCircle, FileCode, Terminal, X } from "@/components/icons"
import type { ComposerApprovalPrompt } from "./types"

interface ApprovalPromptSurfaceProps {
  prompt: ComposerApprovalPrompt
  onApprove: () => void
  onDeny: () => void
  isBusy?: boolean
}

export function ApprovalPromptSurface({
  prompt,
  onApprove,
  onDeny,
  isBusy = false,
}: ApprovalPromptSurfaceProps) {
  const isFileChangeApproval = prompt.approval.kind === "fileChange"
  const fileChanges = prompt.approval.changes ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 px-1 py-1">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-chat-approval-border)] bg-[var(--color-chat-approval-badge)] text-[var(--color-chat-approval-emphasis)]">
          {isFileChangeApproval ? <FileCode className="size-4" /> : <Terminal className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-chat-approval-emphasis)]">
            Approval Required
          </div>
          <p className="mt-1 text-sm font-medium text-foreground">{prompt.title}</p>
          {prompt.body ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{prompt.body}</p>
          ) : null}
        </div>
      </div>

      {isFileChangeApproval ? (
        <div className="space-y-2">
          {fileChanges.length > 0 ? (
            fileChanges.map((change) => (
              <div
                key={`${change.type}:${change.path}`}
                className="rounded-2xl border border-[var(--color-chat-approval-border)] bg-[var(--color-chat-approval-surface-strong)] px-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="rounded-full bg-[var(--color-chat-approval-badge)] px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-chat-approval-emphasis)]">
                    {change.type}
                  </span>
                  <span className="min-w-0 truncate font-mono text-[13px] text-[var(--color-chat-file-accent)]">
                    {change.path}
                  </span>
                </div>
                {change.content || change.diff ? (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-[var(--color-chat-approval-border)] bg-background/75 px-3 py-3 font-mono text-[12px] leading-5 text-foreground/80">
                    {change.content ?? change.diff}
                  </pre>
                ) : null}
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--color-chat-approval-border)] bg-[var(--color-chat-approval-surface-strong)] px-3 py-4 text-sm text-muted-foreground">
              Codex is waiting to apply code changes.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {prompt.approval.reason ? (
            <div className="rounded-2xl border border-[var(--color-chat-approval-border)] bg-[var(--color-chat-approval-surface-strong)] px-3 py-3">
              <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Reason
              </div>
              <div className="text-sm leading-6 text-muted-foreground">{prompt.approval.reason}</div>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDeny}
          disabled={isBusy}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--color-chat-approval-border)] bg-[var(--color-chat-approval-surface-strong)] px-3.5 text-sm text-foreground transition-colors hover:bg-[var(--color-chat-approval-badge)] disabled:opacity-50"
        >
          <X className="size-3.5" />
          <span>Deny</span>
          <span className="rounded-md border border-[var(--color-chat-approval-border)] bg-[var(--color-chat-approval-surface)] px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
            Esc
          </span>
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={isBusy}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--color-chat-approval-emphasis)] px-4 text-sm font-medium text-[var(--color-chat-approval-emphasis-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <CheckCircle className="size-4" />
          <span>Approve</span>
        </button>
      </div>
    </div>
  )
}
