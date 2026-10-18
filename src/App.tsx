import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, CreditCard, Download, FlipHorizontal2, Image, Palette,
  RotateCcw, Rotate3d, Sun, Wind,
} from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ToolButton } from '@/components/shell/ToolButton'
import { Toolbar, ToolbarSeparator } from '@/components/shell/Toolbar'
import { OnOff, Segmented } from '@/components/shell/Segmented'
import { Field, FieldGroup } from '@/components/shell/Field'
import { Swatches } from '@/components/shell/Swatches'
import { FilePick } from '@/components/shell/FilePick'
import { LayoutGlyph } from '@/components/LayoutGlyph'
import { ArtworkDialog } from '@/components/ArtworkDialog'
import { defaultPlacement, type Art, type Placement } from '@/engine/art'
import type { Guides } from '@/engine/studio'
import { clearMark, useInstalledMark, useMarkFile } from '@/lib/cardFont'
import { createStudio, type Studio } from '@/engine/studio'
import { BG_COLOURS, CARD_COLOURS, defaults, type Options } from '@/engine/options'
import { useStored } from '@/hooks/useStored'
import { Splash } from '@/components/shell/Splash'
import { PanelRail } from '@/components/shell/PanelRail'
import { PanelSheet } from '@/components/shell/PanelSheet'
import { ActionDock } from '@/components/shell/ActionDock'
import { PANEL_W, PHONE_SHEET, usePhone } from '@/components/shell/layout'
import { thumbnail } from '@/components/shell/thumbnail'

const panels = [
  { id: 'design', label: 'Design', icon: CreditCard },
  { id: 'finish', label: 'Colour and finish', icon: Palette },
  { id: 'bg', label: 'Background', icon: Image },
  { id: 'light', label: 'Lighting', icon: Sun },
  { id: 'motion', label: 'Rotation', icon: Rotate3d },
  { id: 'export', label: 'Export', icon: Download },
] as const
type PanelId = (typeof panels)[number]['id']

const IMAGE_TYPES = 'image/png,image/svg+xml,image/webp'

function Range({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <Field label={label}>
      <Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
    </Field>
  )
}

function Row({ show = true, children }: { show?: boolean; children: ReactNode }) {
  return show ? <>{children}</> : null
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      // SVGs without an intrinsic size fall back to a usable raster size
      if (!img.width || !img.height) { img.width = 600; img.height = 300 }
      resolve(img)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

export default function App() {
  const [stored, setStored] = useStored<Partial<Options>>('cards.options', {})
  const o: Options = { ...defaults, ...stored }
  const [panel, setPanel] = useState<PanelId | null>(null)
  const phone = usePhone()
  const [flipped, setFlipped] = useState(false)
  const [files, setFiles] = useState<{ mark: string | null; issuer: string | null }>({ mark: null, issuer: null })
  const [hasMark, setHasMark] = useState(false)
  // FF Mark for the card text: from an installed copy, or a font file loaded this visit
  const [markFont, setMarkFont] = useState<{ state: 'idle' | 'ready' | 'missing'; name: string | null }>({ state: 'idle', name: null })
  // Full-face artwork, and the face being placed in the dialog (with what to go back to on Cancel)
  const [art, setArtState] = useState<{ front: Art | null; back: Art | null }>({ front: null, back: null })
  const [placing, setPlacing] = useState<{ face: 'front' | 'back'; art: Art; before: Art | null; guides: Guides } | null>(null)
  const [note, setNote] = useState('')
  const [exportKind, setExportKind] = useState<'image' | 'video'>('image')
  const [recorded, setRecorded] = useState<number | null>(null) // seconds so far while a video records
  const [failed, setFailed] = useState(false)
  const [, setReady] = useState(false)

  const canvas = useRef<HTMLCanvasElement>(null)
  const studio = useRef<Studio | null>(null)

  // Start the renderer once; it reports gesture-driven changes (roll, reset) back.
  useEffect(() => {
    if (!canvas.current) return
    try {
      studio.current = createStudio(canvas.current, o, patch => setStored(prev => ({ ...prev, ...patch })))
      setReady(true)
    } catch {
      setFailed(true)
    }
    return () => {
      studio.current?.dispose()
      studio.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (patch: Partial<Options>) => {
    // A mark can only sit level with the chip on a vertical card with a printed mark.
    const next = { ...o, ...patch }
    if (next.markPos === 'chip' && !(next.orient === 'v' && next.markStyle === 'standard')) patch = { ...patch, markPos: 'br' }
    setStored(prev => ({ ...prev, ...patch }))
    studio.current?.set(patch)
  }

  // Frame the card in the space the open panel leaves: beside it on desktop, above it on phones
  useEffect(() => {
    studio.current?.setViewInset(!panel ? {} : phone ? { bottom: window.innerHeight * PHONE_SHEET } : { right: PANEL_W })
  }, [panel, phone])

  const chooseMark = async () => {
    if (markFont.state === 'ready') return
    const ok = await useInstalledMark()
    setMarkFont({ state: ok ? 'ready' : 'missing', name: ok ? 'Installed' : null })
    if (ok) studio.current?.refreshText()
  }

  const loadMarkFile = async (file: File) => {
    try {
      await useMarkFile(file)
      setMarkFont({ state: 'ready', name: file.name })
      studio.current?.refreshText()
    } catch {
      setMarkFont({ state: 'missing', name: 'Can’t read that font' })
    }
  }

  // A remembered Mark choice needs the font again on each visit
  useEffect(() => {
    if (o.cardFont === 'mark') chooseMark()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyArt = (face: 'front' | 'back', a: Art | null) => {
    setArtState(prev => ({ ...prev, [face]: a }))
    studio.current?.setArt(face, a)
  }

  // Open the placement dialog, turning the card to show that face; the card updates live behind it
  const placeArt = (face: 'front' | 'back', a: Art) => {
    if (!studio.current) return
    studio.current.setFlipped(face === 'back')
    applyArt(face, a)
    setPlacing({ face, art: a, before: art[face], guides: studio.current.guides(face) })
  }

  const pickArt = async (face: 'front' | 'back', file: File) => {
    try {
      const img = await loadImage(file)
      // Turn the artwork a quarter if its orientation doesn't match the card face
      const g = studio.current?.guides(face)
      const turn = g && (img.width > img.height) !== (g.w > g.h)
      placeArt(face, { img, name: file.name, placement: { ...defaultPlacement, rotate: turn ? 90 : 0 } })
    } catch {
      setNote('Can’t read that image')
    }
  }

  const movePlacement = (p: Placement) => {
    if (!placing) return
    const a = { ...placing.art, placement: p }
    setPlacing({ ...placing, art: a })
    applyArt(placing.face, a)
  }

  const endPlacing = (keep: boolean) => {
    if (!placing) return
    if (!keep) applyArt(placing.face, placing.before)
    studio.current?.setFlipped(flipped)
    setPlacing(null)
  }

  const pickImage = async (slot: 'mark' | 'issuer', file: File | null) => {
    if (!file) {
      studio.current?.setImage(slot, null)
      setFiles(f => ({ ...f, [slot]: null }))
      if (slot === 'mark') setHasMark(false)
      return
    }
    try {
      studio.current?.setImage(slot, await loadImage(file))
      setFiles(f => ({ ...f, [slot]: file.name }))
      if (slot === 'mark') setHasMark(true)
    } catch {
      setFiles(f => ({ ...f, [slot]: 'Can’t read file' }))
    }
  }

  const save = (blob: Blob, name: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setNote(`Saved ${name}`)
  }

  const exportAs = async (fmt: 'png' | 'jpg') => {
    if (!studio.current) return
    setNote('Rendering')
    const blob: Blob | null = await studio.current.exportImage(fmt, o.exportSize, o.exportBg)
    if (!blob) return setNote('Couldn’t render the image')
    save(blob, `card-${o.layout}-${o.exportSize}.${fmt}`)
  }

  // The index thumbnail: 16:10, the card's scene with its own background around it (shell/thumbnail.ts)
  const exportThumb = async () => {
    if (!studio.current) return
    setNote('Rendering')
    const blob: Blob | null = await studio.current.exportImage('png', 'hd', 'include')
    if (!blob) return setNote('Couldn’t render the image')
    save(await thumbnail(blob, o.bg, 0), 'card-thumbnail.png')
  }

  const recordVideo = async () => {
    if (!studio.current || recorded !== null) return
    setNote('')
    setRecorded(0)
    const out = await studio.current.recordVideo({ seconds: Number(o.videoSeconds), motion: o.videoMotion, onProgress: setRecorded })
    setRecorded(null)
    if (!out) return setNote('Recording isn’t supported in this browser')
    save(out.blob, `card-${o.layout}-${o.videoSeconds}s.${out.ext}`)
  }

  const layouts = studio.current?.layouts ?? []
  const layoutIndex = Math.max(0, layouts.findIndex(l => l.id === o.layout))
  const layout = layouts[layoutIndex]
  const stepLayout = (dir: number) => layouts.length && set({ layout: layouts[(layoutIndex + dir + layouts.length) % layouts.length].id })
  const allowChip = o.orient === 'v' && o.markStyle === 'standard'
  const current = panels.find(p => p.id === panel)

  return (
    <TooltipProvider delayDuration={400}>
      <Splash label="Loading cards">
        <path pathLength={1} d="M6 8h20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
        <path pathLength={1} d="M8 12h4.5v3.5H8z" />
      </Splash>
      <canvas ref={canvas} aria-label="Rotating 3D payment card" className="fixed inset-0 size-full cursor-grab touch-none active:cursor-grabbing" style={{ background: o.bg }} />
      {failed && (
        <p className="fixed inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">This needs WebGL. Open it in a current Safari, Chrome or Firefox.</p>
      )}

      <PanelRail panels={panels} open={panel} onToggle={id => setPanel(panel === id ? null : id)} phone={phone} />

      <PanelSheet open={panel !== null} title={current?.label} onClose={() => setPanel(null)} phone={phone}>
            {panel === 'design' && (
              <>
                <FieldGroup title="Artwork">
                  {(['front', 'back'] as const).map(face => (
                    <Field key={face} label={face === 'front' ? 'Front' : 'Back'}>
                      <div className="flex gap-1">
                        <div className="min-w-0 flex-1">
                          <FilePick
                            label={`${face} artwork`}
                            name={art[face]?.name ?? null}
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            onPick={f => pickArt(face, f)}
                            onClear={() => applyArt(face, null)}
                          />
                        </div>
                        {art[face] && (
                          <Button variant="secondary" size="sm" className="h-8" onClick={() => placeArt(face, art[face]!)}>Adjust</Button>
                        )}
                      </div>
                    </Field>
                  ))}
                </FieldGroup>
                <FieldGroup>
                  <Field label="Layout">
                    <Segmented label="Layout" value={o.orient} onChange={v => set({ orient: v })} options={[{ value: 'v', label: 'Vertical' }, { value: 'h', label: 'Horizontal' }]} />
                  </Field>
                  <Field label="Typeface">
                    <Segmented
                      label="Typeface"
                      value={o.cardFont}
                      onChange={v => { set({ cardFont: v }); if (v === 'mark') chooseMark() }}
                      options={[{ value: 'helvetica', label: 'Helvetica' }, { value: 'geist', label: 'Geist' }, { value: 'mark', label: 'Mark' }]}
                    />
                  </Field>
                  <Row show={o.cardFont === 'mark' && markFont.state !== 'idle'}>
                    <Field label="Font file">
                      <FilePick
                        label="Mark font file"
                        name={markFont.name}
                        accept=".otf,.ttf,.woff,.woff2,font/otf,font/ttf,font/woff,font/woff2"
                        onPick={loadMarkFile}
                        onClear={() => { clearMark(); setMarkFont({ state: 'missing', name: null }); studio.current?.refreshText() }}
                      />
                      {markFont.state === 'missing' && (
                        <p className="text-xs text-muted-foreground">FF Mark isn’t installed here. Load a font file you’re licensed to use; it stays in this browser. Helvetica is used until then.</p>
                      )}
                    </Field>
                  </Row>
                  <Field label="Name">
                    <Input value={o.nameText} maxLength={26} aria-label="Cardholder name" onChange={e => set({ nameText: e.target.value })} />
                  </Field>
                  <Field label="Name on">
                    <Segmented label="Name on" value={o.name} onChange={v => set({ name: v })} options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }, { value: 'both', label: 'Both' }]} />
                  </Field>
                  <Field label="Hologram">
                    <Segmented label="Hologram" value={o.holo} onChange={v => set({ holo: v })} options={[{ value: 'none', label: 'None' }, { value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]} />
                  </Field>
                </FieldGroup>

                <FieldGroup title="Front">
                  <Field label="Chip colour">
                    <Segmented label="Chip colour" value={o.chipColor} onChange={v => set({ chipColor: v })} options={['gold', 'silver', 'rose', 'graphite', 'black'].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))} />
                  </Field>
                  <Field label="Chip pattern">
                    <Segmented label="Chip pattern" value={o.chipPattern} onChange={v => set({ chipPattern: v })} options={[{ value: 'classic', label: 'Classic' }, { value: 'grid', label: 'Six' }, { value: 'eight', label: 'Eight' }, { value: 'organic', label: 'Organic' }, { value: 'minimal', label: 'Minimal' }]} />
                  </Field>
                  <Field label="Mark">
                    <FilePick label="Mark" name={files.mark} accept={IMAGE_TYPES} onPick={f => pickImage('mark', f)} onClear={() => pickImage('mark', null)} />
                  </Field>
                  {/* Placement and finish apply to an uploaded mark, and to the identifier set beside it */}
                  <Row show={hasMark || o.ident !== 'none'}>
                  <Field label="Position">
                    <Segmented
                      label="Mark position"
                      value={o.markPos}
                      onChange={v => set({ markPos: v })}
                      options={[
                        { value: 'tl', label: 'Top left', icon: ArrowUpLeft },
                        { value: 'tr', label: 'Top right', icon: ArrowUpRight },
                        { value: 'bl', label: 'Bottom left', icon: ArrowDownLeft },
                        { value: 'br', label: 'Bottom right', icon: ArrowDownRight },
                        { value: 'chip', label: 'Chip', disabled: !allowChip },
                      ]}
                    />
                  </Field>
                  <Field label="Mark finish">
                    <Segmented label="Mark finish" value={o.markStyle} onChange={v => set({ markStyle: v })} options={[{ value: 'standard', label: 'Print' }, { value: 'silver', label: 'Silver' }, { value: 'gold', label: 'Gold' }, { value: 'rainbow', label: 'Rainbow' }, { value: 'black', label: 'Black' }]} />
                  </Field>
                  </Row>
                  <Field label="Identifier">
                    <Segmented label="Identifier" value={o.ident} onChange={v => set({ ident: v })} options={[{ value: 'none', label: 'None' }, { value: 'Debit', label: 'Debit' }, { value: 'Credit', label: 'Credit' }, { value: 'Business', label: 'Business' }, { value: 'custom', label: 'Tier' }]} />
                  </Field>
                  <Row show={o.ident === 'custom'}>
                    <Field label="Tier">
                      <Input value={o.identText} maxLength={20} aria-label="Tier name" onChange={e => set({ identText: e.target.value })} />
                    </Field>
                  </Row>
                  <Field label="Issuer logo">
                    <FilePick label="Issuer logo" name={files.issuer} accept={IMAGE_TYPES} onPick={f => pickImage('issuer', f)} onClear={() => pickImage('issuer', null)} />
                  </Field>
                  <Field label="Number">
                    <Segmented label="Front number" value={o.fAccount} onChange={v => set({ fAccount: v })} options={[{ value: 'none', label: 'None' }, { value: 'last4', label: 'Last 4' }, { value: 'full', label: 'Full' }]} />
                  </Field>
                  <Field label="Contactless">
                    <OnOff label="Contactless" value={o.contactless} onChange={v => set({ contactless: v })} />
                  </Field>
                </FieldGroup>

                <FieldGroup title="Back">
                  <Field label="Stripe">
                    <Segmented label="Stripe" value={o.stripe} onChange={v => set({ stripe: v })} options={[{ value: 'standard', label: 'Black' }, { value: 'custom', label: 'Colour' }, { value: 'none', label: 'None' }]} />
                  </Field>
                  <Row show={o.stripe === 'custom'}>
                    <Field label="Stripe colour">
                      <input type="color" aria-label="Stripe colour" value={o.stripeColor} onChange={e => set({ stripeColor: e.target.value })} className="h-8 w-full cursor-pointer rounded-[10px] bg-muted p-0.5" />
                    </Field>
                  </Row>
                  <Field label="Signature">
                    <OnOff label="Signature panel" value={o.sig} onChange={v => set({ sig: v })} />
                  </Field>
                  <Field label="Code">
                    <Segmented label="Security code" value={o.cvv} onChange={v => set({ cvv: v })} options={[{ value: 'panel', label: 'Panel' }, { value: 'box', label: 'Box' }, { value: 'printed', label: 'Printed' }, { value: 'none', label: 'App' }]} />
                  </Field>
                  <Field label="Number">
                    <Segmented label="Back number" value={o.bAccount} onChange={v => set({ bAccount: v })} options={[{ value: 'none', label: 'None' }, { value: 'full', label: 'Full' }]} />
                  </Field>
                  <Field label="Terms">
                    <OnOff label="Terms text" value={o.service} onChange={v => set({ service: v })} />
                  </Field>
                </FieldGroup>
              </>
            )}

            {panel === 'finish' && (
              <FieldGroup>
                <Field label="Colour">
                  <Swatches label="Card colour" value={o.color} onChange={v => set({ color: v })} colours={CARD_COLOURS} />
                </Field>
                <Field label="Metal">
                  <Segmented label="Metal finish" value={o.material} onChange={v => set({ material: v })} options={[{ value: 'polished', label: 'Polished' }, { value: 'brushed', label: 'Brushed' }, { value: 'blasted', label: 'Blasted' }, { value: 'holo', label: 'Holo' }]} />
                </Field>
                <Field label="Coated">
                  <Segmented label="Coated finish" value={o.material} onChange={v => set({ material: v })} options={[{ value: 'gloss', label: 'Gloss' }, { value: 'satin', label: 'Satin' }, { value: 'soft', label: 'Soft' }]} />
                </Field>
                <Field label="Sparkle">
                  <Segmented label="Sparkle" value={o.sparkle} onChange={v => set({ sparkle: v })} options={[{ value: 'off', label: 'Off' }, { value: 'fine', label: 'Fine' }, { value: 'heavy', label: 'Heavy' }]} />
                </Field>
                <Field label="Edge">
                  <Segmented label="Edge" value={o.edge} onChange={v => set({ edge: v })} options={[{ value: 'match', label: 'Match' }, { value: 'silver', label: 'Silver' }, { value: 'gold', label: 'Gold' }, { value: 'copper', label: 'Copper' }]} />
                </Field>
              </FieldGroup>
            )}

            {panel === 'light' && (
              <FieldGroup>
                <Field label="Mood">
                  <Segmented label="Mood" value={o.mood} onChange={v => set({ mood: v })} options={[{ value: 'studio', label: 'Studio' }, { value: 'soft', label: 'Soft' }, { value: 'contrast', label: 'Contrast' }]} />
                </Field>
                <Field label="Key light">
                  <Segmented label="Key light" value={o.keyDir} onChange={v => set({ keyDir: v })} options={[{ value: 'left', label: 'Left' }, { value: 'top', label: 'Top' }, { value: 'right', label: 'Right' }]} />
                </Field>
                <Range label="Brightness" value={o.bright} onChange={v => set({ bright: v })} min={0.4} max={2} step={0.05} />
                <Range label="Exposure" value={o.expo} onChange={v => set({ expo: v })} min={0.5} max={1.6} step={0.05} />
              </FieldGroup>
            )}

            {panel === 'motion' && (
              <FieldGroup>
                <Field label="Spin">
                  <OnOff label="Spin" value={o.spin} onChange={v => set({ spin: v })} />
                </Field>
                <Range label="Drift amount" value={o.amount} onChange={v => set({ amount: v })} min={0} max={2} step={0.05} />
                <Range label="Speed" value={o.speed} onChange={v => set({ speed: v })} min={0.2} max={2.5} step={0.05} />
                <Range label="Turn" value={o.turn} onChange={v => set({ turn: v })} min={-1.2} max={1.2} step={0.01} />
                <Range label="Tilt" value={o.tilt} onChange={v => set({ tilt: v })} min={-0.8} max={0.8} step={0.01} />
                <Range label="Roll" value={o.rollBase} onChange={v => set({ rollBase: v })} min={-1.2} max={1.2} step={0.01} />
                <Button variant="secondary" onClick={() => studio.current?.resetView()}>Reset</Button>
              </FieldGroup>
            )}

            {panel === 'bg' && (
              <FieldGroup>
                <Field label="Colour">
                  <Swatches label="Background colour" value={o.bg} onChange={v => set({ bg: v })} colours={BG_COLOURS} />
                </Field>
                <Field label="Floor shadow">
                  <OnOff label="Floor shadow" value={o.shadow} onChange={v => set({ shadow: v })} />
                </Field>
                <Row show={o.shadow}>
                  <Range label="Strength" value={o.shadowStrength} onChange={v => set({ shadowStrength: v })} min={0} max={0.85} step={0.01} />
                  <Range label="Blur" value={o.shadowBlur} onChange={v => set({ shadowBlur: v })} min={1} max={16} step={0.5} />
                  <Range label="Distance" value={o.shadowDist} onChange={v => set({ shadowDist: v })} min={4.5} max={14} step={0.1} />
                </Row>
              </FieldGroup>
            )}

            {panel === 'export' && (
              <FieldGroup>
                <Segmented label="Export as" value={exportKind} onChange={setExportKind} options={[{ value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }]} />
                {exportKind === 'image' ? (
                  <>
                    <Field label="Size">
                      <Segmented label="Size" value={o.exportSize} onChange={v => set({ exportSize: v })} options={[{ value: 'hd', label: 'HD 1920' }, { value: '4k', label: '4K 3840' }]} />
                    </Field>
                    <Field label="Background">
                      <Segmented label="Export background" value={o.exportBg} onChange={v => set({ exportBg: v })} options={[{ value: 'include', label: 'Include' }, { value: 'transparent', label: 'Transparent' }]} />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" onClick={() => exportAs('png')}>Save PNG</Button>
                      <Button variant="secondary" onClick={() => exportAs('jpg')}>Save JPG</Button>
                    </div>
                    <Button variant="secondary" onClick={exportThumb}>Save thumbnail</Button>
                  </>
                ) : (
                  <>
                    <Field label="Length">
                      <Segmented label="Length" value={o.videoSeconds} onChange={v => set({ videoSeconds: v })} options={[{ value: '5', label: '5s' }, { value: '10', label: '10s' }, { value: '15', label: '15s' }]} />
                    </Field>
                    <Field label="Motion">
                      <Segmented label="Motion" value={o.videoMotion} onChange={v => set({ videoMotion: v })} options={[{ value: 'spin', label: 'Spin' }, { value: 'drift', label: 'Drift' }, { value: 'both', label: 'Both' }]} />
                    </Field>
                    <Button variant="secondary" disabled={recorded !== null} onClick={recordVideo}>
                      {recorded === null ? 'Record video' : `Recording ${Math.floor(recorded)}s of ${o.videoSeconds}`}
                    </Button>
                    <p className="text-xs text-muted-foreground">1920 on the long side, MP4 where your browser can record it, otherwise WebM. Background included.</p>
                  </>
                )}
                {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
              </FieldGroup>
            )}
      </PanelSheet>

      <ActionDock phone={phone} panelOpen={panel !== null}>
        <Toolbar aria-label="Card controls">
          <ToolButton icon={Wind} label="Drift" side="top" active={o.drift} onClick={() => set({ drift: !o.drift })} />
          <ToolButton
            icon={FlipHorizontal2}
            label={flipped ? 'Show front' : 'Show back'}
            side="top"
            active={flipped}
            onClick={() => {
              setFlipped(!flipped)
              studio.current?.setFlipped(!flipped)
            }}
          />
          <ToolButton icon={RotateCcw} label="Reset view" side="top" onClick={() => studio.current?.resetView()} />
          <ToolbarSeparator />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Layout: ${layout?.name ?? 'Single'}. Next layout`}
                onClick={e => stepLayout(e.shiftKey ? -1 : 1)}
                className="grid h-10 place-items-center rounded-full px-2.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LayoutGlyph cards={layout?.cards ?? [{ x: 0, y: 0, z: 0 }]} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{layout?.name ?? 'Layout'}</TooltipContent>
          </Tooltip>
        </Toolbar>
      </ActionDock>
      {placing && (
        <ArtworkDialog
          face={placing.face}
          img={placing.art.img}
          name={placing.art.name}
          guides={placing.guides}
          placement={placing.art.placement}
          onChange={movePlacement}
          onDone={() => endPlacing(true)}
          onCancel={() => endPlacing(false)}
        />
      )}
    </TooltipProvider>
  )
}
