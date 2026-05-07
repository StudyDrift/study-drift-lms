import { useEffect, useRef } from 'react'

interface Electron {
  angle: number
  speed: number
  radius: number
}

interface NucleusParticle {
  lx: number
  ly: number
  isProton: boolean
}

interface Atom {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  type: number
  valence: number
  electrons: Electron[]
  nucleus: NucleusParticle[]
  bonds: number[] // indices of bonded atoms
}

const ACCENT_RGB = '13, 148, 136' /* teal-600 */
const NEUTRON_RGB = '94, 234, 212' /* teal-300 */

export function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: -1000, y: -1000 })

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

    const ATOM_COUNT = reduceMotion ? 15 : 40
    const BOND_DIST = 80
    const BREAK_DIST = 120
    const REPEL_DIST = 200
    const REPEL_FORCE = 0.5
    const FRICTION = 0.98
    const SPRING_K = 0.005

    let raf = 0
    const atoms: Atom[] = []

    function resize() {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }

    function init() {
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight
      atoms.length = 0
      for (let i = 0; i < ATOM_COUNT; i++) {
        const type = Math.floor(Math.random() * 3) // 0, 1, 2
        const valence = type === 0 ? 1 : type === 1 ? 2 : 4
        const eCount = type === 0 ? 1 : type === 1 ? 2 : 4
        
        const electrons: Electron[] = []
        for (let j = 0; j < eCount; j++) {
          electrons.push({
            angle: Math.random() * Math.PI * 2,
            speed: (Math.random() * 0.02 + 0.01) * (Math.random() > 0.5 ? 1 : -1),
            radius: 18 + type * 10 + Math.random() * 5
          })
        }

        const nucleus: NucleusParticle[] = []
        const pCount = type === 0 ? 2 : type === 1 ? 4 : 7
        const nCount = type === 0 ? 2 : type === 1 ? 5 : 9
        for (let j = 0; j < pCount + nCount; j++) {
          const dist = Math.random() * (2 + type * 2.5)
          const angle = Math.random() * Math.PI * 2
          nucleus.push({
            lx: Math.cos(angle) * dist,
            ly: Math.sin(angle) * dist,
            isProton: j < pCount
          })
        }

        atoms.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          r: 3 + type * 2.5,
          type,
          valence,
          electrons,
          nucleus,
          bonds: []
        })
      }
    }

    function drawFrame() {
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight
      ctx.clearRect(0, 0, w, h)

      // 1. Update Physics & Bonds
      for (let i = 0; i < atoms.length; i++) {
        const a = atoms[i]

        // Mouse repulsion
        const dxM = a.x - mouse.current.x
        const dyM = a.y - mouse.current.y
        const distM = Math.sqrt(dxM * dxM + dyM * dyM)
        if (distM < REPEL_DIST) {
          const force = (REPEL_DIST - distM) / REPEL_DIST
          a.vx += (dxM / distM) * force * REPEL_FORCE
          a.vy += (dyM / distM) * force * REPEL_FORCE
        }

        // Random drift
        a.vx += (Math.random() - 0.5) * 0.02
        a.vy += (Math.random() - 0.5) * 0.02

        // Check for new bonds
        for (let j = i + 1; j < atoms.length; j++) {
          const b = atoms[j]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < BOND_DIST && a.bonds.length < a.valence && b.bonds.length < b.valence) {
            if (!a.bonds.includes(j)) {
              a.bonds.push(j)
              b.bonds.push(i)
            }
          }
        }

        // Apply Spring Forces & Break Bonds
        a.bonds = a.bonds.filter(bondedIdx => {
          const b = atoms[bondedIdx]
          if (!b) return false
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist > BREAK_DIST) {
            // Remove from other atom too
            b.bonds = b.bonds.filter(idx => idx !== i)
            return false
          }

          // Spring force
          const force = (dist - BOND_DIST * 0.6) * SPRING_K
          const ax = (dx / dist) * force
          const ay = (dy / dist) * force
          a.vx += ax
          a.vy += ay
          b.vx -= ax
          b.vy -= ay
          return true
        })

        // Friction & Move
        a.vx *= FRICTION
        a.vy *= FRICTION
        a.x += a.vx
        a.y += a.vy

        // Bounds
        if (a.x < -40) a.x = w + 40
        if (a.x > w + 40) a.x = -40
        if (a.y < -40) a.y = h + 40
        if (a.y > h + 40) a.y = -40
      }

      // 2. Render
      // Draw Bonds first
      ctx.lineWidth = 2
      ctx.strokeStyle = `rgba(${ACCENT_RGB}, 0.12)`
      for (const a of atoms) {
        for (const bondedIdx of a.bonds) {
          const b = atoms[bondedIdx]
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      // Draw Atoms & Electrons
      for (const a of atoms) {
        // Nucleus Cluster
        for (const p of a.nucleus) {
          ctx.beginPath()
          ctx.arc(a.x + p.lx, a.y + p.ly, 2.8, 0, Math.PI * 2)
          ctx.fillStyle = p.isProton 
            ? `rgba(${ACCENT_RGB}, 0.9)` 
            : `rgba(${NEUTRON_RGB}, 0.8)`
          ctx.fill()
        }

        // Electrons
        for (const e of a.electrons) {
          e.angle += e.speed
          
          let ex = a.x + Math.cos(e.angle) * e.radius
          let ey = a.y + Math.sin(e.angle) * e.radius

          // Mouse attraction for electrons
          const dxE = ex - mouse.current.x
          const dyE = ey - mouse.current.y
          const distE = Math.sqrt(dxE * dxE + dyE * dyE)
          if (distE < 120) {
            const pull = (120 - distE) * 0.2
            ex -= (dxE / distE) * pull
            ey -= (dyE / distE) * pull
          }

          ctx.beginPath()
          ctx.arc(ex, ey, 2.2, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${ACCENT_RGB}, 0.6)`
          ctx.fill()
        }
      }
    }

    function tick() {
      drawFrame()
      raf = requestAnimationFrame(tick)
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }

    const handleMouseLeave = () => {
      mouse.current = { x: -1000, y: -1000 }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseleave', handleMouseLeave)

    resize()
    init()
    if (!reduceMotion) {
      tick()
    } else {
      drawFrame()
    }

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
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [])

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}
