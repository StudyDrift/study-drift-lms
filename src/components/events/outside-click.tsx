import { useEffect, useRef, useState } from "react"

/**
 * Hook that alerts clicks outside of the passed ref
 */
function useOutsideAlerter(ref: any) {
  const [wasClicked, setWasClicked] = useState(false)

  useEffect(() => {
    /**
     * Alert if clicked on outside of element
     */
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target)) {
        setWasClicked(true)
      }
    }
    // Bind the event listener
    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      // Unbind the event listener on clean up
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [ref])

  return wasClicked
}

/**
 * Component that alerts if you click outside of it
 */
export default function OutsideClickClose({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  const wrapperRef = useRef(null)
  const wasClicked = useOutsideAlerter(wrapperRef)

  useEffect(() => {
    if (wasClicked) {
      onClose()
    }
  }, [wasClicked, onClose])

  return <div ref={wrapperRef}>{children}</div>
}
