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
  // ── Numeric time signatures ──────────────────────────────────────────────────
  {
    id: 28, name: 'time_2_4', color: '#ff9966', key: 'j',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="14" y="13" text-anchor="middle" font-size="11" font-family="serif" fill="#ff9966">2</text>
      <text x="14" y="25" text-anchor="middle" font-size="11" font-family="serif" fill="#ff9966">4</text>
    </svg>`,
  },
  {
    id: 29, name: 'time_3_4', color: '#ffbb44', key: 'k',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="14" y="13" text-anchor="middle" font-size="11" font-family="serif" fill="#ffbb44">3</text>
      <text x="14" y="25" text-anchor="middle" font-size="11" font-family="serif" fill="#ffbb44">4</text>
    </svg>`,
  },
  {
    id: 30, name: 'time_4_4', color: '#ffe066', key: 'l',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="14" y="13" text-anchor="middle" font-size="11" font-family="serif" fill="#ffe066">4</text>
      <text x="14" y="25" text-anchor="middle" font-size="11" font-family="serif" fill="#ffe066">4</text>
    </svg>`,
  },
  {
    id: 31, name: 'time_2_2', color: '#99ff99', key: 'z',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="14" y="13" text-anchor="middle" font-size="11" font-family="serif" fill="#99ff99">2</text>
      <text x="14" y="25" text-anchor="middle" font-size="11" font-family="serif" fill="#99ff99">2</text>
    </svg>`,
  },
  {
    id: 32, name: 'time_3_8', color: '#66ffcc', key: 'x',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="14" y="13" text-anchor="middle" font-size="11" font-family="serif" fill="#66ffcc">3</text>
      <text x="14" y="25" text-anchor="middle" font-size="11" font-family="serif" fill="#66ffcc">8</text>
    </svg>`,
  },
  {
    id: 33, name: 'time_6_8', color: '#44ddff', key: 'c',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="14" y="13" text-anchor="middle" font-size="11" font-family="serif" fill="#44ddff">6</text>
      <text x="14" y="25" text-anchor="middle" font-size="11" font-family="serif" fill="#44ddff">8</text>
    </svg>`,
  },
  {
    id: 34, name: 'time_9_8', color: '#66aaff', key: 'v',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="14" y="13" text-anchor="middle" font-size="11" font-family="serif" fill="#66aaff">9</text>
      <text x="14" y="25" text-anchor="middle" font-size="11" font-family="serif" fill="#66aaff">8</text>
    </svg>`,
  },
  {
    id: 35, name: 'time_12_8', color: '#aa88ff', key: 'b',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="14" y="13" text-anchor="middle" font-size="9" font-family="serif" fill="#aa88ff">12</text>
      <text x="14" y="25" text-anchor="middle" font-size="11" font-family="serif" fill="#aa88ff">8</text>
    </svg>`,
  },
  // ── Sustain pedal ────────────────────────────────────────────────────────────
  {
    id: 36, name: 'pedal_mark', color: '#88ccff', key: 'n',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="14" y="21" text-anchor="middle" font-size="10" font-family="serif" font-style="italic" fill="#88ccff">Ped</text>
    </svg>`,
  },
  {
    id: 37, name: 'pedal_release', color: '#aaddff', key: '',
    svg: `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <text x="14" y="22" text-anchor="middle" font-size="18" fill="#aaddff">✱</text>
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
  done: boolean
}

interface Sheet {
  id: string
  filename: string
  songName: string       // parent folder name ('' when uploaded individually)
  midiFilename: string   // MIDI filename found alongside the PDF ('' if none)
  pageNum: number
  width: number; height: number
  staffRemoved: Uint8Array
  systemBoxes: { r: number; c: number; w: number; h: number }[]
  staffLines:  { r: number; c: number; w: number; h: number }[]
  S: number
  crops: SystemCrop[]
  // Detection diagnostics
  threshold: number       // Otsu threshold (0–255)
  widthPctUsed: number    // width filter that found systems (0 = full-page fallback)
  rawSystemCount: number  // boxes found before fallback
  // Full-res greyscale kept for threshold tweaking (re-run phases 3–7)
  fullGrey: Uint8Array
  // Debug pixel data stored at 25% scale for on-demand rendering
  dbgW: number; dbgH: number
  dbgGrey:    Uint8Array
  dbgBinary:  Uint8Array
  dbgDilated: Uint8Array
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const btnSelectFolder = document.getElementById('btn-select-folder') as HTMLButtonElement
const btnUpload     = document.getElementById('btn-upload')      as HTMLButtonElement
const pdfInputEl    = document.getElementById('pdf-input')       as HTMLInputElement
const btnLoadLabels = document.getElementById('btn-load-labels') as HTMLButtonElement
const labelsInputEl = document.getElementById('labels-input')    as HTMLInputElement
const btnExport        = document.getElementById('btn-export')         as HTMLButtonElement
const btnSaveProgress  = document.getElementById('btn-save-progress')  as HTMLButtonElement
const btnLoadProgress  = document.getElementById('btn-load-progress')  as HTMLButtonElement
// progressInputEl kept for potential fallback use
const _progressInputEl = document.getElementById('progress-input')     as HTMLInputElement
void _progressInputEl
const progressSummary  = document.getElementById('progress-summary')   as HTMLSpanElement
const markDoneBtn      = document.getElementById('mark-done-btn')      as HTMLButtonElement
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
let progressDirHandle: FileSystemDirectoryHandle | null = null

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
    <span class="class-count"></span>
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

btnSelectFolder.addEventListener('click', onSelectFolder)

btnUpload.addEventListener('click', () => pdfInputEl.click())
pdfInputEl.addEventListener('change', onPdfFilesSelected)

btnLoadLabels.addEventListener('click', () => labelsInputEl.click())
labelsInputEl.addEventListener('change', onLoadLabels)

btnSaveProgress.addEventListener('click', () => saveProgress())
btnLoadProgress.addEventListener('click', onLoadProgress)

markDoneBtn.addEventListener('click', toggleDone)

// ── Left-panel resize ─────────────────────────────────────────────────────────
;(() => {
  const leftPanel  = document.getElementById('left-panel')!
  const handle     = document.getElementById('left-resize')!
  let dragging = false, startX = 0, startW = 0
  handle.addEventListener('mousedown', e => {
    dragging = true; startX = e.clientX; startW = leftPanel.offsetWidth
    handle.classList.add('dragging')
    e.preventDefault()
  })
  window.addEventListener('mousemove', e => {
    if (!dragging) return
    const w = Math.max(120, Math.min(520, startW + e.clientX - startX))
    leftPanel.style.width = `${w}px`
  })
  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    handle.classList.remove('dragging')
  })
})()

btnExport.addEventListener('click', onExportAll)

zoomSlider.addEventListener('input', () => {
  zoom = parseInt(zoomSlider.value) / 100
  zoomValEl.textContent = `${zoomSlider.value}%`
  renderCurrentCrop()
})

btnPrevCrop.addEventListener('click', () => navigateCrop(-1))
btnNextCrop.addEventListener('click', () => navigateCrop(+1))

delSelectedBtn.addEventListener('click', deleteSelected)

// ── Folder scan ───────────────────────────────────────────────────────────────

interface SongEntry {
  name: string
  pdfFiles: File[]
  midiFilename: string   // first .mid/.midi found, '' if none
}

async function onSelectFolder() {
  if (!(window as any).showDirectoryPicker) {
    alert('Your browser does not support the File System Access API.\nUse Chrome or Edge, and make sure the page is served over HTTPS.')
    return
  }

  let dirHandle: FileSystemDirectoryHandle
  try {
    dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
  } catch (err: any) {
    if (err?.name === 'AbortError') return  // user cancelled
    setStatus(`Could not open folder picker: ${err?.message ?? err}`)
    console.error('showDirectoryPicker failed:', err)
    return
  }
  progressDirHandle = dirHandle  // reuse for auto-save

  showLoading('Scanning folder…', 'looking for songs…')
  await yieldToUI()

  try {
    // ── Scan ────────────────────────────────────────────────────────────────
    // Collect root-level PDFs as a single "unnamed" song entry.
    // Each sub-folder is treated as one song.
    const songs: SongEntry[] = []
    const rootSong: SongEntry = { name: '', pdfFiles: [], midiFilename: '' }

    for await (const [name, handle] of (dirHandle as any).entries()) {
      const lower = (name as string).toLowerCase()
      if (handle.kind === 'file') {
        if (lower.endsWith('.pdf')) rootSong.pdfFiles.push(await handle.getFile())
        else if ((lower.endsWith('.mid') || lower.endsWith('.midi')) && !rootSong.midiFilename)
          rootSong.midiFilename = name as string
      } else if (handle.kind === 'directory') {
        const song: SongEntry = { name: name as string, pdfFiles: [], midiFilename: '' }
        for await (const [fname, fhandle] of handle.entries()) {
          if (fhandle.kind !== 'file') continue
          const fl = (fname as string).toLowerCase()
          if (fl.endsWith('.pdf')) song.pdfFiles.push(await fhandle.getFile())
          else if ((fl.endsWith('.mid') || fl.endsWith('.midi')) && !song.midiFilename)
            song.midiFilename = fname as string
        }
        if (song.pdfFiles.length > 0) {
          song.pdfFiles.sort((a, b) => a.name.localeCompare(b.name))
          songs.push(song)
        }
      }
    }

    if (rootSong.pdfFiles.length > 0) {
      rootSong.pdfFiles.sort((a, b) => a.name.localeCompare(b.name))
      songs.unshift(rootSong)
    }

    songs.sort((a, b) => a.name.localeCompare(b.name))

    if (songs.length === 0) {
      hideLoading()
      setStatus('No PDFs found in the selected folder or its sub-folders.')
      return
    }

    const totalPdfs = songs.reduce((s, g) => s + g.pdfFiles.length, 0)
    const totalMidi = songs.filter(g => g.midiFilename).length
    setStatus(`Found ${songs.length} song(s), ${totalPdfs} PDF(s), ${totalMidi} MIDI(s).`)

    // ── Reset ────────────────────────────────────────────────────────────────
    sheets = []
    allCrops = []
    currentCropIdx = 0
    sheetsList.innerHTML = ''
    _lastSongHeader = ''

    // ── Process ──────────────────────────────────────────────────────────────
    let pagesDone = 0
    // Pre-count pages (load each PDF once, keep pdf objects to reuse)
    type PdfEntry = { song: SongEntry; file: File; pdf: any; numPages: number }
    const pdfEntries: PdfEntry[] = []
    for (const song of songs) {
      for (const file of song.pdfFiles) {
        updateLoadingPhase(`loading ${file.name}…`)
        await yieldToUI()
        const buf = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise
        pdfEntries.push({ song, file, pdf, numPages: (pdf as any).numPages })
      }
    }
    const totalPages = pdfEntries.reduce((s, e) => s + e.numPages, 0)

    for (const { song, file, pdf, numPages } of pdfEntries) {
      for (let p = 1; p <= numPages; p++) {
        pagesDone++
        showLoading(`Processing page ${pagesDone} / ${totalPages}`, `${song.name || file.name} — page ${p}`)
        await yieldToUI()
        const sheet = await processPage(pdf, file.name, p, '', song.name, song.midiFilename)
        sheets.push(sheet)
        allCrops.push(...sheet.crops)
        addSheetToList(sheet)
      }
    }

    hideLoading()
    updateProgressSummary()
    const songCount = songs.filter(s => s.name).length
    setStatus(`${songCount || totalPdfs} song(s) · ${sheets.length} pages · ${allCrops.length} crops.`)
    if (allCrops.length > 0) showCrop(0)

    await saveProgress(dirHandle)
  } catch (err) {
    hideLoading()
    setStatus(`Error scanning folder: ${(err as Error).message}`)
    console.error('onSelectFolder error:', err)
  }
}

// ── PDF processing ────────────────────────────────────────────────────────────

async function onPdfFilesSelected() {
  const files = Array.from(pdfInputEl.files ?? [])
  if (!files.length) return
  sheets = []
  allCrops = []
  currentCropIdx = 0
  sheetsList.innerHTML = ''
  _lastSongHeader = ''

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
  updateProgressSummary()
  setStatus(`${sheets.length} page(s) loaded, ${allCrops.length} system crops.`)
  if (allCrops.length > 0) showCrop(0)
}

async function processPage(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  filename: string,
  pageNum: number,
  pageLabel: string,
  songName = '',
  midiFilename = ''
): Promise<Sheet> {
  // ── Phase 1: PDF render ───────────────────────────────────────────────────
  updateLoadingPhase(`${pageLabel} — rendering PDF…`)
  const page = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale: 1.5 })
  const width  = Math.round(viewport.width)
  const height = Math.round(viewport.height)

  const offscreen = document.createElement('canvas')
  offscreen.width  = width
  offscreen.height = height
  const ctx = offscreen.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, offscreen.width, offscreen.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData

  // ── Phase 2: Greyscale ────────────────────────────────────────────────────
  updateLoadingPhase(`${pageLabel} — greyscale…`)
  await yieldToUI()
  const grey = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++)
    grey[i] = Math.round((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3)
  const fullGrey = grey  // keep reference for threshold tweaking

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

  // Try progressively looser width thresholds until we find something.
  // Some PDFs have narrower staves (landscape, wide margins, multi-column).
  let systemBoxes: { r: number; c: number; w: number; h: number }[] = []
  let widthPctUsed = 0
  for (const pct of [0.8, 0.6, 0.4]) {
    systemBoxes = stats.filter(b => b.boundingBox.w > width * pct).map(b => b.boundingBox)
    if (systemBoxes.length > 0) { widthPctUsed = pct; break }
  }
  const rawSystemCount = systemBoxes.length
  // Last resort: treat the whole page as one crop
  if (systemBoxes.length === 0) {
    console.warn(`processPage: no system boxes found for ${filename} p${pageNum} (threshold=${threshold}) — using full page`)
    systemBoxes = [{ r: 0, c: 0, w: width, h: height }]
  }

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

  // ── Phase 6b: Subsample debug data at 25% scale ───────────────────────────
  updateLoadingPhase(`${pageLabel} — building debug data…`)
  await yieldToUI()
  const dbgScale = 0.25
  const dbgW = Math.max(1, Math.round(width  * dbgScale))
  const dbgH = Math.max(1, Math.round(height * dbgScale))
  const dbgGrey    = new Uint8Array(dbgW * dbgH)
  const dbgBinary  = new Uint8Array(dbgW * dbgH)
  const dbgDilated = new Uint8Array(dbgW * dbgH)
  for (let dy = 0; dy < dbgH; dy++) {
    const sy = Math.round(dy / dbgScale)
    for (let dx = 0; dx < dbgW; dx++) {
      const sx  = Math.round(dx / dbgScale)
      const idx = sy * width + sx
      dbgGrey[dy * dbgW + dx]    = grey[idx]
      dbgBinary[dy * dbgW + dx]  = binaryClean[idx]
      dbgDilated[dy * dbgW + dx] = dilated[idx]
    }
  }

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

    return { sheetId: id, sysIdx, r, c, w, h, canvas: cropCanvas, origCanvas: origCropCanvas, labels: [], done: false }
  })

  return { id, filename, songName, midiFilename, pageNum, width, height, staffRemoved, systemBoxes, staffLines, S, crops, threshold, widthPctUsed, rawSystemCount, fullGrey, dbgW, dbgH, dbgGrey, dbgBinary, dbgDilated }
}

// ── Sheet list ────────────────────────────────────────────────────────────────

// Track the last song name so we know when to insert a new header
let _lastSongHeader = ''

function addSheetToList(sheet: Sheet) {
  // Insert a song name header whenever the song changes
  if (sheet.songName && sheet.songName !== _lastSongHeader) {
    _lastSongHeader = sheet.songName
    const header = document.createElement('div')
    header.className = 'song-header'
    header.dataset['songName'] = sheet.songName
    header.textContent = sheet.songName
    if (sheet.midiFilename) {
      const midiTag = document.createElement('span')
      midiTag.className = 'song-midi'
      midiTag.textContent = '♪ midi'
      header.appendChild(midiTag)
    }
    sheetsList.appendChild(header)
  }

  const item = document.createElement('div')
  item.className = 'sheet-item'
  item.dataset['sheetId'] = sheet.id

  // Warning badge if detection fell back (widthPctUsed=0 means full-page fallback)
  const isFallback = sheet.widthPctUsed === 0
  const isLoose    = sheet.widthPctUsed > 0 && sheet.widthPctUsed < 0.8

  const thumb = document.createElement('canvas')
  thumb.width  = 36
  thumb.height = 46
  if (sheet.crops.length > 0) {
    const ctx = thumb.getContext('2d')!
    ctx.drawImage(sheet.crops[0].canvas, 0, 0, 36, 46)
    if (isFallback) {
      ctx.fillStyle = 'rgba(255,80,80,0.25)'
      ctx.fillRect(0, 0, 36, 46)
    } else if (isLoose) {
      ctx.fillStyle = 'rgba(255,180,0,0.2)'
      ctx.fillRect(0, 0, 36, 46)
    }
  }

  const label = document.createElement('span')
  label.textContent = sheet.songName
    ? `p${sheet.pageNum} · ${sheet.filename}`
    : `${sheet.filename} p${sheet.pageNum}`

  const prog = document.createElement('span')
  prog.className = 'sheet-prog'
  prog.dataset['sheetId'] = sheet.id
  updateSheetProgEl(prog, sheet)

  // Debug button — always visible, coloured by detection quality
  const dbgBtn = document.createElement('button')
  dbgBtn.className = 'sheet-dbg-btn' + (isFallback ? ' warn' : isLoose ? ' loose' : '')
  dbgBtn.textContent = isFallback ? '⚠' : isLoose ? '?' : '…'
  dbgBtn.title = isFallback ? 'Detection failed — click to debug' : isLoose ? 'Loose detection — click to debug' : 'Click to inspect pipeline'
  dbgBtn.addEventListener('click', e => { e.stopPropagation(); showDebugModal(sheet) })

  item.appendChild(thumb)
  item.appendChild(label)
  item.appendChild(prog)
  item.appendChild(dbgBtn)
  item.addEventListener('click', () => {
    const firstIdx = allCrops.findIndex(c => c.sheetId === sheet.id)
    if (firstIdx >= 0) showCrop(firstIdx)
  })
  sheetsList.appendChild(item)
}

function updateSheetProgEl(el: HTMLSpanElement, sheet: Sheet) {
  const done  = sheet.crops.filter(c => c.done).length
  const total = sheet.crops.length
  el.textContent = `${done}/${total}`
  el.classList.toggle('complete', done === total && total > 0)
}

function updateSheetProgress(sheetId: string) {
  const sheet = sheets.find(s => s.id === sheetId)
  if (!sheet) return
  const el = sheetsList.querySelector<HTMLSpanElement>(`.sheet-prog[data-sheet-id="${sheetId}"]`)
  if (el) updateSheetProgEl(el, sheet)
}

function updateSheetProgressAll() {
  for (const sheet of sheets) updateSheetProgress(sheet.id)
}

function updateSheetListActive() {
  const crop = allCrops[currentCropIdx]
  if (!crop) return
  for (const el of sheetsList.querySelectorAll<HTMLDivElement>('.sheet-item')) {
    el.classList.toggle('active', el.dataset['sheetId'] === crop.sheetId)
  }
}

// ── Debug modal ───────────────────────────────────────────────────────────────

const debugModal        = document.getElementById('debug-modal')!
const debugTitle        = document.getElementById('debug-title')!
const debugStats        = document.getElementById('debug-stats')!
const debugCanvas       = document.getElementById('debug-canvas') as HTMLCanvasElement
const debugThreshRow    = document.getElementById('debug-thresh-row')!
const debugThreshSlider = document.getElementById('debug-thresh-slider') as HTMLInputElement
const debugThreshVal    = document.getElementById('debug-thresh-val')!
const debugThreshApply  = document.getElementById('debug-thresh-apply') as HTMLButtonElement
const debugThreshStatus = document.getElementById('debug-thresh-status')!

let _debugSheet: Sheet | null = null   // sheet currently shown in debug modal

document.getElementById('debug-close')!.addEventListener('click', () => {
  debugModal.classList.add('hidden')
})
debugModal.addEventListener('click', e => {
  if (e.target === debugModal) debugModal.classList.add('hidden')
})
debugThreshSlider.addEventListener('input', () => {
  debugThreshVal.textContent = debugThreshSlider.value
})
debugThreshApply.addEventListener('click', async () => {
  if (!_debugSheet) return
  const t = parseInt(debugThreshSlider.value)
  debugThreshApply.disabled = true
  debugThreshStatus.textContent = 'running…'
  await reprocessSheetThreshold(_debugSheet, t)
  debugThreshStatus.textContent = `applied (${t})`
  debugThreshApply.disabled = false
  // Refresh debug view with updated sheet data
  await showDebugModal(_debugSheet)
})

async function reprocessSheetThreshold(sheet: Sheet, newThreshold: number) {
  const { fullGrey: grey, width, height } = sheet
  if (!grey.length) return

  await yieldToUI()

  // Phase 3: re-binarize with new threshold (skip blur — use raw grey for speed)
  const binary      = new Uint8Array(width * height)
  const binaryClean = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    binary[i]      = grey[i] < newThreshold ? 1 : 0
    binaryClean[i] = grey[i] < newThreshold ? 1 : 0
  }
  await yieldToUI()

  // Phase 4: dilation → system boxes
  const dilated = dilateRect(binary, width, height, 40, 10)
  const { labels, count } = labelComponents(dilated, width, height)
  const stats = getComponentStats(labels, count, width, height)
  await yieldToUI()

  let systemBoxes: { r: number; c: number; w: number; h: number }[] = []
  let widthPctUsed = 0
  for (const pct of [0.8, 0.6, 0.4]) {
    systemBoxes = stats.filter(b => b.boundingBox.w > width * pct).map(b => b.boundingBox)
    if (systemBoxes.length > 0) { widthPctUsed = pct; break }
  }
  const rawSystemCount = systemBoxes.length
  if (systemBoxes.length === 0) systemBoxes = [{ r: 0, c: 0, w: width, h: height }]

  // Phase 5: staff line detection
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
  await yieldToUI()

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

  // Phase 6: staff removal
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
      if (!noteAbove && !noteBelow)
        for (let yr = r; yr < r + h; yr++) staffRemoved[yr * width + x] = 0
    }
  }
  await yieldToUI()

  const staffYs   = staffLines.map(b => b.r)
  const staffGaps = staffYs.slice(1).map((y, i) => y - staffYs[i])
  const intraGaps = staffGaps.filter(g => g < 30).sort((a, b) => a - b)
  const S = intraGaps.length > 0 ? intraGaps[Math.floor(intraGaps.length / 2)] : 10

  // Phase 6b: rebuild debug arrays at 25% scale
  const dbgScale = 0.25
  const dbgW = Math.max(1, Math.round(width * dbgScale))
  const dbgH = Math.max(1, Math.round(height * dbgScale))
  const dbgGrey    = new Uint8Array(dbgW * dbgH)
  const dbgBinary  = new Uint8Array(dbgW * dbgH)
  const dbgDilated = new Uint8Array(dbgW * dbgH)
  for (let dy = 0; dy < dbgH; dy++) {
    const sy = Math.round(dy / dbgScale)
    for (let dx = 0; dx < dbgW; dx++) {
      const sx = Math.round(dx / dbgScale)
      const i  = sy * width + sx
      dbgGrey[dy * dbgW + dx]    = grey[i]
      dbgBinary[dy * dbgW + dx]  = binaryClean[i]
      dbgDilated[dy * dbgW + dx] = dilated[i]
    }
  }

  // Phase 7: re-render crop canvases (preserve existing labels + done state)
  const newCrops: SystemCrop[] = systemBoxes.map((box, sysIdx) => {
    const { r, c, w, h } = box
    const existing = sheet.crops.find(cr => cr.sysIdx === sysIdx)

    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = w; cropCanvas.height = h
    const cropImg = new ImageData(w, h)
    for (let row = 0; row < h; row++)
      for (let col = 0; col < w; col++) {
        const v = staffRemoved[(r + row) * width + (c + col)] === 1 ? 0 : 255
        const d = (row * w + col) * 4
        cropImg.data[d] = cropImg.data[d+1] = cropImg.data[d+2] = v; cropImg.data[d+3] = 255
      }
    cropCanvas.getContext('2d')!.putImageData(cropImg, 0, 0)

    const origCanvas = existing?.origCanvas ?? cropCanvas
    return {
      sheetId: sheet.id, sysIdx,
      r, c, w, h,
      canvas:     cropCanvas,
      origCanvas: origCanvas,
      labels: existing?.labels ?? [],
      done:   existing?.done   ?? false,
    }
  })
  await yieldToUI()

  // Mutate sheet in-place so all references stay valid
  sheet.threshold     = newThreshold
  sheet.widthPctUsed  = widthPctUsed
  sheet.rawSystemCount= rawSystemCount
  sheet.staffLines    = staffLines
  sheet.staffRemoved  = staffRemoved
  sheet.systemBoxes   = systemBoxes
  sheet.S             = S
  sheet.dbgW = dbgW; sheet.dbgH = dbgH
  sheet.dbgGrey    = dbgGrey
  sheet.dbgBinary  = dbgBinary
  sheet.dbgDilated = dbgDilated

  // Sync allCrops: remove old crops for this sheet, insert new ones at same position
  const firstIdx = allCrops.findIndex(c => c.sheetId === sheet.id)
  const oldCount = sheet.crops.length
  sheet.crops = newCrops
  if (firstIdx >= 0) allCrops.splice(firstIdx, oldCount, ...newCrops)
  else allCrops.push(...newCrops)

  // Update sheet thumbnail in sidebar
  const item = sheetsList.querySelector<HTMLDivElement>(`.sheet-item[data-sheet-id="${sheet.id}"]`)
  if (item) {
    const thumb = item.querySelector('canvas')
    if (thumb && newCrops.length > 0) {
      const tc = thumb.getContext('2d')!
      tc.clearRect(0, 0, 36, 46)
      tc.drawImage(newCrops[0].canvas, 0, 0, 36, 46)
    }
  }

  // Re-render if currently viewing this sheet
  if (allCrops[currentCropIdx]?.sheetId === sheet.id) renderCurrentCrop()
  updateProgressSummary()
  updateSheetProgress(sheet.id)
}

async function showDebugModal(sheet: Sheet, keepThreshSlider = false) {
  const fallback  = sheet.widthPctUsed === 0
  const fromCache = sheet.widthPctUsed === -1
  const detection = fromCache
    ? 'loaded from cache — no pipeline data'
    : fallback
    ? 'FULL-PAGE FALLBACK (no systems detected at any width)'
    : `${Math.round(sheet.widthPctUsed * 100)}% width filter → ${sheet.rawSystemCount} system(s)`

  _debugSheet = sheet
  debugTitle.textContent = `${sheet.filename}  p${sheet.pageNum}`
  debugStats.textContent = [
    `Page size    : ${sheet.width} × ${sheet.height} px  (render scale 1.5)`,
    `Otsu thresh  : ${fromCache ? '—' : sheet.threshold}  (healthy range: 100–200; white page = too high, black page = too low)`,
    `Detection    : ${detection}`,
    `Staff lines  : ${sheet.staffLines.length}`,
    `Crops        : ${sheet.crops.length}`,
    fallback
      ? '\n⚠  No systems found. Binary image is likely all-white or all-black — check step 2 below.'
      : fromCache
      ? '\n(Pipeline steps not available for cache-loaded sheets — reload from PDF to see steps.)'
      : sheet.widthPctUsed < 0.8
      ? '\n⚠  Loose width filter used — staves may be narrower than expected.'
      : '',
  ].join('\n').trimEnd()

  // Show/hide threshold controls depending on whether we have full-res grey data
  const hasGrey = sheet.fullGrey.length > 0
  debugThreshRow.classList.toggle('hidden', !hasGrey)
  if (hasGrey && !keepThreshSlider) {
    debugThreshSlider.value  = String(sheet.threshold)
    debugThreshVal.textContent = String(sheet.threshold)
    debugThreshStatus.textContent = ''
  }

  // Show modal immediately with stats — render steps asynchronously below
  debugCanvas.width  = 1
  debugCanvas.height = 1
  debugModal.classList.remove('hidden')
  await yieldToUI()

  if (fromCache || sheet.dbgW === 0) return   // no pixel data available

  // ── Build 4-step composite: [Original] [Binary] [Dilated] [Staff-removed+boxes] ──

  const W = sheet.dbgW
  const H = sheet.dbgH
  const PAD  = 8   // gap between panels
  const LABEL_H = 18

  // Step canvases at debug resolution
  const steps: { label: string; draw: (ctx: CanvasRenderingContext2D) => void }[] = [
    {
      label: '1. Original (first crop)',
      draw: ctx => {
        if (sheet.crops.length > 0) {
          ctx.drawImage(sheet.crops[0].origCanvas, 0, LABEL_H, W, H)
        } else {
          ctx.fillStyle = '#333'
          ctx.fillRect(0, LABEL_H, W, H)
          ctx.fillStyle = '#888'
          ctx.fillText('no crop', 4, LABEL_H + H / 2)
        }
      },
    },
    {
      label: '2. Greyscale',
      draw: ctx => {
        const img = new ImageData(W, H)
        for (let i = 0; i < W * H; i++) {
          const v = sheet.dbgGrey[i]
          img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = v
          img.data[i*4+3] = 255
        }
        ctx.putImageData(img, 0, LABEL_H)
      },
    },
    {
      label: `3. Binary (thresh=${sheet.threshold})`,
      draw: ctx => {
        const img = new ImageData(W, H)
        for (let i = 0; i < W * H; i++) {
          const v = sheet.dbgBinary[i] === 1 ? 0 : 255
          img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = v
          img.data[i*4+3] = 255
        }
        ctx.putImageData(img, 0, LABEL_H)
      },
    },
    {
      label: '4. Dilated blobs',
      draw: ctx => {
        const img = new ImageData(W, H)
        for (let i = 0; i < W * H; i++) {
          const v = sheet.dbgDilated[i] === 1 ? 0 : 255
          img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = v
          img.data[i*4+3] = 255
        }
        ctx.putImageData(img, 0, LABEL_H)
      },
    },
    {
      label: '5. Staff-removed + system boxes',
      draw: ctx => {
        const dbgScale = W / sheet.width
        const img = new ImageData(sheet.width, sheet.height)
        for (let i = 0; i < sheet.width * sheet.height; i++) {
          const v = sheet.staffRemoved[i] === 1 ? 0 : 255
          img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = v; img.data[i*4+3] = 255
        }
        const tmp = document.createElement('canvas')
        tmp.width = sheet.width; tmp.height = sheet.height
        tmp.getContext('2d')!.putImageData(img, 0, 0)
        ctx.drawImage(tmp, 0, LABEL_H, W, H)

        const colours = ['#f55','#5af','#5f5','#fa0','#c5f','#0dd']
        ctx.lineWidth = 1.5
        sheet.systemBoxes.forEach((b, idx) => {
          ctx.strokeStyle = colours[idx % colours.length]
          ctx.fillStyle   = colours[idx % colours.length] + '33'
          ctx.fillRect  (b.c*dbgScale, LABEL_H + b.r*dbgScale, b.w*dbgScale, b.h*dbgScale)
          ctx.strokeRect(b.c*dbgScale, LABEL_H + b.r*dbgScale, b.w*dbgScale, b.h*dbgScale)
        })
        ctx.strokeStyle = 'rgba(255,220,0,0.7)'
        ctx.lineWidth = 0.5
        for (const sl of sheet.staffLines) {
          const y = LABEL_H + (sl.r + sl.h/2) * dbgScale
          ctx.beginPath()
          ctx.moveTo(sl.c * dbgScale, y)
          ctx.lineTo((sl.c + sl.w) * dbgScale, y)
          ctx.stroke()
        }
      },
    },
  ]

  // Layout: steps side by side horizontally, wrapping at max ~1200px
  const COLS  = Math.min(steps.length, 3)
  const ROWS  = Math.ceil(steps.length / COLS)
  const cellW = W + PAD
  const cellH = H + LABEL_H + PAD
  debugCanvas.width  = COLS * cellW - PAD
  debugCanvas.height = ROWS * cellH - PAD
  const ctx = debugCanvas.getContext('2d')!
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, debugCanvas.width, debugCanvas.height)
  ctx.font = '11px monospace'

  for (let si = 0; si < steps.length; si++) {
    const col = si % COLS
    const row = Math.floor(si / COLS)
    const ox  = col * cellW
    const oy  = row * cellH

    // Step content drawn into offscreen then blitted
    const off = document.createElement('canvas')
    off.width  = W
    off.height = H + LABEL_H
    const offCtx = off.getContext('2d')!
    offCtx.fillStyle = '#222'
    offCtx.fillRect(0, 0, W, H + LABEL_H)
    steps[si].draw(offCtx)
    ctx.drawImage(off, ox, oy)

    // Label drawn after blit so it isn't overwritten
    ctx.fillStyle = '#ccc'
    ctx.font = '11px monospace'
    ctx.fillText(steps[si].label, ox + 4, oy + 13)

    await yieldToUI()   // yield between steps — keeps UI responsive
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
  updateDoneButton()
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
  updateClassCounts()
  updateProgressSummary()
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

  if (key === 'm') { toggleDone(); return }
})

// ── Done / progress ───────────────────────────────────────────────────────────

function toggleDone() {
  const crop = allCrops[currentCropIdx]
  if (!crop) return
  crop.done = !crop.done
  updateDoneButton()
  updateSheetProgress(crop.sheetId)
  updateProgressSummary()
  // Auto-advance to next undone crop when marking done
  if (crop.done) {
    const next = allCrops.findIndex((c, i) => i > currentCropIdx && !c.done)
    if (next >= 0) showCrop(next)
  }
}

function updateDoneButton() {
  const crop = allCrops[currentCropIdx]
  markDoneBtn.disabled = !crop
  if (!crop) { markDoneBtn.textContent = '✓ Done'; markDoneBtn.classList.remove('done'); return }
  markDoneBtn.classList.toggle('done', crop.done)
  markDoneBtn.textContent = crop.done ? '✓ Done' : '○ Mark done'
}

function updateClassCounts() {
  const counts = new Array(CLASSES.length).fill(0)
  for (const crop of allCrops)
    for (const box of crop.labels)
      if (box.classId >= 0 && box.classId < counts.length) counts[box.classId]++

  for (const btn of classListEl.querySelectorAll<HTMLButtonElement>('.class-btn')) {
    const id = Number(btn.dataset['classId'])
    const badge = btn.querySelector<HTMLSpanElement>('.class-count')
    if (badge) badge.textContent = counts[id] > 0 ? String(counts[id]) : ''
  }
}

function updateProgressSummary() {
  if (allCrops.length === 0) { progressSummary.innerHTML = ''; return }
  const done  = allCrops.filter(c => c.done).length
  const total = allCrops.length
  const totalLabels = allCrops.reduce((s, c) => s + c.labels.length, 0)
  progressSummary.innerHTML =
    `<b>${done}/${total}</b> done &nbsp;·&nbsp; <b>${totalLabels}</b> labels`
}

// ── Save / load progress ──────────────────────────────────────────────────────

async function saveProgress(dirH?: FileSystemDirectoryHandle) {
  if (allCrops.length === 0) { setStatus('Nothing to save.'); return }

  // Resolve save directory
  if (!dirH) {
    if (progressDirHandle) {
      dirH = progressDirHandle
    } else {
      if (!(window as any).showDirectoryPicker) {
        setStatus('File System Access API not supported — use Chrome or Edge.')
        return
      }
      try {
        dirH = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
        progressDirHandle = dirH ?? null
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        setStatus(`Could not open save folder: ${err?.message ?? err}`)
        return
      }
    }
  }

  showLoading('Saving progress…', 'writing images…')
  await yieldToUI()

  try {
    // crops/ subdirectory for PNGs
    const cropsDir = await (dirH as any).getDirectoryHandle('crops', { create: true })

    let saved = 0
    for (const crop of allCrops) {
      const base = `${crop.sheetId}_s${crop.sysIdx}`
      await writePngToDir(cropsDir, `${base}_clean.png`, crop.canvas)
      await writePngToDir(cropsDir, `${base}_orig.png`, crop.origCanvas)
      saved++
      if (saved % 10 === 0) {
        updateLoadingPhase(`${saved} / ${allCrops.length} crops…`)
        await yieldToUI()
      }
    }

    // Build catalogue
    const songMap = new Map<string, { name: string; midiFilename: string; sheetIds: string[] }>()
    for (const sheet of sheets) {
      const key = sheet.songName || sheet.filename
      if (!songMap.has(key))
        songMap.set(key, { name: sheet.songName || sheet.filename, midiFilename: sheet.midiFilename, sheetIds: [] })
      songMap.get(key)!.sheetIds.push(sheet.id)
    }

    const data = {
      version: 3,
      savedAt: new Date().toISOString(),
      catalogue: Array.from(songMap.values()).map(song => ({
        name:         song.name,
        midiFilename: song.midiFilename,
        sheets: sheets
          .filter(s => song.sheetIds.includes(s.id))
          .map(s => ({ sheetId: s.id, filename: s.filename, pageNum: s.pageNum,
                       width: s.width, height: s.height, songName: s.songName })),
      })),
      crops: allCrops.map(crop => ({
        sheetId: crop.sheetId,
        sysIdx:  crop.sysIdx,
        r: crop.r, c: crop.c, w: crop.w, h: crop.h,
        done:    crop.done,
        labels:  crop.labels.map(b => ({ classId: b.classId, x: b.x, y: b.y, w: b.w, h: b.h })),
      })),
    }

    updateLoadingPhase('writing progress.json…')
    await yieldToUI()
    const jsonFH = await (dirH as any).getFileHandle('progress.json', { create: true })
    const writable = await (jsonFH as any).createWritable()
    await writable.write(JSON.stringify(data, null, 2))
    await writable.close()

    hideLoading()
    setStatus(`Saved: ${allCrops.length} crops + progress.json → ${(dirH as any).name}/`)
  } catch (err) {
    hideLoading()
    setStatus(`Save error: ${(err as Error).message}`)
    console.error('saveProgress error:', err)
  }
}

async function writePngToDir(dir: FileSystemDirectoryHandle, filename: string, canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
  const fh = await (dir as any).getFileHandle(filename, { create: true })
  const w = await (fh as any).createWritable()
  await w.write(blob)
  await w.close()
}

async function onLoadProgress() {
  if (!(window as any).showDirectoryPicker) {
    setStatus('File System Access API not supported — use Chrome or Edge.')
    return
  }

  let dirH: FileSystemDirectoryHandle
  try {
    dirH = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
  } catch (err: any) {
    if (err?.name === 'AbortError') return
    setStatus(`Could not open folder: ${err?.message ?? err}`)
    return
  }

  showLoading('Loading progress…', 'reading progress.json…')
  await yieldToUI()

  try {
    // Read progress.json
    let data: any
    try {
      const jfh  = await (dirH as any).getFileHandle('progress.json')
      const jf   = await jfh.getFile()
      data = JSON.parse(await jf.text())
    } catch {
      hideLoading()
      setStatus('No progress.json found in the selected folder.')
      return
    }

    if (!data.catalogue || !data.crops) {
      hideLoading()
      setStatus('progress.json is missing catalogue or crops data.')
      return
    }

    // Open crops/ subdir
    let cropsDir: FileSystemDirectoryHandle
    try {
      cropsDir = await (dirH as any).getDirectoryHandle('crops')
    } catch {
      hideLoading()
      setStatus('No crops/ folder found alongside progress.json.')
      return
    }

    // Reset state
    sheets = []
    allCrops = []
    currentCropIdx = 0
    sheetsList.innerHTML = ''
    _lastSongHeader = ''
    progressDirHandle = dirH  // allow re-saving to same dir

    // Build Sheet stubs from catalogue
    const sheetMap = new Map<string, Sheet>()
    for (const songEntry of data.catalogue) {
      for (const se of songEntry.sheets) {
        const sheet: Sheet = {
          id:           se.sheetId,
          filename:     se.filename,
          songName:     songEntry.name ?? se.songName ?? '',
          midiFilename: songEntry.midiFilename ?? '',
          pageNum:      se.pageNum,
          width:        se.width  ?? 0,
          height:       se.height ?? 0,
          staffRemoved:    new Uint8Array(0),
          systemBoxes:     [],
          staffLines:      [],
          S:               0,
          crops:           [],
          threshold:       0,
          widthPctUsed:    -1,
          rawSystemCount:  0,
          fullGrey:        new Uint8Array(0),
          dbgW: 0, dbgH: 0,
          dbgGrey:    new Uint8Array(0),
          dbgBinary:  new Uint8Array(0),
          dbgDilated: new Uint8Array(0),
        }
        sheetMap.set(se.sheetId, sheet)
        sheets.push(sheet)
      }
    }

    // Load each crop image + labels
    const cropEntries: any[] = data.crops ?? []
    let loaded = 0
    for (let i = 0; i < cropEntries.length; i++) {
      const entry = cropEntries[i]
      const sheet = sheetMap.get(entry.sheetId)
      if (!sheet) continue

      if (i % 5 === 0) {
        updateLoadingPhase(`crop ${i + 1} / ${cropEntries.length}…`)
        await yieldToUI()
      }

      const base   = `${entry.sheetId}_s${entry.sysIdx}`
      const clean  = await loadPngFromDir(cropsDir, `${base}_clean.png`)
      if (!clean) continue                              // image missing — skip
      const orig = await loadPngFromDir(cropsDir, `${base}_orig.png`) ?? clean

      const crop: SystemCrop = {
        sheetId:    entry.sheetId,
        sysIdx:     entry.sysIdx,
        r: entry.r ?? 0, c: entry.c ?? 0,
        w: entry.w ?? clean.width, h: entry.h ?? clean.height,
        canvas:     clean,
        origCanvas: orig,
        labels: (entry.labels ?? []).map((l: any) => ({
          id: crypto.randomUUID(),
          classId: l.classId, x: l.x, y: l.y, w: l.w, h: l.h,
        })),
        done: entry.done ?? false,
      }
      sheet.crops.push(crop)
      allCrops.push(crop)
      loaded++
    }

    // Populate sheets list (only sheets that actually loaded)
    for (const sheet of sheets) {
      if (sheet.crops.length > 0) addSheetToList(sheet)
    }

    hideLoading()
    updateClassCounts()
    updateProgressSummary()
    updateSheetProgressAll()
    if (allCrops.length > 0) showCrop(0)
    setStatus(`Loaded: ${loaded} crops across ${sheets.filter(s => s.crops.length > 0).length} sheets.`)
  } catch (err) {
    hideLoading()
    setStatus(`Load error: ${(err as Error).message}`)
    console.error('onLoadProgress error:', err)
  }
}

async function loadPngFromDir(dir: FileSystemDirectoryHandle, filename: string): Promise<HTMLCanvasElement | null> {
  try {
    const fh   = await (dir as any).getFileHandle(filename)
    const file = await fh.getFile()
    const url  = URL.createObjectURL(file)
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        const c = document.createElement('canvas')
        c.width  = img.naturalWidth
        c.height = img.naturalHeight
        c.getContext('2d')!.drawImage(img, 0, 0)
        resolve(c)
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Failed to load ${filename}`)) }
      img.src = url
    })
  } catch {
    return null
  }
}

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

  updateClassCounts()
  updateProgressSummary()
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
// MessageChannel.postMessage is not throttled when the window is minimized,
// unlike setTimeout(0) which Chrome clamps to ~1s in background tabs.
const _yieldChannel = new MessageChannel()
function yieldToUI(): Promise<void> {
  return new Promise(resolve => {
    _yieldChannel.port1.onmessage = () => resolve()
    _yieldChannel.port2.postMessage(null)
  })
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
