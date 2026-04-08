type BrandLogoProps = {
  className?: string
}

/** Logo mark from `public/logo-trimmed.svg`. */
export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <img
      src="/logo-trimmed.svg"
      alt="Lextures"
      className={
        className ??
        'mx-auto h-20 w-auto max-w-[min(100%,280px)] object-contain drop-shadow-sm'
      }
    />
  )
}
