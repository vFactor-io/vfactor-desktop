import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/features/shared/components/ui/alert-dialog"
import { Clock } from "@/components/icons"
import { useAppUpdateStore } from "@/features/updates/store/updateStore"

export function UpdateBlockedDialog() {
  const blockedDialogOpen = useAppUpdateStore((state) => state.blockedDialogOpen)
  const updateState = useAppUpdateStore((state) => state.updateState)
  const closeBlockedDialog = useAppUpdateStore((state) => state.closeBlockedDialog)
  const dismissUpdate = useAppUpdateStore((state) => state.dismissUpdate)
  const installUpdate = useAppUpdateStore((state) => state.installUpdate)

  const activeWork = updateState.activeWork

  return (
    <AlertDialog
      open={blockedDialogOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeBlockedDialog()
        }
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-amber-500/12 text-amber-600">
            <Clock size={18} />
          </AlertDialogMedia>
          <AlertDialogTitle>Restart anyway?</AlertDialogTitle>
          <AlertDialogDescription>
            Restarting now will interrupt active coding work. Nucleus found:
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-xl border border-border/70 bg-muted/35 px-3 py-3">
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {activeWork?.labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              void dismissUpdate()
            }}
          >
            Not now
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void installUpdate({ force: true })
            }}
          >
            Restart anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
