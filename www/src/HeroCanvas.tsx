import { useEffect, useRef } from 'react'

interface Dot {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

export function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const COUNT = 90
    const LINK_DIST = 145
    let raf = 0
    const dots: Dot[] = []

    function resize() {
      canvas!.width = canvas!.offsetWidth
      canvas!.height = canvas!.offsetHeight
    }

    function init() {
      const w = canvas!.width
      const h = canvas!.height
      dots.length = 0
      for (let i = 0; i < COUNT; i++) {
        dots.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.45,
          vy: (Math.random() - 0.5) * 0.45,
          r: Math.random() * 1.4 + 0.6,
        })
      }
    }

    function tick() {
      const w = canvas!.width
      const h = canvas!.height
      ctx!.clearRect(0, 0, w, h)

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
            const alpha = (1 - dist / LINK_DIST) * 0.16
            ctx!.beginPath()
            ctx!.strokeStyle = `rgba(99,102,241,${alpha})`
            ctx!.lineWidth = 0.75
            ctx!.moveTo(dots[i].x, dots[i].y)
            ctx!.lineTo(dots[j].x, dots[j].y)
            ctx!.stroke()
          }
        }
      }

      for (const d of dots) {
        ctx!.beginPath()
        ctx!.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx!.fillStyle = 'rgba(99,102,241,0.38)'
        ctx!.fill()
      }

      raf = requestAnimationFrame(tick)
    }

    resize()
    init()
    tick()

    const ro = new ResizeObserver(() => {
      resize()
      init()
    })
    ro.observe(canvas)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}
