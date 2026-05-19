import type { Awareness } from 'y-protocols/awareness'
import { useEffect, useState } from 'react'
import { colorForUser } from './collab-utils'

interface AwarenessUser {
  name: string
  color: string
}

interface PresenceState {
  user?: AwarenessUser
}

type PresenceBarProps = {
  awareness: Awareness
  selfName?: string
  selfColor?: string
}

export function PresenceBar({ awareness, selfName = 'You', selfColor }: PresenceBarProps) {
  const [states, setStates] = useState<Map<number, PresenceState>>(new Map())

  useEffect(() => {
    const color = selfColor ?? colorForUser(selfName)
    awareness.setLocalStateField('user', { name: selfName, color })

    const onChange = () => {
      setStates(new Map(awareness.getStates() as Map<number, PresenceState>))
    }
    awareness.on('change', onChange)
    onChange()
    return () => { awareness.off('change', onChange) }
  }, [awareness, selfName, selfColor])

  const users: { clientId: number; user: AwarenessUser }[] = []
  states.forEach((state, clientId) => {
    if (state.user) users.push({ clientId, user: state.user })
  })

  if (users.length === 0) return null

  const MAX_SHOW = 5
  const shown = users.slice(0, MAX_SHOW)
  const overflow = users.length - MAX_SHOW

  return (
    <div className="flex items-center gap-1" aria-label="Active collaborators">
      {shown.map(({ clientId, user }) => (
        <span
          key={clientId}
          title={user.name}
          aria-label={`${user.name} is editing`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white dark:ring-neutral-800"
          style={{ backgroundColor: user.color }}
        >
          {user.name.charAt(0).toUpperCase()}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-300 text-xs font-semibold text-slate-700 ring-2 ring-white dark:bg-neutral-600 dark:text-neutral-100 dark:ring-neutral-800">
          +{overflow}
        </span>
      )}
    </div>
  )
}
