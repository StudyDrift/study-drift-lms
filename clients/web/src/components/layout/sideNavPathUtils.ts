import { matchPath } from 'react-router-dom'

export type SettingsNavView =
  | 'ai-models'
  | 'ai-prompts'
  | 'account'
  | 'notifications'
  | 'roles'

export function settingsViewFromPathname(pathname: string): SettingsNavView {
  if (pathname.startsWith('/settings/ai/system-prompts')) return 'ai-prompts'
  if (pathname.startsWith('/settings/ai/models')) return 'ai-models'
  const m = matchPath({ path: '/settings/:tab', end: true }, pathname)
  const raw = m?.params.tab
  if (raw === 'account' || raw === 'notifications' || raw === 'roles') return raw
  return 'account'
}

export type CourseSettingsSection =
  | 'basic'
  | 'dates'
  | 'branding'
  | 'grading'
  | 'export-import'
  | 'archived'

export function courseSettingsSectionFromPathname(pathname: string): CourseSettingsSection {
  const m = matchPath({ path: '/courses/:courseCode/settings/*', end: true }, pathname)
  const raw = m?.params['*']?.replace(/^\/+/, '') ?? ''
  const parts = raw.split('/').filter(Boolean)
  if (parts.length > 1) return 'basic'
  if (parts[0] === 'dates') return 'dates'
  if (parts[0] === 'branding') return 'branding'
  if (parts[0] === 'grading') return 'grading'
  if (parts[0] === 'export-import') return 'export-import'
  if (parts[0] === 'archived') return 'archived'
  return 'basic'
}
