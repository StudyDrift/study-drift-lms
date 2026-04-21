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
  | 'general'
  | 'grading'
  | 'outcomes'
  | 'features'
  | 'import-export'
  | 'archive'

export function courseSettingsSectionFromPathname(pathname: string): CourseSettingsSection {
  const m = matchPath({ path: '/courses/:courseCode/settings/*', end: true }, pathname)
  const raw = m?.params['*']?.replace(/^\/+/, '') ?? ''
  const parts = raw.split('/').filter(Boolean)
  if (parts.length > 1) return 'general'
  const seg = parts[0] ?? ''
  if (
    seg === '' ||
    seg === 'general' ||
    seg === 'dates' ||
    seg === 'branding' ||
    seg === 'basic'
  ) {
    return 'general'
  }
  if (seg === 'grading') return 'grading'
  if (seg === 'outcomes') return 'outcomes'
  if (seg === 'features' || seg === 'features-tools') return 'features'
  if (seg === 'import-export' || seg === 'export-import') return 'import-export'
  if (seg === 'archive' || seg === 'archived') return 'archive'
  return 'general'
}
