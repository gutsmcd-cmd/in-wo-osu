// Opening documents (PDF via pdf.js, or a photo) and writing stamps back.
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFImage } from 'pdf-lib'

// The PDF libraries are big; load them only when a PDF is used (they are precached for offline).
let pdfjsP: Promise<typeof import('pdfjs-dist')> | null = null
function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  pdfjsP ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl
    return m
  })
  return pdfjsP
}

// pdf.js support files (CMaps for Japanese PDFs, fonts, wasm), bundled for offline use.
const ASSETS = new URL(import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : './pdfjs/', document.baseURI).href

export interface Placement {
  id: number
  stampId: string
  page: number // 0-based
  cx: number // center, fraction of page width
  cy: number // center, fraction of page height
  w: number // width, fraction of page width
  aspect: number // stamp width / height
}

export interface StampImage {
  png: Blob
  w: number
  h: number
}

export class LockedError extends Error {}

interface Base {
  name: string // file name without extension
  pages: number
}
export interface PdfDoc extends Base {
  kind: 'pdf'
  bytes: Uint8Array
  pdf: PDFDocumentProxy
  task: PDFDocumentLoadingTask
}
export interface ImageDoc extends Base {
  kind: 'image'
  bitmap: ImageBitmap
  png: boolean
}
export type Doc = PdfDoc | ImageDoc

function baseName(name: string): string {
  const s = name.replace(/\.[^./\\]{1,5}$/, '')
  return s || 'document'
}

export async function openFile(file: File): Promise<Doc> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    try {
      const pdfjs = await loadPdfjs()
      const task = pdfjs.getDocument({
        data: bytes.slice(), // pdf.js transfers its copy to the worker
        cMapUrl: ASSETS + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: ASSETS + 'standard_fonts/',
        wasmUrl: ASSETS + 'wasm/',
        iccUrl: ASSETS + 'iccs/',
        enableXfa: false,
      })
      const pdf = await task.promise
      return { kind: 'pdf', name: baseName(file.name), pages: pdf.numPages, bytes, pdf, task }
    } catch (err) {
      if ((err as { name?: string })?.name === 'PasswordException') throw new LockedError()
      throw err
    }
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  return { kind: 'image', name: baseName(file.name), pages: 1, bitmap, png: file.type === 'image/png' }
}

export async function closeDoc(doc: Doc | null): Promise<void> {
  if (!doc) return
  if (doc.kind === 'pdf') await doc.task.destroy().catch(() => undefined)
  else doc.bitmap.close()
}

/** Page size in PDF points (pdf) or pixels (image), as displayed (rotation applied). */
export async function pageSize(doc: Doc, page: number): Promise<{ w: number; h: number }> {
  if (doc.kind === 'image') return { w: doc.bitmap.width, h: doc.bitmap.height }
  const p = await doc.pdf.getPage(page + 1)
  const vp = p.getViewport({ scale: 1 })
  return { w: vp.width, h: vp.height }
}

let task: RenderTask | null = null

/** Draw a page into the canvas at cssW × cssH CSS pixels. */
export async function renderPage(doc: Doc, page: number, c: HTMLCanvasElement, cssW: number, cssH: number): Promise<void> {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
  const W = Math.max(1, Math.round(cssW * dpr))
  const H = Math.max(1, Math.round(cssH * dpr))
  c.style.width = `${cssW}px`
  c.style.height = `${cssH}px`
  if (doc.kind === 'image') {
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(doc.bitmap, 0, 0, W, H)
    return
  }
  if (task) {
    task.cancel()
    task = null
  }
  const p: PDFPageProxy = await doc.pdf.getPage(page + 1)
  const base = p.getViewport({ scale: 1 })
  const viewport = p.getViewport({ scale: W / base.width })
  // render offscreen first so the old page stays visible until the new one is ready
  const off = document.createElement('canvas')
  off.width = Math.round(viewport.width)
  off.height = Math.round(viewport.height)
  const ctx = off.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, off.width, off.height)
  const t = p.render({ canvas: off, canvasContext: ctx, viewport })
  task = t
  try {
    await t.promise
  } catch (err) {
    if ((err as { name?: string })?.name === 'RenderingCancelledException') return
    throw err
  } finally {
    if (task === t) task = null
  }
  c.width = off.width
  c.height = off.height
  c.getContext('2d')!.drawImage(off, 0, 0)
}

/** Write the stamps into the original PDF. Original content is kept as-is. */
export async function stampPdf(
  doc: PdfDoc,
  placements: Placement[],
  stamps: Map<string, StampImage>,
): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib')
  let out: Awaited<ReturnType<typeof PDFDocument.load>>
  try {
    out = await PDFDocument.load(doc.bytes, { updateMetadata: false })
  } catch (err) {
    if ((err as Error)?.message?.toLowerCase().includes('encrypt')) throw new LockedError()
    throw err
  }
  const embedded = new Map<string, PDFImage>()
  for (const pl of placements) {
    const st = stamps.get(pl.stampId)
    if (!st) continue
    let img = embedded.get(pl.stampId)
    if (!img) {
      img = await out.embedPng(new Uint8Array(await st.png.arrayBuffer()))
      embedded.set(pl.stampId, img)
    }
    const page = out.getPage(pl.page)
    const pj = await doc.pdf.getPage(pl.page + 1)
    const vp = pj.getViewport({ scale: 1 })
    const w = pl.w * vp.width
    const h = w / pl.aspect
    // display point -> PDF user space (handles CropBox offset and /Rotate)
    const [x, y] = vp.convertToPdfPoint(pl.cx * vp.width, pl.cy * vp.height)
    const rot = (((pj.rotate || 0) % 360) + 360) % 360
    const th = (rot * Math.PI) / 180
    // pdf-lib rotates counter-clockwise around (x, y); offset so the center lands on the point
    const ox = (w / 2) * Math.cos(th) - (h / 2) * Math.sin(th)
    const oy = (w / 2) * Math.sin(th) + (h / 2) * Math.cos(th)
    page.drawImage(img, { x: x - ox, y: y - oy, width: w, height: h, rotate: degrees(rot) })
  }
  return out.save()
}

function loadImg(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const im = new Image()
    im.onload = () => {
      URL.revokeObjectURL(url)
      resolve(im)
    }
    im.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('img'))
    }
    im.src = url
  })
}

/** Draw the stamps onto the photo at full resolution. */
export async function stampImage(
  doc: ImageDoc,
  placements: Placement[],
  stamps: Map<string, StampImage>,
): Promise<Blob> {
  const W = doc.bitmap.width
  const H = doc.bitmap.height
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  if (!doc.png) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
  }
  ctx.drawImage(doc.bitmap, 0, 0)
  ctx.imageSmoothingQuality = 'high'
  const imgs = new Map<string, HTMLImageElement>()
  for (const pl of placements) {
    const st = stamps.get(pl.stampId)
    if (!st) continue
    let im = imgs.get(pl.stampId)
    if (!im) {
      im = await loadImg(st.png)
      imgs.set(pl.stampId, im)
    }
    const w = pl.w * W
    const h = w / pl.aspect
    ctx.drawImage(im, pl.cx * W - w / 2, pl.cy * H - h / 2, w, h)
  }
  const type = doc.png ? 'image/png' : 'image/jpeg'
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('export'))), type, 0.92),
  )
}
