/** True when a global shortcut (e.g. `?` for help) should not fire — user is typing elsewhere. */
export function isTypingContextTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.closest('[data-no-command-palette]')) return true
  return false
}
