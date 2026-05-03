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
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(34,211,238,0.22),transparent),radial-gradient(ellipse_60%_50%_at_100%_40%,rgba(56,189,248,0.12),transparent),radial-gradient(ellipse_50%_40%_at_0%_80%,rgba(99,102,241,0.08),transparent)]" />
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.35] light:opacity-20"
        preserveAspectRatio="none"
      >
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
              stroke="url(#lxGrad)"
              strokeWidth="1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.9 }}
              transition={{ duration: 0.85, delay: 0.12 * i, ease: 'easeOut' }}
            />
          )
        })}
        <defs>
          <linearGradient id="lxGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.35" />
          </linearGradient>
        </defs>
      </svg>
      {nodes.map((n, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-cyan-400/80 shadow-[0_0_24px_rgba(34,211,238,0.45)] ring-1 ring-cyan-200/30 light:bg-cyan-500 light:shadow-[0_0_18px_rgba(6,182,212,0.35)]"
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
          transition={{ duration: 0.6, delay: 0.05 * i, type: 'spring', stiffness: 120 }}
        />
      ))}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,#020617_88%)] light:bg-[linear-gradient(to_bottom,transparent_0%,#f8fafc_90%)]" />
    </div>
  )
}
