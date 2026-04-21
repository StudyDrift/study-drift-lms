import { Toaster } from 'sonner'
import { useLmsDarkMode } from '../hooks/use-lms-dark-mode'

/**
 * Global toast queue: top-right, stacks, auto-dismiss. Sonner uses a live region
 * for screen reader announcements (polite updates).
 */
export function LmsToaster() {
  const dark = useLmsDarkMode()
  return (
    <Toaster
      position="top-right"
      closeButton
      richColors
      expand={false}
      visibleToasts={5}
      theme={dark ? 'dark' : 'light'}
      toastOptions={{
        duration: 4500,
        classNames: {
          toast: 'font-sans',
        },
      }}
    />
  )
}
