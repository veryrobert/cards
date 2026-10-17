// Artwork placement, shared by the renderer and the placement dialog so the preview
// matches the card exactly. The image is fitted to the card face (cover or contain), then
// scaled, moved (as a fraction of the face) and rotated in quarter turns.
export type Placement = {
  fit: 'cover' | 'contain'
  scale: number // 1 = fitted
  x: number // offset, fraction of face width
  y: number // offset, fraction of face height
  rotate: 0 | 90 | 180 | 270
}

export const defaultPlacement: Placement = { fit: 'cover', scale: 1, x: 0, y: 0, rotate: 0 }

export type Art = { img: HTMLImageElement; placement: Placement; name: string }

// Draw the image into a w×h box (pixels), as placed.
export function drawArt(g: CanvasRenderingContext2D, img: HTMLImageElement, p: Placement, w: number, h: number) {
  const swap = p.rotate === 90 || p.rotate === 270
  const iw = swap ? img.height : img.width, ih = swap ? img.width : img.height
  const k = (p.fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)) * p.scale
  g.save()
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.translate(w / 2 + p.x * w, h / 2 + p.y * h)
  g.rotate((p.rotate * Math.PI) / 180)
  g.drawImage(img, (-img.width * k) / 2, (-img.height * k) / 2, img.width * k, img.height * k)
  g.restore()
}
