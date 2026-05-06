import { useOrgBranding } from '../context/org-branding-context'
import { resolveOrgBrandAssetUrl } from '../lib/branding-url'

type BrandLogoProps = {
  className?: string
}

/** Logo mark from org branding or `public/logo-trimmed.svg`. */
export function BrandLogo({ className }: BrandLogoProps) {
  const { logoUrl } = useOrgBranding()
  const resolved = resolveOrgBrandAssetUrl(logoUrl)
  const src = resolved ?? '/logo-trimmed.svg'

  return (
    <img
      src={src}
      alt="Lextures"
      className={
        className ??
        'mx-auto h-20 w-auto max-w-[min(100%,280px)] object-contain drop-shadow-sm'
      }
    />
  )
}
