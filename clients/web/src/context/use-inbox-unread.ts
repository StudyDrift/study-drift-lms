import { useContext } from 'react'
import { InboxUnreadContext } from './inbox-unread-context'

export function useInboxUnreadCount() {
  return useContext(InboxUnreadContext)?.unreadInboxCount ?? 0
}

export function useMailboxRevision() {
  return useContext(InboxUnreadContext)?.mailboxRevision ?? 0
}

export function useRefreshUnread() {
  return useContext(InboxUnreadContext)?.refreshUnread ?? (async () => {})
}
