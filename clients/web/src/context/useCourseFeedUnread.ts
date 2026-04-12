import { useContext } from 'react'
import { CourseFeedUnreadContext } from './courseFeedUnreadContext'

const noop = () => {}

export function useCourseFeedUnread() {
  const ctx = useContext(CourseFeedUnreadContext)
  if (!ctx) {
    return {
      feedUnreadForChannel: () => 0,
      clearFeedChannelUnread: noop,
      setViewedFeedChannel: noop,
    } as const
  }
  return ctx
}
