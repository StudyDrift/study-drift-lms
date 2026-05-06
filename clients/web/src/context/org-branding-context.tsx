/* eslint-disable react-refresh/only-export-components -- provider + hook live together */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { apiUrl } from '../lib/api'
import { resolveOrgBrandAssetUrl } from '../lib/branding-url'

export type OrgBrandingState = {
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string
  secondaryColor: string
  contrastWarningPrimary: boolean
  loaded: boolean
}

const defaultState: OrgBrandingState = {
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#4F46E5',
  secondaryColor: '#7C3AED',
  contrastWarningPrimary: false,
  loaded: false,
}

const OrgBrandingContext = createContext<OrgBrandingState>(defaultState)

function applyCssVars(primary: string, secondary: string) {
  const root = document.documentElement
  root.style.setProperty('--lex-brand-primary', primary)
  root.style.setProperty('--lex-brand-secondary', secondary)
  root.style.setProperty('--color-primary', primary)
}

function applyFavicon(href: string | null) {
  if (!href) return
  const url = resolveOrgBrandAssetUrl(href)
  if (!url) return
  const id = 'lextures-org-favicon'
  let link = document.querySelector<HTMLLinkElement>(`link#${id}`)
  if (!link) {
    link = document.createElement('link')
    link.id = id
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = url
}

export function OrgBrandingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrgBrandingState>(defaultState)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const host = window.location.host
        const res = await fetch(apiUrl('/api/v1/public/branding/resolve'), {
          headers: host ? { 'X-Branding-Host': host } : undefined,
        })
        const raw: unknown = await res.json().catch(() => ({}))
        const o = raw as {
          logoUrl?: string | null
          faviconUrl?: string | null
          primaryColor?: string
          secondaryColor?: string
          contrastWarningPrimary?: boolean
        }
        const primary =
          (o.primaryColor ?? defaultState.primaryColor).trim() || defaultState.primaryColor
        const secondary =
          (o.secondaryColor ?? defaultState.secondaryColor).trim() || defaultState.secondaryColor
        applyCssVars(primary, secondary)
        applyFavicon(o.faviconUrl ?? null)
        if (!cancelled) {
          setState({
            logoUrl: o.logoUrl ?? null,
            faviconUrl: o.faviconUrl ?? null,
            primaryColor: primary,
            secondaryColor: secondary,
            contrastWarningPrimary: o.contrastWarningPrimary === true,
            loaded: true,
          })
        }
      } catch {
        applyCssVars(defaultState.primaryColor, defaultState.secondaryColor)
        if (!cancelled) {
          setState((s) => ({ ...s, loaded: true }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(() => state, [state])

  return <OrgBrandingContext.Provider value={value}>{children}</OrgBrandingContext.Provider>
}

export function useOrgBranding(): OrgBrandingState {
  return useContext(OrgBrandingContext)
}
