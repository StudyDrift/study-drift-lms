import { createContext } from 'react'

export type InboxUnreadValue = {
  unreadInboxCount: number
  /** Incremented on each realtime mailbox event so lists can refetch. */
  mailboxRevision: number
  refreshUnread: () => Promise<void>
}

export const InboxUnreadContext = createContext<InboxUnreadValue | null>(null)
