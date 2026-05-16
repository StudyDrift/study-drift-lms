import { createContext } from 'react'

export type InboxUnreadValue = {
  unreadInboxCount: number
  /** Incremented on each realtime mailbox event so lists can refetch. */
  mailboxRevision: number
  /** Incremented on each courses_updated event (create/delete from CLI or UI). */
  coursesRevision: number
  refreshUnread: () => Promise<void>
}

export const InboxUnreadContext = createContext<InboxUnreadValue | null>(null)
