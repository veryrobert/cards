import { useEffect, useRef, useState } from 'react'
import { Download, Grid2x2, RotateCcw, RotateCw } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ToolButton } from '@/components/shell/ToolButton'
import { Segmented } from '@/components/shell/Segmented'
import { drawArt, defaultPlacement, type Placement } from '@/engine/art'
import type { Guides } from '@/engine/studio'

const PAD = 0.12 // margin around the card in the preview, as a fraction of its width, to show what's cropped
const MAX_W = 520, MAX_H = 340

type Props = {
  face: 'front' | 'back'
  img: HTMLImageElement
  name: string
  guides: Guides
  placement: Placement
  onChange: (p: Placement) => void
  onDone: () => void
  onCancel: () => void
}

// An SVG at the card's texture size with the same guides, for designing artwork elsewhere.
export function templateSvg(g: Guides, face: string) {
  const [pw, ph] = g.px, f = (n: number) => +n.toFixed(3)
  const label = (z: Guides['zones'][number]) =>
    `<rect x="${f(z.x)}" y="${f(z.y)}" width="${f(z.w)}" height="${f(z.h)}" fill="rgba(255,64,64,.12)" stroke="#ff4040" stroke-width="0.02" stroke-dasharray="0.08 0.06"/>` +
    `<text x="${f(z.x + 0.06)}" y="${f(z.y + 0.2)}" font-family="Helvetica, Arial, sans-serif" font-size="0.16" fill="#ff4040">${z.label}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="0 0 ${f(g.w)} ${f(g.h)}">
  <!-- Card ${face}, ${pw} × ${ph} px (${(g.w * 10).toFixed(2)} × ${(g.h * 10).toFixed(2)} mm). Fill to the edge; keep important things inside the safe area and clear of the red zones. -->
  <rect x="0" y="0" width="${f(g.w)}" height="${f(g.h)}" rx="${f(g.r)}" fill="none" stroke="#111" stroke-width="0.02"/>
  <rect x="${g.safe}" y="${g.safe}" width="${f(g.w - 2 * g.safe)}" height="${f(g.h - 2 * g.safe)}" rx="${f(Math.max(0, g.r - g.safe))}" fill="none" stroke="#2f80ff" stroke-width="0.02" stroke-dasharray="0.1 0.08"/>
  ${g.zones.map(label).join('\n  ')}
</svg>`
}

export function ArtworkDialog({ face, img, name, guides: g, placement: p, onChange, onDone, onCancel }: Props) {
  // A state ref, not useRef: the dialog mounts its content in a portal after the first render
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [showGuides, setShowGuides] = useState(true)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  // Preview size in CSS pixels: the card face plus a margin on every side
  const aspect = g.w / g.h
  const outerAspect = (1 + 2 * PAD) / (1 / aspect + 2 * PAD)
  // Fits the dialog on phones too: the screen width less the dialog's padding
  const ow = Math.min(MAX_W, window.innerWidth - 64, MAX_H * outerAspect), oh = ow / outerAspect
  const scale = ow / (g.w * (1 + 2 * PAD)) // px per cm
  const pad = g.w * PAD * scale, cw = g.w * scale, ch = g.h * scale

  useEffect(() => {
    const c = canvas
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(ow * dpr)
    c.height = Math.round(oh * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, ow, oh)
    ctx.translate(pad, pad)
    drawArt(ctx, img, p, cw, ch)
  }, [canvas, img, p, ow, oh, pad, cw, ch])

  const set = (patch: Partial<Placement>) => onChange({ ...p, ...patch })
  const swap = p.rotate === 90 || p.rotate === 270
  const [iw, ih] = swap ? [img.height, img.width] : [img.width, img.height]
  const [tw, th] = g.px
  const soft = iw < tw * 0.8 || ih < th * 0.8

  const download = () => {
    const blob = new Blob([templateSvg(g, face)], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `card-${face}-template-${tw}x${th}.svg`
    a.click()
  }

  const vb = `${-g.w * PAD} ${-g.w * PAD} ${g.w * (1 + 2 * PAD)} ${g.h + 2 * g.w * PAD}`
  const outer = `M${-g.w} ${-g.w}H${2 * g.w}V${g.h + g.w}H${-g.w}Z`

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent className="panel gap-4 sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>{face === 'front' ? 'Front artwork' : 'Back artwork'}</DialogTitle>
          <DialogDescription className="truncate text-xs">{name}</DialogDescription>
        </DialogHeader>

        <div
          className="relative mx-auto touch-none cursor-grab select-none active:cursor-grabbing"
          style={{ width: ow, height: oh }}
          onPointerDown={e => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY, px: p.x, py: p.y }
          }}
          onPointerMove={e => {
            const d = drag.current
            if (d) set({ x: d.px + (e.clientX - d.x) / cw, y: d.py + (e.clientY - d.y) / ch })
          }}
          onPointerUp={() => { drag.current = null }}
          onWheel={e => set({ scale: Math.min(4, Math.max(0.25, p.scale * Math.exp(-e.deltaY * 0.0015))) })}
        >
          <canvas ref={setCanvas} className="absolute inset-0 size-full" aria-hidden />
          <svg viewBox={vb} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
            {/* Outside the card: dimmed, so you can see what gets cropped */}
            <path
              fillRule="evenodd"
              fill="rgb(0 0 0 / 0.72)"
              d={`${outer}M${g.r} 0H${g.w - g.r}A${g.r} ${g.r} 0 0 1 ${g.w} ${g.r}V${g.h - g.r}A${g.r} ${g.r} 0 0 1 ${g.w - g.r} ${g.h}H${g.r}A${g.r} ${g.r} 0 0 1 0 ${g.h - g.r}V${g.r}A${g.r} ${g.r} 0 0 1 ${g.r} 0Z`}
            />
            <rect x={0} y={0} width={g.w} height={g.h} rx={g.r} fill="none" stroke="var(--foreground)" strokeWidth={0.02} />
            {showGuides && (
              <>
                <rect x={g.safe} y={g.safe} width={g.w - 2 * g.safe} height={g.h - 2 * g.safe} rx={Math.max(0, g.r - g.safe)} fill="none" stroke="var(--foreground)" strokeOpacity={0.6} strokeWidth={0.015} strokeDasharray="0.1 0.08" />
                {g.zones.map(z => (
                  <g key={z.label}>
                    <rect x={z.x} y={z.y} width={z.w} height={z.h} fill="rgb(0 0 0 / 0.35)" stroke="var(--foreground)" strokeOpacity={0.7} strokeWidth={0.015} strokeDasharray="0.06 0.05" />
                    <text x={z.x + 0.06} y={z.y + 0.19} fontSize={0.15} fill="var(--foreground)" fontFamily="-apple-system, Helvetica, Arial, sans-serif">{z.label}</text>
                  </g>
                ))}
              </>
            )}
          </svg>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-32 shrink-0">
            <Segmented label="Fit" value={p.fit} onChange={v => set({ fit: v, scale: 1, x: 0, y: 0 })} options={[{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }]} />
          </div>
          <Slider aria-label="Scale" min={0.25} max={4} step={0.01} value={[p.scale]} onValueChange={([v]) => set({ scale: v })} className="flex-1" />
          <ToolButton icon={RotateCw} label="Rotate" side="top" className="size-8" onClick={() => set({ rotate: ((p.rotate + 90) % 360) as Placement['rotate'] })} />
          <ToolButton icon={Grid2x2} label="Guides" side="top" className="size-8" active={showGuides} onClick={() => setShowGuides(!showGuides)} />
          <ToolButton icon={RotateCcw} label="Reset" side="top" className="size-8" onClick={() => onChange({ ...defaultPlacement, rotate: p.rotate })} />
        </div>

        <p className="text-xs text-muted-foreground">
          Best at {tw} × {th} px. This image is {iw} × {ih}
          {soft ? <span className="text-warning">, so it may look soft.</span> : '.'} Keep important parts inside the dashed line and clear of the marked areas.
        </p>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={download}>
            <Download strokeWidth={1.5} />
            Template
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button onClick={onDone}>Use artwork</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
