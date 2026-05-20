import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '../hooks/use-online-status'

export function OfflineBanner() {
  const isOnline = useOnlineStatus()

  if (isOnline) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>You are offline — viewing cached content</span>
    </div>
  )
}
