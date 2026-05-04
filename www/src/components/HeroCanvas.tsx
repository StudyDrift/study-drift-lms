import { motion } from 'framer-motion'

export function HeroCanvas() {
  const nodes = [
    { x: '12%', y: '22%', r: 6 },
    { x: '28%', y: '58%', r: 5 },
    { x: '44%', y: '18%', r: 7 },
    { x: '62%', y: '42%', r: 5 },
    { x: '78%', y: '28%', r: 6 },
    { x: '88%', y: '62%', r: 4 },
    { x: '52%', y: '72%', r: 5 },
    { x: '22%', y: '78%', r: 4 },
  ]

  const edges = [
    [0, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [1, 6],
    [6, 3],
    [7, 1],
    [0, 7],
  ] as const

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="bg-noise absolute inset-0 opacity-90" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_85%_55%_at_50%_-5%,rgba(34,211,238,0.14),transparent),radial-gradient(ellipse_55%_45%_at_100%_35%,rgba(139,92,246,0.08),transparent),radial-gradient(ellipse_50%_40%_at_0%_85%,rgba(34,211,238,0.06),transparent)]" />
      <svg className="absolute inset-0 h-full w-full opacity-[0.32]" preserveAspectRatio="none">
        {edges.map(([a, b], i) => {
          const na = nodes[a]
          const nb = nodes[b]
          return (
            <motion.line
              key={i}
              x1={`${na.x}`}
              y1={`${na.y}`}
              x2={`${nb.x}`}
              y2={`${nb.y}`}
              stroke="url(#swarmGrad)"
              strokeWidth="1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.85 }}
              transition={{ duration: 0.85, delay: 0.1 * i, ease: 'easeOut' }}
            />
          )
        })}
        <defs>
          <linearGradient id="swarmGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.35" />
          </linearGradient>
        </defs>
      </svg>
      {nodes.map((n, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-cyan-400/75 shadow-[0_0_20px_rgba(34,211,238,0.35)] ring-1 ring-cyan-200/25"
          style={{
            left: n.x,
            top: n.y,
            width: n.r * 2,
            height: n.r * 2,
            marginLeft: -n.r,
            marginTop: -n.r,
          }}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.55, delay: 0.04 * i, type: 'spring', stiffness: 140 }}
        />
      ))}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,#0a0a0a_90%)]" />
    </div>
  )
}
