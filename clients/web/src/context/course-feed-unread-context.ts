import { createContext } from 'react'

export type CourseFeedUnreadValue = {
  /** New posts in a channel while you are not viewing that channel (for this course in the URL). */
  feedUnreadForChannel: (courseCode: string, channelId: string) => number
  clearFeedChannelUnread: (courseCode: string, channelId: string) => void
  /** Feed page sets this so bumps are suppressed for the channel currently on screen. */
  setViewedFeedChannel: (courseCode: string | null, channelId: string | null) => void
  /** Sum of channel bump counts (WebSocket updates while any course route is open). */
  totalFeedUnread: number
}

export const CourseFeedUnreadContext = createContext<CourseFeedUnreadValue | null>(null)
