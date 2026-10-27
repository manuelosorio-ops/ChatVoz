/**
 * Orbe animado de Cami. Cambia de color y animación según el estado.
 * status: 'idle' | 'listening' | 'thinking' | 'speaking'
 */
const THEMES = {
  idle:      { core: 'from-indigo-500 via-violet-500 to-fuchsia-500', glow: 'shadow-violet-500/40', ring: 'bg-violet-400' },
  listening: { core: 'from-rose-500 via-pink-500 to-orange-400',      glow: 'shadow-rose-500/50',   ring: 'bg-rose-400' },
  thinking:  { core: 'from-amber-400 via-orange-400 to-yellow-300',   glow: 'shadow-amber-400/40',  ring: 'bg-amber-300' },
  speaking:  { core: 'from-emerald-400 via-teal-400 to-cyan-400',     glow: 'shadow-emerald-400/50', ring: 'bg-emerald-300' },
}

export default function CamiOrb({ status = 'idle', size = 220 }) {
  const t = THEMES[status] ?? THEMES.idle
  const active = status === 'listening' || status === 'speaking'

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }} aria-hidden="true">
      {/* Ondas expansivas */}
      {active &&
        [0, 0.7, 1.4].map((delay) => (
          <span
            key={delay}
            className={`orb-ripple absolute inset-0 rounded-full ${t.ring}`}
            style={{ animationDelay: `${delay}s` }}
          />
        ))}

      {/* Anillo giratorio al pensar */}
      {status === 'thinking' && (
        <span className="orb-spin absolute -inset-3 rounded-full border-4 border-transparent border-t-amber-300 border-r-amber-300/40" />
      )}

      {/* Núcleo */}
      <div
        className={`orb-breathe relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br ${t.core}
          shadow-[0_0_80px_-10px] ${t.glow} transition-colors duration-700`}
      >
        <div className="absolute inset-3 rounded-full bg-white/10 backdrop-blur-sm" />
        <div className="absolute left-[22%] top-[16%] h-1/4 w-1/3 rounded-full bg-white/30 blur-xl" />

        {/* Ecualizador mientras habla / escucha */}
        {active ? (
          <div className="relative flex h-1/3 items-center gap-1.5">
            {[0, 0.15, 0.3, 0.45, 0.6].map((d, i) => (
              <span
                key={i}
                className="orb-bar w-2 rounded-full bg-white/90"
                style={{ height: `${[55, 85, 100, 85, 55][i]}%`, animationDelay: `${d}s` }}
              />
            ))}
          </div>
        ) : (
          <span className="relative select-none text-4xl font-semibold tracking-wide text-white/95 drop-shadow">Cami</span>
        )}
      </div>
    </div>
  )
}
