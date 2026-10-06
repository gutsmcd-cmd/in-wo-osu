import './style.css'
import { askPersist, deleteStamp, listStamps, load, putStamp, save, type Stamp, type StampKind } from './db'
import { dict, type Dict, type Lang } from './i18n'
import {
  closeDoc,
  LockedError,
  openFile,
  pageSize,
  renderPage,
  stampImage,
  stampPdf,
  type Doc,
  type Placement,
  type StampImage,
} from './doc'
import { cleanStampPhoto, cropToInk, fileToBitmap, INKS, renderSeal, SignPad, toPng } from './stamp'

const MAX_STAMPS = 6
const MIN_W = 0.015
const MAX_W = 0.7
const MM = 72 / 25.4 // PDF points per mm

let lang: Lang = 'ja'
let t: Dict = dict.ja

let stamps: Stamp[] = []
const stampCache = new Map<string, StampImage & { url: string }>()
let activeStamp: string | null = null

let doc: Doc | null = null
let page = 0
let pageW = 1 // page width in points (pdf) or pixels (image)
let pageH = 1
let placements: Placement[] = []
let selected: number | null = null
let undoStack: Placement[][] = []
let nextId = 1
let busy = false
let prepared: File | null = null // output ready to share without rebuilding
let canShareFiles = false

// ---------- DOM ----------
const app = document.querySelector<HTMLDivElement>('#app')!

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text) n.textContent = text
  return n
}
function button(cls: string): HTMLButtonElement {
  const b = el('button', cls)
  b.type = 'button'
  return b
}

const wrap = el('main', 'wrap')
const top = el('header', 'top')
const titleBox = el('div')
const title = el('h1')
const lead = el('p', 'lead')
titleBox.append(title, lead)
const langBtn = button('pill')
top.append(titleBox, langBtn)

// stamp tray
const tray = el('section', 'tray')
const trayLabel = el('h2', 'glabel')
const tiles = el('div', 'tiles')
const trayMsg = el('p', 'traymsg')
const delStampBtn = button('textbtn danger')
tray.append(trayLabel, tiles, trayMsg, delStampBtn)

// document area
const docArea = el('section', 'docarea')
const openBtn = button('empty-pick')
const openStrong = el('strong')
const openSpan = el('span')
openBtn.append(openStrong, openSpan)
const docBar = el('div', 'docbar')
const fileName = el('span', 'fname')
const otherBtn = button('small')
docBar.append(fileName, otherBtn)
const stageWrap = el('div', 'stage-wrap')
const stage = el('div', 'stage')
const pageCanvas = el('canvas', 'page')
const layer = el('div', 'layer')
stage.append(pageCanvas, layer)
stageWrap.append(stage)
const hint = el('p', 'hint')
const pager = el('div', 'pager')
const prevBtn = button('small')
const pageLabel = el('span', 'pagelabel')
const nextBtn = button('small')
pager.append(prevBtn, pageLabel, nextBtn)
const tools = el('div', 'tools')
const sizeRow = el('label', 'sizerow')
const sizeName = el('span', 'sname')
const slider = el('input', 'slider')
slider.type = 'range'
slider.min = '0'
slider.max = '1000'
slider.step = '1'
const sizeVal = el('span', 'sval')
sizeRow.append(sizeName, slider, sizeVal)
const toolRow = el('div', 'row')
const undoBtn = button('small')
const removeBtn = button('small')
toolRow.append(undoBtn, removeBtn)
tools.append(sizeRow, toolRow)
docArea.append(openBtn, docBar, stageWrap, pager, hint, tools)

const status = el('p', 'status')
status.setAttribute('role', 'status')
status.setAttribute('aria-live', 'polite')
const note = el('p', 'note')
const privacy = el('p', 'privacy')
wrap.append(top, tray, docArea, status, note, privacy)

const actions = el('footer', 'actions')
const saveBtn = button('big primary')
const shareBtn = button('big')
actions.append(saveBtn, shareBtn)

const fileInput = el('input')
fileInput.type = 'file'
fileInput.accept = 'application/pdf,.pdf,image/*'
fileInput.hidden = true

// stamp maker sheet
const sheet = el('section', 'sheet')
sheet.setAttribute('role', 'dialog')
sheet.setAttribute('aria-modal', 'true')
const sheetInner = el('div', 'sheet-inner')
const sheetTitle = el('h2', 'sheet-title')
const tabs = el('div', 'seg')
tabs.setAttribute('role', 'radiogroup')
const tabBtns = [0, 1, 2].map(() => {
  const b = button('opt')
  b.setAttribute('role', 'radio')
  tabs.append(b)
  return b
})
// name panel
const namePanel = el('div', 'panel')
const nameLabel = el('label', 'glabel')
const nameInput = el('input', 'name-input')
nameInput.type = 'text'
nameInput.autocomplete = 'off'
nameInput.setAttribute('autocapitalize', 'off')
nameInput.spellcheck = false
const nameLabelText = el('span')
nameLabel.append(nameLabelText, nameInput)
const roughRow = el('label', 'check')
const roughBox = el('input')
roughBox.type = 'checkbox'
roughBox.checked = true
const roughText = el('span')
roughRow.append(roughBox, roughText)
const sealPreview = el('div', 'preview checker')
namePanel.append(nameLabel, roughRow, sealPreview)
// sign panel
const signPanel = el('div', 'panel')
const pad = new SignPad()
const padWrap = el('div', 'padwrap')
const padHint = el('span', 'padhint')
padWrap.append(pad.el, padHint)
const inkRow = el('div', 'inkrow')
const inkLabel = el('span', 'glabel')
const inkSeg = el('div', 'seg')
inkSeg.setAttribute('role', 'radiogroup')
const inkBtns = INKS.map((color) => {
  const b = button('opt')
  b.setAttribute('role', 'radio')
  const sw = el('span', 'swatch')
  sw.style.background = color
  b.append(sw, el('span'))
  inkSeg.append(b)
  return b
})
const clearBtn = button('small')
inkRow.append(inkLabel, inkSeg, clearBtn)
signPanel.append(padWrap, inkRow)
// photo panel
const photoPanel = el('div', 'panel')
const photoBtn = button('wide')
const photoHint = el('p', 'note left')
const photoPreview = el('div', 'preview checker')
const strengthRow = el('label', 'sizerow')
const strengthName = el('span', 'sname')
const strength = el('input', 'slider')
strength.type = 'range'
strength.min = '0'
strength.max = '100'
strength.value = '30'
strengthRow.append(strengthName, strength)
const photoInput = el('input')
photoInput.type = 'file'
photoInput.accept = 'image/*'
photoInput.hidden = true
photoPanel.append(photoBtn, photoHint, photoPreview, strengthRow, photoInput)

const sheetMsg = el('p', 'status')
sheetMsg.setAttribute('role', 'status')
const sheetActions = el('div', 'row sheet-actions')
const cancelBtn = button('big')
const useBtn = button('big primary')
sheetActions.append(cancelBtn, useBtn)
sheetInner.append(sheetTitle, tabs, namePanel, signPanel, photoPanel, sheetMsg, sheetActions)
sheet.append(sheetInner)
sheet.hidden = true

app.append(wrap, actions, fileInput, sheet)

// ---------- helpers ----------
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
const wToSlider = (w: number): number => (Math.log(w / MIN_W) / Math.log(MAX_W / MIN_W)) * 1000
const sliderToW = (v: number): number => MIN_W * Math.pow(MAX_W / MIN_W, v / 1000)

function say(msg: string): void {
  status.textContent = msg
}

function current(): Placement | undefined {
  return placements.find((p) => p.id === selected)
}

function pushUndo(): void {
  undoStack.push(placements.map((p) => ({ ...p })))
  if (undoStack.length > 60) undoStack.shift()
  prepared = null
}

function sizeText(w: number): string {
  if (doc?.kind === 'pdf') return `${Math.round((w * pageW) / MM)} mm`
  return `${Math.round(w * 100)}%`
}

// ---------- text ----------
function renderText(): void {
  document.documentElement.lang = lang
  document.title = t.app
  title.textContent = t.app
  lead.textContent = t.lead
  langBtn.textContent = t.toggle
  langBtn.lang = lang === 'ja' ? 'en' : 'ja'
  trayLabel.textContent = t.stamps
  delStampBtn.textContent = t.deleteStamp
  openStrong.textContent = t.open
  openSpan.textContent = t.openHint
  otherBtn.textContent = t.other
  prevBtn.textContent = `‹ ${t.prev}`
  nextBtn.textContent = `${t.next} ›`
  sizeName.textContent = t.size
  slider.setAttribute('aria-label', t.size)
  undoBtn.textContent = t.undo
  removeBtn.textContent = t.remove
  saveBtn.textContent = busy ? t.saving : t.save
  shareBtn.textContent = t.share
  note.textContent = t.note
  privacy.textContent = t.privacy
  sheetTitle.textContent = t.makerTitle
  tabBtns.forEach((b, i) => (b.textContent = t.tabs[i]))
  nameLabelText.textContent = t.nameLabel
  nameInput.placeholder = t.namePh
  roughText.textContent = t.rough
  padHint.textContent = t.signHint
  inkLabel.textContent = t.ink
  inkBtns.forEach((b, i) => (b.lastElementChild!.textContent = t.inks[i]))
  clearBtn.textContent = t.clear
  photoBtn.textContent = t.photoPick
  photoHint.textContent = t.photoHint
  strengthName.textContent = t.strength
  strength.setAttribute('aria-label', t.strength)
  cancelBtn.textContent = t.cancel
  useBtn.textContent = t.useStamp
  renderTiles()
  renderDocState()
}

// ---------- stamp tray ----------
function renderTiles(): void {
  tiles.replaceChildren()
  for (const s of stamps) {
    const b = button('tile')
    b.setAttribute('aria-pressed', String(s.id === activeStamp))
    b.setAttribute('aria-label', t.kinds[s.kind])
    const img = el('img')
    img.alt = ''
    img.src = stampCache.get(s.id)?.url ?? ''
    b.append(img)
    b.addEventListener('click', () => {
      activeStamp = activeStamp === s.id ? null : s.id
      renderTiles()
      renderDocState()
    })
    tiles.append(b)
  }
  const mk = button('tile make')
  mk.append(el('b', '', '+'), el('span', '', t.make))
  mk.addEventListener('click', openMaker)
  tiles.append(mk)
  trayMsg.textContent = stamps.length === 0 ? t.noStamps : ''
  trayMsg.hidden = stamps.length > 0
  delStampBtn.hidden = !activeStamp
}

function cacheStamp(s: Stamp): void {
  if (!stampCache.has(s.id)) stampCache.set(s.id, { png: s.png, w: s.w, h: s.h, url: URL.createObjectURL(s.png) })
}

async function refreshStamps(): Promise<void> {
  stamps = await listStamps()
  stamps.forEach(cacheStamp)
  if (activeStamp && !stamps.some((s) => s.id === activeStamp)) activeStamp = null
  renderTiles()
}

delStampBtn.addEventListener('click', async () => {
  if (!activeStamp || !confirm(t.confirmDelete)) return
  // stamps already placed on the open document stay (kept in memory) until it is closed
  await deleteStamp(activeStamp).catch(() => undefined)
  activeStamp = null
  await refreshStamps()
  renderDocState()
})

// ---------- document ----------
function renderDocState(): void {
  const has = !!doc
  openBtn.hidden = has
  docBar.hidden = !has
  stageWrap.hidden = !has
  pager.hidden = !has || (doc?.pages ?? 1) < 2
  hint.hidden = !has
  tools.hidden = !has
  actions.hidden = !has
  wrap.classList.toggle('with-actions', has)
  if (!doc) return
  fileName.textContent = doc.name
  pageLabel.textContent = t.page(page + 1, doc.pages)
  prevBtn.disabled = page <= 0
  nextBtn.disabled = page >= doc.pages - 1
  hint.textContent = activeStamp ? t.tapHint : stamps.length ? t.pickFirst : t.noStamps
  const cur = current()
  sizeRow.hidden = !cur
  if (cur) {
    slider.value = String(Math.round(wToSlider(cur.w)))
    sizeVal.textContent = sizeText(cur.w)
  }
  undoBtn.disabled = undoStack.length === 0
  removeBtn.disabled = !cur
  saveBtn.disabled = busy
  shareBtn.hidden = !canShareFiles
  shareBtn.disabled = busy
  renderLayer()
}

function renderLayer(): void {
  layer.replaceChildren()
  for (const p of placements) {
    if (p.page !== page) continue
    const st = stampCache.get(p.stampId)
    if (!st) continue
    const img = el('img', 'placed')
    img.src = st.url
    img.alt = ''
    img.draggable = false
    img.dataset.id = String(p.id)
    img.style.left = `${p.cx * 100}%`
    img.style.top = `${p.cy * 100}%`
    img.style.width = `${p.w * 100}%`
    img.classList.toggle('sel', p.id === selected)
    layer.append(img)
  }
}

function positionPlaced(p: Placement): void {
  const img = layer.querySelector<HTMLImageElement>(`img[data-id="${p.id}"]`)
  if (!img) return
  img.style.left = `${p.cx * 100}%`
  img.style.top = `${p.cy * 100}%`
  img.style.width = `${p.w * 100}%`
}

let renderSeq = 0
async function showPage(): Promise<void> {
  if (!doc) return
  const seq = ++renderSeq
  const size = await pageSize(doc, page)
  if (seq !== renderSeq || !doc) return
  pageW = size.w
  pageH = size.h
  const maxW = Math.min(stageWrap.clientWidth || wrap.clientWidth - 32, 760)
  const maxH = Math.max(300, window.innerHeight - 220)
  const k = Math.min(maxW / pageW, maxH / pageH)
  const cssW = Math.max(1, Math.floor(pageW * k))
  const cssH = Math.max(1, Math.floor(pageH * k))
  stage.style.width = `${cssW}px`
  stage.style.height = `${cssH}px`
  renderDocState()
  try {
    await renderPage(doc, page, pageCanvas, cssW, cssH)
  } catch {
    if (seq === renderSeq) say(t.badFile)
  }
}

async function openDoc(file: File): Promise<void> {
  say(t.loading)
  let next: Doc
  try {
    next = await openFile(file)
  } catch (err) {
    say(err instanceof LockedError ? t.locked : t.badFile)
    return
  }
  await closeDoc(doc)
  doc = next
  page = 0
  placements = []
  undoStack = []
  selected = null
  prepared = null
  const probe = new File([new Uint8Array(1)], doc.kind === 'pdf' ? 'x.pdf' : 'x.jpg', {
    type: doc.kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
  })
  try {
    canShareFiles = typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
  } catch {
    canShareFiles = false
  }
  say('')
  renderDocState()
  await showPage()
}

openBtn.addEventListener('click', () => fileInput.click())
otherBtn.addEventListener('click', () => {
  if (placements.length && !confirm(t.discard)) return
  fileInput.click()
})
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0]
  fileInput.value = ''
  if (f) void openDoc(f)
})
prevBtn.addEventListener('click', () => {
  if (!doc || page <= 0) return
  page--
  selected = null
  void showPage()
})
nextBtn.addEventListener('click', () => {
  if (!doc || page >= doc.pages - 1) return
  page++
  selected = null
  void showPage()
})

function defaultWidth(kind: StampKind): number {
  if (doc?.kind === 'pdf') return clamp(((kind === 'sign' ? 50 : 12) * MM) / pageW, MIN_W, MAX_W)
  const base = Math.min(pageW, pageH)
  return clamp(((kind === 'sign' ? 0.4 : 0.12) * base) / pageW, MIN_W, MAX_W)
}

function place(cx: number, cy: number): void {
  if (!activeStamp) {
    say(stamps.length ? t.pickFirst : t.noStamps)
    return
  }
  const st = stampCache.get(activeStamp)
  const meta = stamps.find((s) => s.id === activeStamp)
  if (!st || !meta) return
  pushUndo()
  const p: Placement = {
    id: nextId++,
    stampId: activeStamp,
    page,
    cx: clamp(cx, 0, 1),
    cy: clamp(cy, 0, 1),
    w: defaultWidth(meta.kind),
    aspect: st.w / st.h,
  }
  placements.push(p)
  selected = p.id
  say('')
  renderDocState()
}

// pointer handling on the page: tap to place, drag to move, pinch to resize
type Ptr = { x: number; y: number; sx: number; sy: number }
const ptrs = new Map<number, Ptr>()
let drag: { id: number; cx: number; cy: number; moved: boolean; pointer: number } | null = null
let pinch: { id: number; d: number; w: number } | null = null
let tapCandidate = false

function dist(): number {
  const [a, b] = [...ptrs.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}

stage.addEventListener('pointerdown', (e) => {
  if (!doc) return
  e.preventDefault()
  stage.setPointerCapture(e.pointerId)
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY })
  if (ptrs.size === 1) {
    const target = (e.target as HTMLElement).closest<HTMLImageElement>('img.placed')
    if (target) {
      const p = placements.find((q) => q.id === Number(target.dataset.id))
      if (p) {
        if (selected !== p.id) {
          selected = p.id
          renderDocState()
        }
        drag = { id: p.id, cx: p.cx, cy: p.cy, moved: false, pointer: e.pointerId }
      }
      tapCandidate = false
    } else {
      tapCandidate = true
    }
  } else if (ptrs.size === 2) {
    tapCandidate = false
    drag = null
    const cur = current()
    if (cur) {
      pushUndo()
      pinch = { id: cur.id, d: Math.max(10, dist()), w: cur.w }
    }
  }
})

stage.addEventListener('pointermove', (e) => {
  const pt = ptrs.get(e.pointerId)
  if (!pt) return
  pt.x = e.clientX
  pt.y = e.clientY
  const r = stage.getBoundingClientRect()
  if (pinch && ptrs.size >= 2) {
    const p = placements.find((q) => q.id === pinch!.id)
    if (!p) return
    p.w = clamp((pinch.w * dist()) / pinch.d, MIN_W, MAX_W)
    positionPlaced(p)
    slider.value = String(Math.round(wToSlider(p.w)))
    sizeVal.textContent = sizeText(p.w)
    return
  }
  if (drag && drag.pointer === e.pointerId) {
    const dx = (pt.x - pt.sx) / r.width
    const dy = (pt.y - pt.sy) / r.height
    if (!drag.moved && Math.hypot(pt.x - pt.sx, pt.y - pt.sy) < 4) return
    const p = placements.find((q) => q.id === drag!.id)
    if (!p) return
    if (!drag.moved) {
      pushUndo()
      drag.moved = true
    }
    p.cx = clamp(drag.cx + dx, 0, 1)
    p.cy = clamp(drag.cy + dy, 0, 1)
    positionPlaced(p)
    return
  }
  if (tapCandidate && Math.hypot(pt.x - pt.sx, pt.y - pt.sy) > 10) tapCandidate = false
})

function endPointer(e: PointerEvent, cancelled: boolean): void {
  const pt = ptrs.get(e.pointerId)
  if (!pt) return
  ptrs.delete(e.pointerId)
  if (ptrs.size < 2) pinch = null
  if (drag && drag.pointer === e.pointerId) {
    drag = null
    renderDocState()
  }
  if (!cancelled && tapCandidate && ptrs.size === 0) {
    const r = stage.getBoundingClientRect()
    place((pt.x - r.left) / r.width, (pt.y - r.top) / r.height)
  }
  if (ptrs.size === 0) {
    tapCandidate = false
    renderDocState()
  }
}
stage.addEventListener('pointerup', (e) => endPointer(e, false))
stage.addEventListener('pointercancel', (e) => endPointer(e, true))

let sliderUndo = false
slider.addEventListener('input', () => {
  const p = current()
  if (!p) return
  if (!sliderUndo) {
    pushUndo()
    sliderUndo = true
  }
  p.w = sliderToW(Number(slider.value))
  positionPlaced(p)
  sizeVal.textContent = sizeText(p.w)
})
slider.addEventListener('change', () => {
  sliderUndo = false
  renderDocState()
})

undoBtn.addEventListener('click', () => {
  const prev = undoStack.pop()
  if (!prev) return
  placements = prev
  prepared = null
  if (!placements.some((p) => p.id === selected)) selected = null
  const cur = current()
  if (cur && cur.page !== page) selected = null
  renderDocState()
})
removeBtn.addEventListener('click', () => {
  if (selected == null) return
  pushUndo()
  placements = placements.filter((p) => p.id !== selected)
  selected = null
  renderDocState()
})

// ---------- save / share ----------
async function buildOutput(): Promise<File> {
  if (prepared) return prepared
  if (!doc) throw new Error('no doc')
  const cache = new Map<string, StampImage>()
  for (const [id, s] of stampCache) cache.set(id, s)
  let file: File
  if (doc.kind === 'pdf') {
    const bytes = await stampPdf(doc, placements, cache)
    file = new File([bytes as BlobPart], `${doc.name}-stamped.pdf`, { type: 'application/pdf' })
  } else {
    const blob = await stampImage(doc, placements, cache)
    const ext = doc.png ? 'png' : 'jpg'
    file = new File([blob], `${doc.name}-stamped.${ext}`, { type: blob.type })
  }
  prepared = file
  return file
}

function download(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

async function withBusy(fn: () => Promise<void>): Promise<void> {
  if (busy) return
  if (!placements.length) {
    say(t.nothing)
    return
  }
  busy = true
  say(t.saving)
  renderText()
  try {
    await fn()
  } catch (err) {
    say(err instanceof LockedError ? t.locked : t.saveFailed)
  } finally {
    busy = false
    renderText()
  }
}

saveBtn.addEventListener('click', () =>
  void withBusy(async () => {
    const f = await buildOutput()
    download(f)
    say(t.saved)
  }),
)

shareBtn.addEventListener('click', () =>
  void withBusy(async () => {
    const ready = !!prepared
    const f = await buildOutput()
    try {
      await navigator.share({ files: [f], title: f.name })
      say('')
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name === 'AbortError') say('')
      else if (!ready && name === 'NotAllowedError') say(t.tapAgain)
      else throw err
    }
  }),
)

// ---------- stamp maker ----------
let tab = 0
let ink = 0
let photoBitmap: ImageBitmap | null = null

function renderMaker(): void {
  tabBtns.forEach((b, i) => b.setAttribute('aria-checked', String(i === tab)))
  inkBtns.forEach((b, i) => b.setAttribute('aria-checked', String(i === ink)))
  namePanel.hidden = tab !== 0
  signPanel.hidden = tab !== 1
  photoPanel.hidden = tab !== 2
  strengthRow.hidden = !photoBitmap
}

function updateSealPreview(): void {
  const c = renderSeal(nameInput.value, roughBox.checked, 360)
  sealPreview.replaceChildren(c)
}

function updatePhotoPreview(): void {
  if (!photoBitmap) {
    photoPreview.replaceChildren()
    photoPreview.hidden = true
    return
  }
  photoPreview.hidden = false
  const c = cleanStampPhoto(photoBitmap, Number(strength.value))
  photoPreview.replaceChildren(cropToInk(c, 800, 40) ?? c)
}

function openMaker(): void {
  if (stamps.length >= MAX_STAMPS) {
    say(t.full)
    trayMsg.textContent = t.full
    trayMsg.hidden = false
    return
  }
  sheetMsg.textContent = ''
  sheet.hidden = false
  document.body.classList.add('locked')
  renderMaker()
  updateSealPreview()
  updatePhotoPreview()
  if (tab === 1) requestAnimationFrame(() => pad.fit())
  if (tab === 0) nameInput.focus()
}

function closeMaker(): void {
  sheet.hidden = true
  document.body.classList.remove('locked')
}

tabBtns.forEach((b, i) =>
  b.addEventListener('click', () => {
    tab = i
    sheetMsg.textContent = ''
    renderMaker()
    if (i === 1) requestAnimationFrame(() => pad.fit())
  }),
)
inkBtns.forEach((b, i) =>
  b.addEventListener('click', () => {
    ink = i
    pad.recolor(INKS[i])
    renderMaker()
  }),
)
clearBtn.addEventListener('click', () => pad.clear())
nameInput.addEventListener('input', () => {
  const chars = Array.from(nameInput.value)
  if (chars.length > 4) nameInput.value = chars.slice(0, 4).join('')
  updateSealPreview()
})
roughBox.addEventListener('change', updateSealPreview)
photoBtn.addEventListener('click', () => photoInput.click())
photoInput.addEventListener('change', async () => {
  const f = photoInput.files?.[0]
  photoInput.value = ''
  if (!f) return
  try {
    photoBitmap?.close()
    photoBitmap = await fileToBitmap(f)
    sheetMsg.textContent = ''
  } catch {
    photoBitmap = null
    sheetMsg.textContent = t.badFile
  }
  renderMaker()
  updatePhotoPreview()
})
strength.addEventListener('input', updatePhotoPreview)
cancelBtn.addEventListener('click', closeMaker)
sheet.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMaker()
})

let making = false
useBtn.addEventListener('click', async () => {
  if (making) return
  let out: HTMLCanvasElement | null = null
  let kind: StampKind = 'seal'
  if (tab === 0) {
    if (!nameInput.value.trim()) {
      sheetMsg.textContent = t.emptyName
      return
    }
    out = renderSeal(nameInput.value, roughBox.checked, 480)
  } else if (tab === 1) {
    kind = 'sign'
    out = pad.strokes ? cropToInk(pad.el, 1200) : null
    if (!out) {
      sheetMsg.textContent = t.emptySign
      return
    }
  } else {
    kind = 'photo'
    if (!photoBitmap) {
      sheetMsg.textContent = t.emptyPhoto
      return
    }
    out = cropToInk(cleanStampPhoto(photoBitmap, Number(strength.value)), 800, 40)
    if (!out) {
      sheetMsg.textContent = t.noInk
      return
    }
  }
  making = true
  try {
    await saveNewStamp(out, kind)
  } finally {
    making = false
  }
})

async function saveNewStamp(out: HTMLCanvasElement, kind: StampKind): Promise<void> {
  const png = await toPng(out)
  const s: Stamp = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    png,
    w: out.width,
    h: out.height,
    created: Date.now(),
  }
  try {
    await putStamp(s)
  } catch {
    /* storage refused: still usable for this session (added below) */
  }
  cacheStamp(s)
  await refreshStamps()
  if (!stamps.some((x) => x.id === s.id)) {
    stamps.push(s)
  }
  activeStamp = s.id
  if (tab === 1) pad.clear()
  closeMaker()
  renderTiles()
  renderDocState()
  void askPersist()
}

// ---------- language & boot ----------
langBtn.addEventListener('click', () => {
  lang = lang === 'ja' ? 'en' : 'ja'
  t = dict[lang]
  renderText()
  void save('lang', lang)
})

let resizeTimer = 0
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    if (doc) void showPage()
    if (!sheet.hidden && tab === 1 && pad.strokes === 0) pad.fit()
  }, 150)
})

async function boot(): Promise<void> {
  const saved = await load<Lang>('lang')
  if (saved === 'en' || saved === 'ja') lang = saved
  t = dict[lang]
  await refreshStamps()
  if (!activeStamp && stamps.length) activeStamp = stamps[stamps.length - 1].id
  renderText()
  if (stamps.length) void askPersist()
}

renderText()
renderMaker()
void boot()
