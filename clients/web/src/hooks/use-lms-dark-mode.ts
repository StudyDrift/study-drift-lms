import { useEffect, useState } from 'react'

/** True when the LMS UI uses the `dark` class on the document root (user appearance setting). */
export function useLmsDarkMode(): boolean {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const el = document.documentElement
    const sync = () => setDark(el.classList.contains('dark'))
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  return dark
}
