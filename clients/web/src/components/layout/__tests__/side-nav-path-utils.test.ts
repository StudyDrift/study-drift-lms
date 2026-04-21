import { describe, expect, it } from 'vitest'
import {
  courseSettingsSectionFromPathname,
  settingsViewFromPathname,
} from '../side-nav-path-utils'

describe('settingsViewFromPathname', () => {
  it('detects AI routes before generic tab match', () => {
    expect(settingsViewFromPathname('/settings/ai/models')).toBe('ai-models')
    expect(settingsViewFromPathname('/settings/ai/system-prompts')).toBe('ai-prompts')
  })

  it('maps top-level settings tabs', () => {
    expect(settingsViewFromPathname('/settings/account')).toBe('account')
    expect(settingsViewFromPathname('/settings/notifications')).toBe('notifications')
    expect(settingsViewFromPathname('/settings/roles')).toBe('roles')
  })

  it('defaults to account for unknown settings paths', () => {
    expect(settingsViewFromPathname('/settings/unknown')).toBe('account')
  })
})

describe('courseSettingsSectionFromPathname', () => {
  it('returns general when nested too deeply under settings', () => {
    expect(
      courseSettingsSectionFromPathname('/courses/C-1/settings/dates/extra'),
    ).toBe('general')
  })

  it('maps single segment paths', () => {
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings')).toBe('general')
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/general')).toBe('general')
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/dates')).toBe('general')
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/branding')).toBe('general')
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/grading')).toBe('grading')
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/outcomes')).toBe('outcomes')
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/features')).toBe('features')
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/features-tools')).toBe(
      'features',
    )
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/import-export')).toBe(
      'import-export',
    )
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/export-import')).toBe(
      'import-export',
    )
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/archive')).toBe('archive')
    expect(courseSettingsSectionFromPathname('/courses/C-1/settings/archived')).toBe('archive')
  })
})
