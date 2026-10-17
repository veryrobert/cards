type Card = { x: number; y: number; z: number; rz?: number; back?: boolean; alt?: boolean }

// Small drawing of a layout's cards, for the layout button.
export function LayoutGlyph({ cards }: { cards: Card[] }) {
  const cw = 9, ch = 14.3
  return (
    <svg viewBox="0 0 44 34" className="h-6 w-8" aria-hidden>
      {[...cards].sort((a, b) => a.z - b.z).map((c, i) => {
        const cx = 22 + c.x * 26, cy = 17 - c.y * 26, deg = (-(c.rz ?? 0) * 180) / Math.PI
        return (
          <g key={i} transform={`rotate(${deg.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})`}>
            <rect
              x={cx - cw / 2} y={cy - ch / 2} width={cw} height={ch} rx={1.4}
              fill={c.back ? 'var(--panel)' : 'currentColor'}
              fillOpacity={c.alt ? 0.45 : 1}
              stroke="currentColor" strokeOpacity={c.back ? 0.9 : 0}
            />
            {c.back && <line x1={cx - cw / 2 + 2} y1={cy - ch / 2} x2={cx - cw / 2 + 2} y2={cy + ch / 2} stroke="currentColor" strokeWidth={1.6} />}
          </g>
        )
      })}
    </svg>
  )
}
