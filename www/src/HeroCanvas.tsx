import { useEffect, useRef } from 'react'

interface Dot {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

const ACCENT_RGB = '13, 148, 136' /* teal-600 */
const NODE_RGB = '120, 113, 108' /* stone-500 */

export function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const surface = ref.current
    if (!surface) return
    const graphics = surface.getContext('2d')
    if (!graphics) return

    const canvas: HTMLCanvasElement = surface
    const ctx: CanvasRenderingContext2D = graphics

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const COUNT = reduceMotion ? 42 : 64
    const LINK_DIST = 132
    let raf = 0
    const dots: Dot[] = []

    function resize() {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }

    function init() {
      const w = canvas.width
      const h = canvas.height
      dots.length = 0
      for (let i = 0; i < COUNT; i++) {
        dots.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: reduceMotion ? 0 : (Math.random() - 0.5) * 0.35,
          vy: reduceMotion ? 0 : (Math.random() - 0.5) * 0.35,
          r: Math.random() * 1.2 + 0.45,
        })
      }
    }

    function drawFrame() {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      for (const d of dots) {
        d.x += d.vx
        d.y += d.vy
        if (d.x < 0 || d.x > w) d.vx *= -1
        if (d.y < 0 || d.y > h) d.vy *= -1
      }

      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x
          const dy = dots[i].y - dots[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < LINK_DIST) {
            const alpha = (1 - dist / LINK_DIST) * 0.065
            ctx.beginPath()
            ctx.strokeStyle = `rgba(${ACCENT_RGB},${alpha})`
            ctx.lineWidth = 0.65
            ctx.moveTo(dots[i].x, dots[i].y)
            ctx.lineTo(dots[j].x, dots[j].y)
            ctx.stroke()
          }
        }
      }

      for (const d of dots) {
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${NODE_RGB},0.22)`
        ctx.fill()
      }
    }

    function tick() {
      drawFrame()
      if (!reduceMotion) {
        raf = requestAnimationFrame(tick)
      }
    }

    resize()
    init()
    tick()

    const ro = new ResizeObserver(() => {
      resize()
      init()
      if (reduceMotion) {
        drawFrame()
      }
    })
    ro.observe(canvas)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}
