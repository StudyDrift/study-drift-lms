import { toast as sonnerToast } from 'sonner'

export const toast = sonnerToast

export function toastSaveOk(message = 'Saved') {
  sonnerToast.success(message)
}

export function toastMutationError(message: string) {
  sonnerToast.error(message)
}

/** Undo toast (~10s) for reversible destructive actions. */
export function toastWithUndo(
  message: string,
  opts: {
    onUndo: () => void | Promise<void>
    durationMs?: number
  },
) {
  return sonnerToast(message, {
    duration: opts.durationMs ?? 10_000,
    action: {
      label: 'Undo',
      onClick: () => {
        void opts.onUndo()
      },
    },
  })
}
