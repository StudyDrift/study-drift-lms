import { toast as sonnerToast } from 'sonner'

export const toast = sonnerToast

export function toastSaveOk(message = 'Saved') {
  sonnerToast.success(message)
}

export function toastMutationError(message: string) {
  sonnerToast.error(message)
}
