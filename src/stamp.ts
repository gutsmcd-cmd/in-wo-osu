// Making stamp images: a typed round seal, a hand-drawn signature, or a
// photo of a real stamp with the paper removed. All return transparent canvases.

export const SEAL_RED = '#d0312d'
const SEAL_FONT =
  '"Noto Serif JP", "Noto Serif CJK JP", "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "BIZ UDPMincho", serif'
export const INKS = ['#1a1a1a', '#1f3fa6'] as const

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

function seeded(text: string): () => number {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

/** Draw one glyph so its ink fills the box (cx, cy, w, h), with limited stretching. */
function glyph(ctx: CanvasRenderingContext2D, ch: string, cx: number, cy: number, w: number, h: number): void {
  const F = 200
  ctx.font = `700 ${F}px ${SEAL_FONT}`
  const m = ctx.measureText(ch)
  const bw = Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight)
  const bh = Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)
  const base = Math.min(w / bw, h / bh)
  const sx = Math.min(w / bw, base * 1.35)
  const sy = Math.min(h / bh, base * 1.35)
  const midX = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2
  const midY = (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(sx, sy)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(ch, -midX, -midY)
  ctx.restore()
}

/** A round red 認印-style seal. Vertical text for 2–3 characters, 2×2 for 4. */
export function renderSeal(text: string, rough: boolean, size = 480): HTMLCanvasElement {
  const c = canvas(size, size)
  const ctx = c.getContext('2d')!
  const chars = Array.from(text.trim()).slice(0, 4)
  const cx = size / 2
  const R = size / 2 - size * 0.02
  const lw = R * 0.085
  ctx.fillStyle = SEAL_RED
  ctx.strokeStyle = SEAL_RED
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.arc(cx, cx, R - lw / 2, 0, Math.PI * 2)
  ctx.stroke()
  const ri = R - lw * 1.9 // usable inner radius
  const n = chars.length
  if (n === 0) return c
  if (/^[\x20-\x7e]+$/.test(chars.join(''))) {
    // Latin initials read better on one line.
    const s = chars.join('')
    ctx.font = `700 ${ri}px ${SEAL_FONT}`
    const w = ctx.measureText(s).width
    const fs = Math.min(ri * 0.95, (ri * 1.55 * ri) / Math.max(1, w))
    glyphRun(ctx, s, cx, fs)
  } else if (n === 1) {
    glyph(ctx, chars[0], cx, cx, ri * 1.2, ri * 1.2)
  } else if (n === 4) {
    // Read top-to-bottom, right column first.
    const d = ri * 0.47
    const cell = ri * 0.74
    glyph(ctx, chars[0], cx + d, cx - d, cell, cell)
    glyph(ctx, chars[1], cx + d, cx + d, cell, cell)
    glyph(ctx, chars[2], cx - d, cx - d, cell, cell)
    glyph(ctx, chars[3], cx - d, cx + d, cell, cell)
  } else {
    const H = ri * 1.66
    const slot = H / n
    const w = n === 2 ? ri * 1.08 : ri * 0.92
    const gap = slot * 0.08
    for (let i = 0; i < n; i++) {
      const y = cx - H / 2 + slot * (i + 0.5)
      glyph(ctx, chars[i], cx, y, w, slot - gap)
    }
  }
  if (rough) roughen(c, chars.join(''))
  return c
}

function glyphRun(ctx: CanvasRenderingContext2D, s: string, cx: number, fs: number): void {
  ctx.font = `700 ${fs}px ${SEAL_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(s, cx, cx)
}

/** Slightly uneven ink: soft alpha variation plus a few tiny gaps. Stable per name. */
function roughen(c: HTMLCanvasElement, seed: string): void {
  const rnd = seeded(seed)
  const ctx = c.getContext('2d')!
  const { width: W, height: H } = c
  const G = 18
  const grid = Array.from({ length: (G + 1) * (G + 1) }, () => rnd())
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    const gy = (y / H) * G
    const y0 = Math.floor(gy)
    const fy = gy - y0
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4 + 3
      if (!d[i]) continue
      const gx = (x / W) * G
      const x0 = Math.floor(gx)
      const fx = gx - x0
      const a = grid[y0 * (G + 1) + x0]
      const b = grid[y0 * (G + 1) + x0 + 1]
      const e = grid[(y0 + 1) * (G + 1) + x0]
      const f = grid[(y0 + 1) * (G + 1) + x0 + 1]
      const v = a + (b - a) * fx + (e - a) * fy + (a - b - e + f) * fx * fy
      d[i] = d[i] * (0.8 + 0.2 * v)
    }
  }
  ctx.putImageData(img, 0, 0)
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  for (let k = 0; k < 70; k++) {
    const r = W * (0.002 + rnd() * 0.006)
    ctx.globalAlpha = 0.35 + rnd() * 0.5
    ctx.beginPath()
    ctx.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Crop to the visible pixels plus a little padding. Returns null if empty. */
export function cropToInk(src: HTMLCanvasElement, maxSide = 1000, threshold = 8): HTMLCanvasElement | null {
  const { width: W, height: H } = src
  const d = src.getContext('2d')!.getImageData(0, 0, W, H).data
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04) + 2
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(W - 1, x1 + pad)
  y1 = Math.min(H - 1, y1 + pad)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const k = Math.min(1, maxSide / Math.max(w, h))
  const out = canvas(w * k, h * k)
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, x0, y0, w, h, 0, 0, out.width, out.height)
  return out
}

/** Keep red ink, make paper transparent. strength 0..100. */
export function cleanStampPhoto(src: CanvasImageSource & { width: number; height: number }, strength: number): HTMLCanvasElement {
  const k = Math.min(1, 900 / Math.max(src.width, src.height))
  const c = canvas(src.width * k, src.height * k)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, c.width, c.height)
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  const th = 12 + strength * 0.9 // redness needed before a pixel counts as ink
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const red = r - Math.max(g, b)
    let a = (red - th) / 36
    a = a < 0 ? 0 : a > 1 ? 1 : a
    d[i + 3] = Math.round(a * 255)
    if (a > 0) {
      // deepen the ink a little so faint impressions still read as red
      d[i] = Math.min(255, r * 0.9 + 30)
      d[i + 1] = g * 0.6
      d[i + 2] = b * 0.6
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export async function fileToBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

export function toPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'),
  )
}

/** Finger / mouse signature pad on a canvas. */
export class SignPad {
  readonly el: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private last: { x: number; y: number } | null = null
  private mid: { x: number; y: number } | null = null
  private active = -1
  private dpr = 1
  ink: string = INKS[0]
  strokes = 0

  constructor() {
    this.el = document.createElement('canvas')
    this.el.className = 'pad'
    this.ctx = this.el.getContext('2d')!
    this.el.addEventListener('pointerdown', (e) => this.down(e))
    this.el.addEventListener('pointermove', (e) => this.move(e))
    const up = (e: PointerEvent): void => this.up(e)
    this.el.addEventListener('pointerup', up)
    this.el.addEventListener('pointercancel', up)
  }

  /** Call when shown; sizes the bitmap to the element. Clears the pad. */
  fit(): void {
    const r = this.el.getBoundingClientRect()
    this.dpr = Math.min(window.devicePixelRatio || 1, 3)
    this.el.width = Math.max(1, Math.round(r.width * this.dpr))
    this.el.height = Math.max(1, Math.round(r.height * this.dpr))
    this.clear()
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.el.width, this.el.height)
    this.strokes = 0
  }

  private pt(e: PointerEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect()
    return { x: (e.clientX - r.left) * this.dpr, y: (e.clientY - r.top) * this.dpr }
  }

  private setup(): void {
    const c = this.ctx
    c.strokeStyle = this.ink
    c.fillStyle = this.ink
    c.lineWidth = 3.2 * this.dpr
    c.lineCap = 'round'
    c.lineJoin = 'round'
  }

  private down(e: PointerEvent): void {
    if (this.active !== -1) return
    e.preventDefault()
    this.active = e.pointerId
    this.el.setPointerCapture(e.pointerId)
    const p = this.pt(e)
    this.last = p
    this.mid = p
    this.setup()
    this.ctx.beginPath()
    this.ctx.arc(p.x, p.y, this.ctx.lineWidth / 2, 0, Math.PI * 2)
    this.ctx.fill()
    this.strokes++
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.active || !this.last || !this.mid) return
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e]
    this.setup()
    for (const ev of events.length ? events : [e]) {
      const p = this.pt(ev)
      const m = { x: (this.last.x + p.x) / 2, y: (this.last.y + p.y) / 2 }
      this.ctx.beginPath()
      this.ctx.moveTo(this.mid.x, this.mid.y)
      this.ctx.quadraticCurveTo(this.last.x, this.last.y, m.x, m.y)
      this.ctx.stroke()
      this.last = p
      this.mid = m
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.active) return
    if (this.last && this.mid) {
      this.setup()
      this.ctx.beginPath()
      this.ctx.moveTo(this.mid.x, this.mid.y)
      this.ctx.lineTo(this.last.x, this.last.y)
      this.ctx.stroke()
    }
    this.active = -1
    this.last = null
    this.mid = null
  }

  /** Recolor what is already drawn (ink switch after drawing). */
  recolor(ink: string): void {
    this.ink = ink
    const c = this.ctx
    c.save()
    c.globalCompositeOperation = 'source-in'
    c.fillStyle = ink
    c.fillRect(0, 0, this.el.width, this.el.height)
    c.restore()
  }
}
