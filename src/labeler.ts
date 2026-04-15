/**
 * labeler.ts
 *
 * Sheet music symbol labeling tool for OMR training data.
 * Processes PDFs up to staffRemoved, then lets the user draw bounding boxes
 * around symbols and export COCO JSON + YOLO .txt + PNG images.
 */

import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// ── Symbol classes ────────────────────────────────────────────────────────────
// IDs match the dataset schema:
//   0–20 from the standard OMR label set, plus 21–25 for extra symbols.
// Keys: '1'–'9' then 'q','w','e','r','t','y','u','i','o','p','a','s','d','f'
// Classes with no key assigned are click-only (there are only 14 shortcut slots
// after reserving digits for the first 9).

const CLASSES = [
  // ── Notes ──────────────────────────────────────────────────────────────────
  {
    id: 0, name: 'quarter_note', color: '#00c850', key: '1',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="12" cy="20" rx="5" ry="4" fill="#00c850"/>
      <line x1="17" y1="20" x2="17" y2="6" stroke="#00c850" stroke-width="1.5"/>
    </svg>`,
  },
  {
    id: 1, name: 'half_note', color: '#00d4aa', key: '2',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="12" cy="20" rx="5" ry="4" fill="none" stroke="#00d4aa" stroke-width="2"/>
      <line x1="17" y1="20" x2="17" y2="6" stroke="#00d4aa" stroke-width="1.5"/>
    </svg>`,
  },
  {
    id: 2, name: 'whole_note', color: '#00aaff', key: '3',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="14" cy="16" rx="7" ry="5" fill="none" stroke="#00aaff" stroke-width="2"/>
      <ellipse cx="14" cy="16" rx="3" ry="5" fill="#111"/>
    </svg>`,
  },
  {
    id: 3, name: 'dotted_quarter_note', color: '#44dd88', key: '4',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="11" cy="20" rx="5" ry="4" fill="#44dd88"/>
      <line x1="16" y1="20" x2="16" y2="6" stroke="#44dd88" stroke-width="1.5"/>
      <circle cx="22" cy="19" r="2" fill="#44dd88"/>
    </svg>`,
  },
  {
    id: 4, name: 'dotted_half_note', color: '#22ccbb', key: '5',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="11" cy="20" rx="5" ry="4" fill="none" stroke="#22ccbb" stroke-width="2"/>
      <line x1="16" y1="20" x2="16" y2="6" stroke="#22ccbb" stroke-width="1.5"/>
      <circle cx="22" cy="19" r="2" fill="#22ccbb"/>
    </svg>`,
  },
  // ── Rests ───────────────────────────────────────────────────────────────────
  {
    id: 5, name: 'quarter_rest', color: '#ff8c00', key: '6',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="7" y="22" font-size="18" fill="#ff8c00">𝄽</text>
    </svg>`,
  },
  {
    id: 6, name: 'eight_rest', color: '#ffaa33', key: '7',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="7" y="22" font-size="18" fill="#ffaa33">𝄾</text>
    </svg>`,
  },
  {
    id: 7, name: 'sixteenth_rest', color: '#ffbb55', key: '8',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="7" y="22" font-size="18" fill="#ffbb55">𝄿</text>
    </svg>`,
  },
  {
    id: 8, name: 'whole_half_rest', color: '#ffcc00', key: '9',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="11" width="14" height="5" fill="#ffcc00"/>
      <rect x="7" y="17" width="14" height="2" fill="#ffcc00" opacity="0.5"/>
    </svg>`,
  },
  // ── Beams & flags ───────────────────────────────────────────────────────────
  {
    id: 9, name: 'eight_beam', color: '#ff4400', key: 'q',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="12" width="20" height="4" fill="#ff4400"/>
    </svg>`,
  },
  {
    id: 10, name: 'sixteenth_beam', color: '#ff6622', key: 'w',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="10" width="20" height="3" fill="#ff6622"/>
      <rect x="4" y="15" width="20" height="3" fill="#ff6622"/>
    </svg>`,
  },
  {
    id: 11, name: 'thirty_second_beam', color: '#ff8844', key: 'e',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="8"  width="20" height="3" fill="#ff8844"/>
      <rect x="4" y="13" width="20" height="3" fill="#ff8844"/>
      <rect x="4" y="18" width="20" height="3" fill="#ff8844"/>
    </svg>`,
  },
  {
    id: 12, name: 'eight_flag', color: '#ffaa66', key: 'r',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <line x1="10" y1="6" x2="10" y2="22" stroke="#ffaa66" stroke-width="1.5"/>
      <path d="M10 6 Q22 10 10 16" fill="none" stroke="#ffaa66" stroke-width="1.5"/>
    </svg>`,
  },
  {
    id: 13, name: 'sixteenth_flag', color: '#ffcc88', key: 't',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <line x1="10" y1="4" x2="10" y2="24" stroke="#ffcc88" stroke-width="1.5"/>
      <path d="M10 4  Q22 8  10 14" fill="none" stroke="#ffcc88" stroke-width="1.5"/>
      <path d="M10 11 Q22 15 10 21" fill="none" stroke="#ffcc88" stroke-width="1.5"/>
    </svg>`,
  },
  // ── Clefs ───────────────────────────────────────────────────────────────────
  {
    id: 14, name: 'treble_clef', color: '#ff5050', key: 'y',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="6" y="24" font-size="20" fill="#ff5050">𝄞</text>
    </svg>`,
  },
  {
    id: 15, name: 'bass_clef', color: '#ff7070', key: 'u',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="5" y="22" font-size="18" fill="#ff7070">𝄢</text>
    </svg>`,
  },
  // ── Accidentals ─────────────────────────────────────────────────────────────
  {
    id: 16, name: 'sharp', color: '#ffdd00', key: 'i',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="5" y="22" font-size="18" fill="#ffdd00">♯</text>
    </svg>`,
  },
  {
    id: 17, name: 'flat', color: '#ffee55', key: 'o',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="5" y="22" font-size="18" fill="#ffee55">♭</text>
    </svg>`,
  },
  {
    id: 18, name: 'natural', color: '#eeff88', key: 'p',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="5" y="22" font-size="18" fill="#eeff88">♮</text>
    </svg>`,
  },
  // ── Structure ───────────────────────────────────────────────────────────────
  {
    id: 19, name: 'barline', color: '#00dddd', key: 'a',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <line x1="14" y1="4" x2="14" y2="24" stroke="#00dddd" stroke-width="2"/>
    </svg>`,
  },
  {
    id: 20, name: 'time_signature', color: '#cc44ff', key: 's',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="7" y="16" font-size="12" fill="#cc44ff" font-weight="bold" font-family="serif">4</text>
      <line x1="6" y1="18" x2="22" y2="18" stroke="#cc44ff" stroke-width="0.8" opacity="0.5"/>
      <text x="7" y="27" font-size="12" fill="#cc44ff" font-weight="bold" font-family="serif">4</text>
    </svg>`,
  },
  {
    id: 21, name: 'decrescendo', color: '#aa88ff', key: 'd',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <line x1="4" y1="10" x2="24" y2="16" stroke="#aa88ff" stroke-width="1.5"/>
      <line x1="4" y1="22" x2="24" y2="16" stroke="#aa88ff" stroke-width="1.5"/>
    </svg>`,
  },
  // ── Extras ──────────────────────────────────────────────────────────────────
  {
    id: 22, name: 'crescendo', color: '#cc99ff', key: 'f',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <line x1="24" y1="10" x2="4" y2="16" stroke="#cc99ff" stroke-width="1.5"/>
      <line x1="24" y1="22" x2="4" y2="16" stroke="#cc99ff" stroke-width="1.5"/>
    </svg>`,
  },
  {
    id: 23, name: 'dynamic', color: '#88ff00', key: '',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="5" y="22" font-size="16" fill="#88ff00" font-style="italic">f</text>
    </svg>`,
  },
  {
    id: 24, name: 'tie_slur', color: '#66bbff', key: '',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 18 Q14 8 24 18" fill="none" stroke="#66bbff" stroke-width="1.5"/>
    </svg>`,
  },
  {
    id: 25, name: 'dot', color: '#aaaaaa', key: '',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="15" r="3" fill="#aaaaaa"/>
    </svg>`,
  },
  // ── Time signature symbols ───────────────────────────────────────────────────
  {
    id: 26, name: 'common_time', color: '#e066ff', key: 'g',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 7 A9 9 0 1 0 20 21" fill="none" stroke="#e066ff" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 27, name: 'cut_time', color: '#cc88ff', key: 'h',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 7 A9 9 0 1 0 20 21" fill="none" stroke="#cc88ff" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="14" y1="4" x2="14" y2="24" stroke="#cc88ff" stroke-width="1.5"/>
    </svg>`,
  },
]

// ── Data model ────────────────────────────────────────────────────────────────

interface LabelBox {
  id: string
  classId: number
  x: number; y: number; w: number; h: number  // crop-relative pixels
}

interface SystemCrop {
  sheetId: string
  sysIdx: number
  r: number; c: number; w: number; h: number  // full-page coords
  canvas: HTMLCanvasElement      // staff-removed (greyscale binary)
  origCanvas: HTMLCanvasElement  // original full-colour render
  labels: LabelBox[]
}

interface Sheet {
  id: string
  filename: string
  pageNum: number
  width: number; height: number
  staffRemoved: Uint8Array
  systemBoxes: { r: number; c: number; w: number; h: number }[]
  staffLines:  { r: number; c: number; w: number; h: number }[]
  S: number
  crops: SystemCrop[]
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const btnUpload     = document.getElementById('btn-upload')      as HTMLButtonElement
const pdfInputEl    = document.getElementById('pdf-input')       as HTMLInputElement
const btnLoadLabels = document.getElementById('btn-load-labels') as HTMLButtonElement
const labelsInputEl = document.getElementById('labels-input')    as HTMLInputElement
const btnExport     = document.getElementById('btn-export')      as HTMLButtonElement
const zoomSlider    = document.getElementById('zoom-slider')     as HTMLInputElement
const zoomValEl     = document.getElementById('zoom-val')        as HTMLSpanElement
const statusEl      = document.getElementById('status')          as HTMLSpanElement

const sheetsList    = document.getElementById('sheets-list')     as HTMLDivElement
const boxesList     = document.getElementById('boxes-list')      as HTMLDivElement
const delSelectedBtn= document.getElementById('del-selected-btn')as HTMLButtonElement

const btnPrevCrop   = document.getElementById('btn-prev-crop')   as HTMLButtonElement
const btnNextCrop   = document.getElementById('btn-next-crop')   as HTMLButtonElement
const cropCounter   = document.getElementById('crop-counter')    as HTMLSpanElement
const cropSheetLabel= document.getElementById('crop-sheet-label')as HTMLSpanElement
const baseCanvas    = document.getElementById('base-canvas')     as HTMLCanvasElement
const overlayCanvas = document.getElementById('overlay-canvas')  as HTMLCanvasElement
const refCanvas     = document.getElementById('ref-canvas')      as HTMLCanvasElement

const classListEl   = document.getElementById('class-list')     as HTMLDivElement

// ── App state ─────────────────────────────────────────────────────────────────

let sheets: Sheet[] = []
let allCrops: SystemCrop[] = []   // flat list across all sheets
let currentCropIdx = 0
let activeClassId  = 0
let selectedBoxId: string | null = null
let zoom = 1.0

// Draw state
let isDragging = false
let dragStartX = 0
let dragStartY = 0
let dragCurX   = 0
let dragCurY   = 0

// ── Build class buttons ───────────────────────────────────────────────────────

for (const cls of CLASSES) {
  const btn = document.createElement('button')
  btn.className = 'class-btn'
  btn.dataset['classId'] = String(cls.id)
  btn.innerHTML = `
    <span class="class-icon">${cls.svg}</span>
    ${cls.name}
    ${cls.key ? `<span class="key-hint">[${cls.key}]</span>` : ''}
  `
  btn.addEventListener('click', () => setActiveClass(cls.id))
  classListEl.appendChild(btn)
}
setActiveClass(0)

function setActiveClass(id: number) {
  activeClassId = id
  for (const btn of classListEl.querySelectorAll<HTMLButtonElement>('.class-btn')) {
    btn.classList.toggle('active', Number(btn.dataset['classId']) === id)
  }
}

// ── Toolbar wiring ────────────────────────────────────────────────────────────

btnUpload.addEventListener('click', () => pdfInputEl.click())
pdfInputEl.addEventListener('change', onPdfFilesSelected)

btnLoadLabels.addEventListener('click', () => labelsInputEl.click())
labelsInputEl.addEventListener('change', onLoadLabels)

btnExport.addEventListener('click', onExportAll)

zoomSlider.addEventListener('input', () => {
  zoom = parseInt(zoomSlider.value) / 100
  zoomValEl.textContent = `${zoomSlider.value}%`
  renderCurrentCrop()
})

btnPrevCrop.addEventListener('click', () => navigateCrop(-1))
btnNextCrop.addEventListener('click', () => navigateCrop(+1))

delSelectedBtn.addEventListener('click', deleteSelected)

// ── PDF processing ────────────────────────────────────────────────────────────

async function onPdfFilesSelected() {
  const files = Array.from(pdfInputEl.files ?? [])
  if (!files.length) return
  sheets = []
  allCrops = []
  currentCropIdx = 0
  sheetsList.innerHTML = ''

  // Count total pages across all files first
  showLoading('Loading PDFs…', 'reading files…')
  await yieldToUI()

  const pdfDocs: { file: File; pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']> }[] = []
  for (const file of files) {
    const buf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise
    pdfDocs.push({ file, pdf })
  }

  const totalPages = pdfDocs.reduce((sum, { pdf }) => sum + (pdf as any).numPages, 0)
  let pagesDone = 0

  for (const { file, pdf } of pdfDocs) {
    const numPages = (pdf as any).numPages
    for (let p = 1; p <= numPages; p++) {
      pagesDone++
      const pageLabel = `${file.name} — page ${p}/${numPages} (${pagesDone}/${totalPages})`
      showLoading(`Processing page ${pagesDone} of ${totalPages}`, '')
      const sheet = await processPage(pdf, file.name, p, pageLabel)
      sheets.push(sheet)
      allCrops.push(...sheet.crops)
      addSheetToList(sheet)
    }
  }

  hideLoading()
  setStatus(`${sheets.length} page(s) loaded, ${allCrops.length} system crops.`)
  if (allCrops.length > 0) showCrop(0)
}

async function processPage(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  filename: string,
  pageNum: number,
  pageLabel: string
): Promise<Sheet> {
  // ── Phase 1: PDF render ───────────────────────────────────────────────────
  updateLoadingPhase(`${pageLabel} — rendering PDF…`)
  const page = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale: 1.5 })
  const { width, height } = viewport

  const offscreen = document.createElement('canvas')
  offscreen.width  = width
  offscreen.height = height
  const ctx = offscreen.getContext('2d')!
  await page.render({ canvasContext: ctx, viewport }).promise
  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData

  // ── Phase 2: Greyscale ────────────────────────────────────────────────────
  updateLoadingPhase(`${pageLabel} — greyscale…`)
  await yieldToUI()
  const grey = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++)
    grey[i] = Math.round((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3)

  // ── Phase 3: Gaussian blur + threshold ───────────────────────────────────
  updateLoadingPhase(`${pageLabel} — blur + threshold…`)
  await yieldToUI()
  const blurred = gaussianBlur(grey, width, height, 1.0)
  const threshold = otsuThreshold(blurred)

  const binary = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) binary[i] = blurred[i] < threshold ? 1 : 0

  const binaryClean = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) binaryClean[i] = grey[i] < threshold ? 1 : 0

  // ── Phase 4: Dilation → system boxes ─────────────────────────────────────
  updateLoadingPhase(`${pageLabel} — finding systems…`)
  await yieldToUI()
  // dilateRect uses prefix sums: O(W×H) instead of O(W×H×400) for 40×10 kernel
  const dilated = dilateRect(binary, width, height, 40, 10)
  const { labels, count } = labelComponents(dilated, width, height)
  const stats = getComponentStats(labels, count, width, height)
  const systemBoxes = stats
    .filter(b => b.boundingBox.w > width * 0.8)
    .map(b => b.boundingBox)

  // ── Phase 5: Staff line detection ────────────────────────────────────────
  updateLoadingPhase(`${pageLabel} — detecting staff lines…`)
  await yieldToUI()
  const minPct = 0.8
  const rawStaffRows = new Set<number>()
  for (let y = 0; y < height; y++) {
    let maxRun = 0, run = 0
    for (let x = 0; x < width; x++) {
      if (binaryClean[y * width + x] === 1) { run++; if (run > maxRun) maxRun = run }
      else run = 0
    }
    if (maxRun > width * minPct) rawStaffRows.add(y)
  }

  const staffLineBoxes: { r: number; c: number; w: number; h: number }[] = []
  let groupStart = -1
  for (let y = 0; y <= height; y++) {
    const here = rawStaffRows.has(y), prev = rawStaffRows.has(y - 1)
    if (here && !prev) groupStart = y
    if (!here && prev && groupStart >= 0) {
      const h = y - groupStart
      if (h <= 4) {
        let minX = width, maxX = 0
        for (let yr = groupStart; yr < y; yr++)
          for (let x = 0; x < width; x++)
            if (binaryClean[yr * width + x] === 1) { if (x < minX) minX = x; if (x > maxX) maxX = x }
        if (maxX >= minX) staffLineBoxes.push({ r: groupStart, c: minX, w: maxX - minX + 1, h })
      }
      groupStart = -1
    }
  }

  const staffLines = staffLineBoxes.filter(b => b.w > width * minPct).sort((a, b) => a.r - b.r)

  // ── Phase 6: Staff removal ────────────────────────────────────────────────
  updateLoadingPhase(`${pageLabel} — removing staff lines…`)
  await yieldToUI()
  const staffRemoved = new Uint8Array(binaryClean)
  const tolerance = 2
  for (const { r, c, w, h } of staffLines) {
    for (let x = c; x < c + w; x++) {
      let noteAbove = false
      for (let yr = r - 1; yr >= 0; yr--) {
        if (!binaryClean[yr * width + x]) break
        if (yr < r - tolerance) { noteAbove = true; break }
      }
      let noteBelow = false
      for (let yr = r + h; yr < height; yr++) {
        if (!binaryClean[yr * width + x]) break
        if (yr >= r + h + tolerance) { noteBelow = true; break }
      }
      if (!noteAbove && !noteBelow) {
        for (let yr = r; yr < r + h; yr++) staffRemoved[yr * width + x] = 0
      }
    }
  }

  // Compute S = median intra-staff gap
  const staffYs = staffLines.map(b => b.r)
  const staffGaps = staffYs.slice(1).map((y, i) => y - staffYs[i])
  const intraGaps = staffGaps.filter(g => g < 30).sort((a, b) => a - b)
  const S = intraGaps.length > 0 ? intraGaps[Math.floor(intraGaps.length / 2)] : 10

  // ── Phase 7: Render crops ─────────────────────────────────────────────────
  updateLoadingPhase(`${pageLabel} — rendering crops…`)
  await yieldToUI()

  const id = filename.replace(/\.pdf$/i, '') + '_p' + pageNum
  const crops: SystemCrop[] = systemBoxes.map((box, sysIdx) => {
    const { r, c, w, h } = box
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width  = w
    cropCanvas.height = h
    const cropCtx = cropCanvas.getContext('2d')!

    // Render staffRemoved for this crop
    const cropImg = new ImageData(w, h)
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const srcIdx = (r + row) * width + (c + col)
        const v = staffRemoved[srcIdx] === 1 ? 0 : 255
        const dstIdx = (row * w + col) * 4
        cropImg.data[dstIdx]     = v
        cropImg.data[dstIdx + 1] = v
        cropImg.data[dstIdx + 2] = v
        cropImg.data[dstIdx + 3] = 255
      }
    }
    cropCtx.putImageData(cropImg, 0, 0)

    // Render original full-colour crop
    const origCropCanvas = document.createElement('canvas')
    origCropCanvas.width  = w
    origCropCanvas.height = h
    const origCropCtx = origCropCanvas.getContext('2d')!
    const origCropImg = new ImageData(w, h)
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const srcIdx = ((r + row) * width + (c + col)) * 4
        const dstIdx = (row * w + col) * 4
        origCropImg.data[dstIdx]     = data[srcIdx]
        origCropImg.data[dstIdx + 1] = data[srcIdx + 1]
        origCropImg.data[dstIdx + 2] = data[srcIdx + 2]
        origCropImg.data[dstIdx + 3] = 255
      }
    }
    origCropCtx.putImageData(origCropImg, 0, 0)

    return { sheetId: id, sysIdx, r, c, w, h, canvas: cropCanvas, origCanvas: origCropCanvas, labels: [] }
  })

  return { id, filename, pageNum, width, height, staffRemoved, systemBoxes, staffLines, S, crops }
}

// ── Sheet list ────────────────────────────────────────────────────────────────

function addSheetToList(sheet: Sheet) {
  const item = document.createElement('div')
  item.className = 'sheet-item'
  item.dataset['sheetId'] = sheet.id

  const thumb = document.createElement('canvas')
  thumb.width  = 36
  thumb.height = 46
  // Render mini thumbnail of first crop if available
  if (sheet.crops.length > 0) {
    const ctx = thumb.getContext('2d')!
    const src = sheet.crops[0].canvas
    ctx.drawImage(src, 0, 0, 36, 46)
  }

  const label = document.createElement('span')
  label.textContent = `${sheet.filename} p${sheet.pageNum}`

  item.appendChild(thumb)
  item.appendChild(label)
  item.addEventListener('click', () => {
    const firstIdx = allCrops.findIndex(c => c.sheetId === sheet.id)
    if (firstIdx >= 0) showCrop(firstIdx)
  })
  sheetsList.appendChild(item)
}

function updateSheetListActive() {
  const crop = allCrops[currentCropIdx]
  if (!crop) return
  for (const el of sheetsList.querySelectorAll<HTMLDivElement>('.sheet-item')) {
    el.classList.toggle('active', el.dataset['sheetId'] === crop.sheetId)
  }
}

// ── Crop navigation ───────────────────────────────────────────────────────────

function navigateCrop(delta: number) {
  const next = currentCropIdx + delta
  if (next >= 0 && next < allCrops.length) showCrop(next)
}

function showCrop(idx: number) {
  currentCropIdx = idx
  selectedBoxId = null
  renderCurrentCrop()
  updateCropNav()
  updateSheetListActive()
  renderBoxesList()
}

function updateCropNav() {
  cropCounter.textContent = `${currentCropIdx + 1} / ${allCrops.length}`
  btnPrevCrop.disabled = currentCropIdx === 0
  btnNextCrop.disabled = currentCropIdx >= allCrops.length - 1

  const crop = allCrops[currentCropIdx]
  if (crop) {
    const sheet = sheets.find(s => s.id === crop.sheetId)
    cropSheetLabel.textContent = sheet ? `${sheet.filename} p${sheet.pageNum} sys${crop.sysIdx + 1}` : ''
  }
}

function renderCurrentCrop() {
  const crop = allCrops[currentCropIdx]
  if (!crop) return

  const w = Math.round(crop.canvas.width  * zoom)
  const h = Math.round(crop.canvas.height * zoom)

  baseCanvas.width    = w
  baseCanvas.height   = h
  overlayCanvas.width  = w
  overlayCanvas.height = h

  // Position overlay on top of base
  overlayCanvas.style.width  = w + 'px'
  overlayCanvas.style.height = h + 'px'

  const ctx = baseCanvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(crop.canvas, 0, 0, w, h)

  // Reference: original full-colour image below
  refCanvas.width  = w
  refCanvas.height = h
  const refCtx = refCanvas.getContext('2d')!
  refCtx.imageSmoothingEnabled = false
  refCtx.drawImage(crop.origCanvas, 0, 0, w, h)

  redrawOverlay()
}

// ── Overlay drawing ───────────────────────────────────────────────────────────

function redrawOverlay(previewRect?: { x: number; y: number; w: number; h: number }) {
  const crop = allCrops[currentCropIdx]
  if (!crop) return

  const ctx = overlayCanvas.getContext('2d')!
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)

  for (const box of crop.labels) {
    const cls = CLASSES[box.classId]
    const bx = box.x * zoom, by = box.y * zoom
    const bw = box.w * zoom, bh = box.h * zoom

    ctx.fillStyle = hexToRgba(cls.color, 0.18)
    ctx.fillRect(bx, by, bw, bh)

    if (box.id === selectedBoxId) {
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
    } else {
      ctx.strokeStyle = cls.color
      ctx.lineWidth = 1
    }
    ctx.strokeRect(bx, by, bw, bh)

    ctx.fillStyle = cls.color
    ctx.font = '10px monospace'
    ctx.fillText(cls.name, bx + 2, by + 10)
  }

  if (previewRect) {
    const cls = CLASSES[activeClassId]
    const { x, y, w, h } = previewRect
    const px = x * zoom, py = y * zoom, pw = w * zoom, ph = h * zoom
    ctx.fillStyle = hexToRgba(cls.color, 0.15)
    ctx.fillRect(px, py, pw, ph)
    ctx.strokeStyle = cls.color
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.strokeRect(px, py, pw, ph)
    ctx.setLineDash([])
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Mouse interaction ─────────────────────────────────────────────────────────

overlayCanvas.addEventListener('mousedown', e => {
  const { cx, cy } = canvasCoords(e)
  const crop = allCrops[currentCropIdx]
  if (!crop) return

  // Check if clicking inside an existing box
  const cropX = cx / zoom, cropY = cy / zoom
  let hit: LabelBox | undefined
  for (let i = crop.labels.length - 1; i >= 0; i--) {
    const b = crop.labels[i]
    if (cropX >= b.x && cropX <= b.x + b.w && cropY >= b.y && cropY <= b.y + b.h) {
      hit = b; break
    }
  }
  if (hit) {
    selectedBoxId = hit.id
    redrawOverlay()
    renderBoxesList()
    return
  }

  isDragging = true
  dragStartX = cropX
  dragStartY = cropY
  dragCurX   = cropX
  dragCurY   = cropY
})

overlayCanvas.addEventListener('mousemove', e => {
  if (!isDragging) return
  const { cx, cy } = canvasCoords(e)
  dragCurX = cx / zoom
  dragCurY = cy / zoom

  const rx = Math.min(dragStartX, dragCurX)
  const ry = Math.min(dragStartY, dragCurY)
  const rw = Math.abs(dragCurX - dragStartX)
  const rh = Math.abs(dragCurY - dragStartY)
  redrawOverlay({ x: rx, y: ry, w: rw, h: rh })
})

overlayCanvas.addEventListener('mouseup', e => {
  if (!isDragging) return
  isDragging = false

  const { cx, cy } = canvasCoords(e)
  dragCurX = cx / zoom
  dragCurY = cy / zoom

  const rx = Math.min(dragStartX, dragCurX)
  const ry = Math.min(dragStartY, dragCurY)
  const rw = Math.abs(dragCurX - dragStartX)
  const rh = Math.abs(dragCurY - dragStartY)

  if (rw > 4 && rh > 4) {
    const crop = allCrops[currentCropIdx]
    if (crop) {
      const box: LabelBox = {
        id: crypto.randomUUID(),
        classId: activeClassId,
        x: rx, y: ry, w: rw, h: rh,
      }
      crop.labels.push(box)
      selectedBoxId = box.id
      renderBoxesList()
    }
  }

  redrawOverlay()
})

overlayCanvas.addEventListener('mouseleave', () => {
  if (isDragging) {
    isDragging = false
    redrawOverlay()
  }
})

function canvasCoords(e: MouseEvent) {
  const rect = overlayCanvas.getBoundingClientRect()
  return { cx: e.clientX - rect.left, cy: e.clientY - rect.top }
}

// ── Boxes list panel ──────────────────────────────────────────────────────────

function renderBoxesList() {
  const crop = allCrops[currentCropIdx]
  boxesList.innerHTML = ''
  if (!crop) return

  for (const box of crop.labels) {
    const cls = CLASSES[box.classId]
    const item = document.createElement('div')
    item.className = 'box-item'
    if (box.id === selectedBoxId) item.classList.add('selected')

    const swatch = document.createElement('div')
    swatch.className = 'box-swatch'
    swatch.style.background = cls.color

    const lbl = document.createElement('span')
    lbl.textContent = cls.name

    item.appendChild(swatch)
    item.appendChild(lbl)
    item.addEventListener('click', () => {
      selectedBoxId = box.id
      redrawOverlay()
      renderBoxesList()
    })
    boxesList.appendChild(item)
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

function deleteSelected() {
  const crop = allCrops[currentCropIdx]
  if (!crop || !selectedBoxId) return
  crop.labels = crop.labels.filter(b => b.id !== selectedBoxId)
  selectedBoxId = null
  redrawOverlay()
  renderBoxesList()
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  // Ignore when typing in an input
  if ((e.target as HTMLElement).tagName === 'INPUT') return

  const key = e.key

  // Class selection by shortcut key (digits 1–9 and letters q w e r t y u i o p a s d f)
  if (!e.ctrlKey && !e.altKey && !e.metaKey) {
    const cls = CLASSES.find(c => c.key !== '' && c.key === key)
    if (cls) { setActiveClass(cls.id); return }
  }

  if (key === 'Delete' || key === 'Backspace') {
    deleteSelected()
    return
  }

  if (key === 'z' && e.ctrlKey) {
    // Remove last added box
    const crop = allCrops[currentCropIdx]
    if (crop && crop.labels.length > 0) {
      const removed = crop.labels.pop()!
      if (selectedBoxId === removed.id) selectedBoxId = null
      redrawOverlay()
      renderBoxesList()
    }
    return
  }

  if (key === 'Escape') {
    isDragging = false
    selectedBoxId = null
    redrawOverlay()
    renderBoxesList()
    return
  }

  if (key === 'ArrowLeft')  { navigateCrop(-1); return }
  if (key === 'ArrowRight') { navigateCrop(+1); return }

  if (key === '[') {
    // Prev sheet: find current sheet and jump to its first crop
    const crop = allCrops[currentCropIdx]
    if (!crop) return
    const sheetIdx = sheets.findIndex(s => s.id === crop.sheetId)
    if (sheetIdx > 0) {
      const prevSheet = sheets[sheetIdx - 1]
      const idx = allCrops.findIndex(c => c.sheetId === prevSheet.id)
      if (idx >= 0) showCrop(idx)
    }
    return
  }

  if (key === ']') {
    const crop = allCrops[currentCropIdx]
    if (!crop) return
    const sheetIdx = sheets.findIndex(s => s.id === crop.sheetId)
    if (sheetIdx < sheets.length - 1) {
      const nextSheet = sheets[sheetIdx + 1]
      const idx = allCrops.findIndex(c => c.sheetId === nextSheet.id)
      if (idx >= 0) showCrop(idx)
    }
    return
  }
})

// ── Load labels (COCO JSON resume) ───────────────────────────────────────────

async function onLoadLabels() {
  const file = labelsInputEl.files?.[0]
  if (!file) return
  const text = await file.text()
  let coco: any
  try { coco = JSON.parse(text) } catch { setStatus('Failed to parse JSON.'); return }

  let loaded = 0
  for (const img of (coco.images ?? [])) {
    // Match file_name like "sheetname_p1_sys1_clean.png" to SystemCrop
    const m = img.file_name.match(/^(.+)_sys(\d+)_clean\.png$/)
    if (!m) continue
    const sheetId = m[1], sysIdx = parseInt(m[2]) - 1
    const crop = allCrops.find(c => c.sheetId === sheetId && c.sysIdx === sysIdx)
    if (!crop) continue

    const annotations = (coco.annotations ?? []).filter((a: any) => a.image_id === img.id)
    crop.labels = annotations.map((a: any) => ({
      id: crypto.randomUUID(),
      classId: a.category_id,
      x: a.bbox[0], y: a.bbox[1], w: a.bbox[2], h: a.bbox[3],
    }))
    loaded += crop.labels.length
  }

  setStatus(`Loaded ${loaded} labels from ${file.name}.`)
  redrawOverlay()
  renderBoxesList()
}

// ── Export ────────────────────────────────────────────────────────────────────

async function onExportAll() {
  if (allCrops.length === 0) { setStatus('Nothing to export.'); return }

  let dirHandle: FileSystemDirectoryHandle
  try {
    dirHandle = await (window as any).showDirectoryPicker()
  } catch {
    setStatus('Export cancelled.')
    return
  }

  const imagesDir = await dirHandle.getDirectoryHandle('images', { create: true })
  const labelsDir = await dirHandle.getDirectoryHandle('labels', { create: true })

  const cocoImages: any[]      = []
  const cocoAnnotations: any[] = []
  let   imageId    = 1
  let   annotId    = 1

  const categories = CLASSES.map(c => ({ id: c.id, name: c.name, supercategory: 'symbol' }))

  for (const crop of allCrops) {
    const sheet = sheets.find(s => s.id === crop.sheetId)
    if (!sheet) continue

    const basename = `${crop.sheetId}_sys${crop.sysIdx + 1}`
    const w = crop.canvas.width, h = crop.canvas.height

    // ── Clean PNG ──
    const cleanPng = await canvasToBlob(crop.canvas)
    await writeBlobToDir(imagesDir, `${basename}_clean.png`, cleanPng)

    // ── Annotated PNG ──
    const annotCanvas = document.createElement('canvas')
    annotCanvas.width  = w
    annotCanvas.height = h
    const annotCtx = annotCanvas.getContext('2d')!
    annotCtx.drawImage(crop.canvas, 0, 0)
    for (const box of crop.labels) {
      const cls = CLASSES[box.classId]
      annotCtx.fillStyle = hexToRgba(cls.color, 0.25)
      annotCtx.fillRect(box.x, box.y, box.w, box.h)
      annotCtx.strokeStyle = cls.color
      annotCtx.lineWidth = 1
      annotCtx.strokeRect(box.x, box.y, box.w, box.h)
      annotCtx.fillStyle = cls.color
      annotCtx.font = '9px monospace'
      annotCtx.fillText(cls.name, box.x + 2, box.y + 9)
    }
    const annotPng = await canvasToBlob(annotCanvas)
    await writeBlobToDir(imagesDir, `${basename}_annotated.png`, annotPng)

    // ── YOLO .txt ──
    let yoloTxt = ''
    for (const box of crop.labels) {
      const cx = (box.x + box.w / 2) / w
      const cy = (box.y + box.h / 2) / h
      const bw = box.w / w
      const bh = box.h / h
      yoloTxt += `${box.classId} ${cx.toFixed(6)} ${cy.toFixed(6)} ${bw.toFixed(6)} ${bh.toFixed(6)}\n`
    }
    await writeTextToDir(labelsDir, `${basename}.txt`, yoloTxt)

    // ── COCO accumulation ──
    cocoImages.push({ id: imageId, file_name: `${basename}_clean.png`, width: w, height: h })
    for (const box of crop.labels) {
      cocoAnnotations.push({
        id: annotId++,
        image_id: imageId,
        category_id: box.classId,
        bbox: [Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h)],
        area: Math.round(box.w * box.h),
        iscrowd: 0,
      })
    }

    // ── Per-crop metadata ──
    const now = new Date().toISOString()
    const meta = [
      `source_pdf:    ${sheet.filename}`,
      `page:          ${sheet.pageNum}`,
      `render_scale:  1.5`,
      `page_width:    ${sheet.width}`,
      `page_height:   ${sheet.height}`,
      `crop_x:        ${crop.c}`,
      `crop_y:        ${crop.r}`,
      `crop_width:    ${crop.w}`,
      `crop_height:   ${crop.h}`,
      `system_index:  ${crop.sysIdx + 1}`,
      `staff_lines:   ${JSON.stringify(sheet.staffLines.map(l => [l.r, l.c, l.w, l.h]))}`,
      `label_count:   ${crop.labels.length}`,
      `exported:      ${now}`,
    ].join('\n')
    await writeTextToDir(dirHandle, `${basename}_meta.txt`, meta)

    imageId++
  }

  // ── COCO annotations.json ──
  const coco = {
    info: { description: 'Sheet music labels', date_created: new Date().toISOString() },
    images: cocoImages,
    annotations: cocoAnnotations,
    categories,
  }
  await writeTextToDir(dirHandle, 'annotations.json', JSON.stringify(coco, null, 2))

  setStatus(`Exported ${allCrops.length} crops to directory.`)
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
}

async function writeBlobToDir(dir: FileSystemDirectoryHandle, name: string, blob: Blob) {
  const fh = await dir.getFileHandle(name, { create: true })
  const ws = await fh.createWritable()
  await ws.write(blob)
  await ws.close()
}

async function writeTextToDir(dir: FileSystemDirectoryHandle, name: string, text: string) {
  const fh = await dir.getFileHandle(name, { create: true })
  const ws = await fh.createWritable()
  await ws.write(text)
  await ws.close()
}

// ── Status / loading helpers ──────────────────────────────────────────────────

const loadingOverlay = document.getElementById('loading-overlay')!
const loadingMsg     = document.getElementById('loading-msg')!
const loadingPhase   = document.getElementById('loading-phase')!

function setStatus(msg: string) {
  statusEl.textContent = msg
}

function showLoading(msg: string, phase = '') {
  loadingMsg.textContent   = msg
  loadingPhase.textContent = phase
  loadingOverlay.classList.remove('hidden')
}

function updateLoadingPhase(phase: string) {
  loadingPhase.textContent = phase
}

function hideLoading() {
  loadingOverlay.classList.add('hidden')
}

/** Yield control back to the browser for a frame so the UI can repaint. */
function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

// ── Pure image processing functions (copied from pdf-test.ts) ─────────────────

function gaussianBlur(grey: Uint8Array, width: number, height: number, sigma: number): Uint8Array {
  const radius = Math.ceil(sigma * 3)
  const size   = 2 * radius + 1
  const kernel = new Float32Array(size)
  let sum = 0
  for (let i = 0; i < size; i++) {
    const x = i - radius
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma))
    sum += kernel[i]
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum

  const tmp = new Float32Array(width * height)
  const out = new Uint8Array(width * height)

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let acc = 0, wsum = 0
      for (let k = -radius; k <= radius; k++) {
        const nc = Math.min(Math.max(c + k, 0), width - 1)
        const w  = kernel[k + radius]
        acc  += grey[r * width + nc] * w
        wsum += w
      }
      tmp[r * width + c] = acc / wsum
    }
  }

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let acc = 0, wsum = 0
      for (let k = -radius; k <= radius; k++) {
        const nr = Math.min(Math.max(r + k, 0), height - 1)
        const w  = kernel[k + radius]
        acc  += tmp[nr * width + c] * w
        wsum += w
      }
      out[r * width + c] = Math.round(acc / wsum)
    }
  }
  return out
}

function otsuThreshold(grey: Uint8Array): number {
  const hist = new Float32Array(256)
  for (let i = 0; i < grey.length; i++) hist[grey[i]]++
  const n = grey.length

  let bestT = 0, bestVar = 0
  let w0 = 0, sum0 = 0
  const totalSum = hist.reduce((s, v, i) => s + v * i, 0)
  let w1 = n, sum1 = totalSum

  for (let t = 0; t < 256; t++) {
    w0 += hist[t];  sum0 += t * hist[t]
    w1 -= hist[t];  sum1 -= t * hist[t]
    if (w0 === 0 || w1 === 0) continue
    const m0 = sum0 / w0, m1 = sum1 / w1
    const variance = (w0 * w1 * (m0 - m1) ** 2) / (n * n)
    if (variance > bestVar) { bestVar = variance; bestT = t }
  }
  return bestT
}

/**
 * Fast rectangular morphological dilation using prefix sums.
 * O(W*H) regardless of kernel size — replaces the O(W*H*kw*kh) general dilate
 * for the 40×10 system-detection pass.
 */
function dilateRect(binary: Uint8Array, width: number, height: number, kw: number, kh: number): Uint8Array {
  const halfW = Math.floor(kw / 2)
  const halfH = Math.floor(kh / 2)

  // Horizontal pass
  const tmp = new Uint8Array(width * height)
  for (let r = 0; r < height; r++) {
    const prefix = new Int32Array(width + 1)
    for (let c = 0; c < width; c++)
      prefix[c + 1] = prefix[c] + binary[r * width + c]
    for (let c = 0; c < width; c++) {
      const lo = Math.max(0, c - halfW)
      const hi = Math.min(width, c + halfW + 1)
      tmp[r * width + c] = prefix[hi] - prefix[lo] > 0 ? 1 : 0
    }
  }

  // Vertical pass
  const out = new Uint8Array(width * height)
  for (let c = 0; c < width; c++) {
    const prefix = new Int32Array(height + 1)
    for (let r = 0; r < height; r++)
      prefix[r + 1] = prefix[r] + tmp[r * width + c]
    for (let r = 0; r < height; r++) {
      const lo = Math.max(0, r - halfH)
      const hi = Math.min(height, r + halfH + 1)
      out[r * width + c] = prefix[hi] - prefix[lo] > 0 ? 1 : 0
    }
  }

  return out
}

function labelComponents(src: Uint8Array, width: number, height: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(width * height)
  const stack  = new Int32Array(width * height)
  let nextLabel = 1

  for (let startR = 0; startR < height; startR++) {
    for (let startC = 0; startC < width; startC++) {
      if (!src[startR * width + startC] || labels[startR * width + startC]) continue
      const label = nextLabel++
      let top = 0
      stack[top++] = startR * width + startC
      while (top > 0) {
        const idx = stack[--top]
        if (labels[idx] || !src[idx]) continue
        labels[idx] = label
        const r = Math.floor(idx / width), c = idx % width
        if (r > 0)          stack[top++] = idx - width
        if (r < height - 1) stack[top++] = idx + width
        if (c > 0)          stack[top++] = idx - 1
        if (c < width - 1)  stack[top++] = idx + 1
      }
    }
  }
  return { labels, count: nextLabel - 1 }
}

function getComponentStats(labels: Int32Array, count: number, width: number, height: number) {
  const stats = Array.from({ length: count }, () => ({
    minR: Infinity, maxR: -Infinity,
    minC: Infinity, maxC: -Infinity,
    area: 0,
  }))
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const label = labels[r * width + c]
      if (!label) continue
      const b = stats[label - 1]
      if (r < b.minR) b.minR = r
      if (r > b.maxR) b.maxR = r
      if (c < b.minC) b.minC = c
      if (c > b.maxC) b.maxC = c
      b.area++
    }
  }
  return stats.map((s, i) => ({
    label: i + 1,
    area: s.area,
    boundingBox: { r: s.minR, c: s.minC, h: s.maxR - s.minR + 1, w: s.maxC - s.minC + 1 },
    aspectRatio: (s.maxC - s.minC + 1) / (s.maxR - s.minR + 1),
    fillDensity:  s.area / ((s.maxR - s.minR + 1) * (s.maxC - s.minC + 1)),
  }))
}
