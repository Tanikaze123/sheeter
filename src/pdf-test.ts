/**
 * pdf-test.ts
 *
 * Standalone test page for PDF measure detection.
 * Shows each stage of the pipeline side by side with live slider controls.
 *
 * Pipeline:
 *   1. Original — raw PDF render
 *   2. Dilated  — morphological dilation to thicken ink strokes
 *   3. Staff lines — rows above the black-pixel threshold highlighted (on dilated data)
 *   4. Systems — staff lines grouped into systems (coloured bands)
 *   5. Measures — final bounding boxes overlaid on the original
 */

import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// ── DOM refs ──────────────────────────────────────────────────────────────────

const pdfInput = document.getElementById('pdf-input') as HTMLInputElement
const pageInput = document.getElementById('page-input') as HTMLInputElement
const gaussSigma     = document.getElementById('gauss-sigma')          as HTMLInputElement
const gaussSigmaDisp = document.getElementById('gauss-sigma-display')   as HTMLSpanElement
const otsuDisplay    = document.getElementById('otsu-display')           as HTMLSpanElement
const useOtsu        = document.getElementById('use-otsu')               as HTMLInputElement
const blackThreshold = document.getElementById('black-threshold')        as HTMLInputElement
const blackDisplay   = document.getElementById('black-threshold-display') as HTMLSpanElement
const minLineWidth = document.getElementById('min-line-width') as HTMLInputElement
const minLineDisplay = document.getElementById('min-line-width-display') as HTMLSpanElement
const collapseGap = document.getElementById('collapse-gap') as HTMLInputElement
const collapseDisplay = document.getElementById('collapse-gap-display') as HTMLSpanElement
const dilateRadius = document.getElementById('dilate-radius') as HTMLInputElement
const dilateDisplay = document.getElementById('dilate-radius-display') as HTMLSpanElement
const kernelType = document.getElementById('kernel-type') as HTMLSelectElement
const zoomInput = document.getElementById('zoom') as HTMLInputElement
const zoomDisplay = document.getElementById('zoom-display') as HTMLSpanElement
const logEl = document.getElementById('log') as HTMLDivElement

const canvasOriginal = document.getElementById('canvas-original') as HTMLCanvasElement
const canvasBinary = document.getElementById('canvas-binary') as HTMLCanvasElement
const canvasDilated = document.getElementById('canvas-dilated') as HTMLCanvasElement
const canvasBoxes = document.getElementById('canvas-boxes') as HTMLCanvasElement
const canvasStaff = document.getElementById('canvas-stafflines') as HTMLCanvasElement
const canvasEroded = document.getElementById('canvas-eroded') as HTMLCanvasElement
const canvasRestored = document.getElementById('canvas-restored') as HTMLCanvasElement
const canvasEclipse = document.getElementById('canvas-eclipse') as HTMLCanvasElement
const canvasStaffRemoved    = document.getElementById('canvas-staff-removed')    as HTMLCanvasElement
const canvasNotesDetected   = document.getElementById('canvas-notes-detected')   as HTMLCanvasElement
const canvasNotesAnim       = document.getElementById('canvas-notes-anim')       as HTMLCanvasElement
const btnAnimReset          = document.getElementById('btn-anim-reset')          as HTMLButtonElement
const btnAnimStep           = document.getElementById('btn-anim-step')           as HTMLButtonElement
const btnAnimPlay           = document.getElementById('btn-anim-play')           as HTMLButtonElement
const animStatusEl          = document.getElementById('anim-status')             as HTMLSpanElement
const animSpeedInput        = document.getElementById('anim-speed')              as HTMLInputElement
const animSpeedDisplay      = document.getElementById('anim-speed-display')      as HTMLSpanElement
const canvasVoteRestored = document.getElementById('canvas-vote-restored') as HTMLCanvasElement
const canvasVoteEclipse = document.getElementById('canvas-vote-eclipse') as HTMLCanvasElement
const erodeKernelType     = document.getElementById('erode-kernel-type')        as HTMLSelectElement
const restoreKernelType   = document.getElementById('restore-kernel-type')      as HTMLSelectElement
const eclipseKernelType   = document.getElementById('eclipse-kernel-type')      as HTMLSelectElement
const enableEclipseDetect = document.getElementById('enable-eclipse-detection') as HTMLInputElement
const midiInput      = document.getElementById('midi-input')      as HTMLInputElement
const midiStatus     = document.getElementById('midi-status')     as HTMLSpanElement
const canvasMidiDiff = document.getElementById('canvas-midi-diff') as HTMLCanvasElement
const midiThumbs     = document.getElementById('midi-thumbnails') as HTMLDivElement
const midiMissedEl   = document.getElementById('midi-missed')     as HTMLDivElement
const voteStride          = document.getElementById('vote-stride')              as HTMLInputElement
const voteStrideDisp      = document.getElementById('vote-stride-display')      as HTMLSpanElement
const showDots = document.getElementById('show-dots') as HTMLInputElement
const showArrows = document.getElementById('show-arrows') as HTMLInputElement
const showCenters = document.getElementById('show-centers') as HTMLInputElement
const showEllipses = document.getElementById('show-ellipses') as HTMLInputElement


// ── State ─────────────────────────────────────────────────────────────────────

let currentImageData: ImageData | null = null
let pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>>['promise'] | null = null

// ── Module-level pipeline state (used by MIDI cross-check) ───────────────────
type ConfirmedBox = { kind: 'confirm_note' | 'confirm_flag'; r: number; c: number; w: number; h: number }
let currentStaffLines: { r: number; c: number; w: number; h: number }[] = []
let currentConfirmedBoxes: ConfirmedBox[] = []
let currentWidth    = 0
let currentHeight   = 0
let currentS        = 0
let currentStaffRemoved: Uint8Array | null = null
let currentSystemBoxes: { r: number; c: number; w: number; h: number }[] = []
let midiNotes: { pitch: number; timeMs: number }[] = []
// probe pixels recorded during buildAnimFrames: {xc, yAbove, yBelow, hitAbove, hitBelow}
type ProbeRecord = { xc: number; yAbove: number; yBelow: number; hitAbove: boolean; hitBelow: boolean }
let currentProbeRecords: ProbeRecord[] = []

// ── Animation state ───────────────────────────────────────────────────────────
type AnimFrame =
  | { kind: 'row_start';    y: number; c: number; w: number }
  | { kind: 'scan';         r: number; c: number; w: number; h: number }
  | { kind: 'scan_hit';     r: number; c: number; w: number; h: number }
  | { kind: 'confirm_note'; r: number; c: number; w: number; h: number }
  | { kind: 'confirm_flag'; r: number; c: number; w: number; h: number }

let animFrames:      AnimFrame[]  = []
let animStep                      = 0
let animStaffRemoved: Uint8Array | null = null
let animInterval:    number | null = null

function log(msg: string) {
  logEl.textContent = msg
}

// ── PDF loading ───────────────────────────────────────────────────────────────

pdfInput.addEventListener('change', async () => {
  const file = pdfInput.files?.[0]
  if (!file) return
  log('Loading PDF…')
  const arrayBuffer = await file.arrayBuffer()
  pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise as any
  pageInput.max = String((pdf as any).numPages)
  log(`Loaded ${(pdf as any).numPages} page(s). Rendering page 1…`)
  await renderPage(1)
})

pageInput.addEventListener('change', async () => {
  if (!pdf) return
  await renderPage(parseInt(pageInput.value))
})

midiInput.addEventListener('change', async () => {
  const file = midiInput.files?.[0]
  if (!file) return
  midiStatus.textContent = 'Parsing…'
  const buf = await file.arrayBuffer()
  midiNotes = parseMidi(new Uint8Array(buf))
  midiStatus.textContent = `${midiNotes.length} notes`
  renderMidiCrossCheck()
})

async function renderPage(pageNum: number) {
  if (!pdf) return
  const page = await (pdf as any).getPage(pageNum)
  const viewport = page.getViewport({ scale: 1.5 })

  for (const canvas of [canvasOriginal, canvasBinary, canvasDilated, canvasBoxes, canvasStaff, canvasStaffRemoved, canvasNotesDetected, canvasNotesAnim, canvasEroded, canvasRestored, canvasEclipse, canvasVoteRestored, canvasVoteEclipse]) {
    canvas.width = viewport.width
    canvas.height = viewport.height
  }

  const ctx = canvasOriginal.getContext('2d')!
  await page.render({ canvasContext: ctx, viewport }).promise
  currentImageData = ctx.getImageData(0, 0, canvasOriginal.width, canvasOriginal.height)

  log(`Page ${pageNum} rendered (${viewport.width}×${viewport.height}px). Running detection…`)
  runPipeline()
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

function runPipeline() {
  if (!currentImageData) return

  const minPct  = parseInt(minLineWidth.value) / 100
  const radius   = parseInt(dilateRadius.value)
  const sigma    = parseInt(gaussSigma.value) / 10   // slider 0–30 → sigma 0.0–3.0

  const { data, width, height } = currentImageData

  // Copy original onto derived canvases as base
  for (const canvas of [canvasBoxes, canvasStaff]) {
    canvas.getContext('2d')!.putImageData(currentImageData, 0, 0)
  }

  // ── Stage 2: greyscale → Gaussian blur → threshold (Otsu or manual) ──────

  // Greyscale
  const grey = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    grey[i] = Math.round((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3)
  }

  // Gaussian blur
  const blurred = sigma > 0 ? gaussianBlur(grey, width, height, sigma) : grey

  // Threshold
  const computedOtsu = otsuThreshold(blurred)
  const threshold = useOtsu.checked ? computedOtsu : parseInt(blackThreshold.value)
  otsuDisplay.textContent = String(computedOtsu)
  gaussSigmaDisp.textContent = sigma.toFixed(1)

  // Binarise: 1 = ink, 0 = paper
  const binary = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) binary[i] = blurred[i] < threshold ? 1 : 0

  // Clean binary from raw grayscale (no blur) — used for staff line detection/removal
  const binaryClean = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) binaryClean[i] = grey[i] < threshold ? 1 : 0

  const binaryImgData = new ImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    const v = binary[i] === 1 ? 0 : 255
    binaryImgData.data[i * 4]     = v
    binaryImgData.data[i * 4 + 1] = v
    binaryImgData.data[i * 4 + 2] = v
    binaryImgData.data[i * 4 + 3] = 255
  }
  canvasBinary.getContext('2d')!.putImageData(binaryImgData, 0, 0)

  // Morphological dilation — Dream-Flower uses 40×10 MORPH_RECT to group systems
  const kernel = makeKernel(kernelType.value as 'cross' | 'square' | 'horizontal' | 'vertical', 40, 10)
  const dilated = dilate(binary, width, height, kernel)

  // Render dilated binary to canvasDilated
  const dilatedImgData = new ImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    const v = dilated[i] === 1 ? 0 : 255
    dilatedImgData.data[i * 4] = v
    dilatedImgData.data[i * 4 + 1] = v
    dilatedImgData.data[i * 4 + 2] = v
    dilatedImgData.data[i * 4 + 3] = 255
  }
  canvasDilated.getContext('2d')!.putImageData(dilatedImgData, 0, 0)

  // find treble + bass sections
  // Finds boundary of dialated image
  const { labels, count } = labelComponents(dilated, width, height)
  const trackGroupBoxes = getComponentStats(labels, count, width, height)
  const filteredBoundaryBoxes = trackGroupBoxes.filter(b => b.boundingBox.w > width * minPct)

  // ── Stage 3: render connected-component bounding boxes ───────────────────
  const ctxBoxes = canvasBoxes.getContext('2d')!
  ctxBoxes.strokeStyle = 'rgba(255, 100, 0, 0.8)'
  ctxBoxes.lineWidth = 1
  for (const box of filteredBoundaryBoxes) {
    ctxBoxes.strokeRect(box.boundingBox.c, box.boundingBox.r, box.boundingBox.w, box.boundingBox.h)
  }
  log(`Stage 3: ${filteredBoundaryBoxes.length} components found`)

  // ── Stage 4: staff line detection (Dream-Flower approach) ────────────────
  const maxStaffLineHeight = 4  // discard any candidate thicker than this
  // Find each row's longest continuous black run; flag rows where run > minPct of width
  const rawStaffRows = new Set<number>()
  for (let y = 0; y < height; y++) {
    let maxRun = 0, run = 0
    for (let x = 0; x < width; x++) {
      if (binaryClean[y * width + x] === 1) { run++; if (run > maxRun) maxRun = run }
      else run = 0
    }
    if (maxRun > width * minPct) rawStaffRows.add(y)
  }

  // Group consecutive candidate rows → bounding boxes, filter thickness ≤ 4px
  type LineBox = { r: number; c: number; w: number; h: number }
  const staffLineBoxes: LineBox[] = []
  let groupStart = -1
  for (let y = 0; y <= height; y++) {
    const here = rawStaffRows.has(y), prev = rawStaffRows.has(y - 1)
    if (here && !prev) groupStart = y
    if (!here && prev && groupStart >= 0) {
      const h = y - groupStart
      if (h <= maxStaffLineHeight) {
        let minX = width, maxX = 0
        for (let yr = groupStart; yr < y; yr++)
          for (let x = 0; x < width; x++)
            if (binaryClean[yr * width + x] === 1) { if (x < minX) minX = x; if (x > maxX) maxX = x }
        if (maxX >= minX) staffLineBoxes.push({ r: groupStart, c: minX, w: maxX - minX + 1, h })
      }
      groupStart = -1
    }
  }

  // Filter: width > minPct of page (same as Dream-Flower's 80% contour filter)
  const staffLines = staffLineBoxes.filter(b => b.w > width * minPct).sort((a, b) => a.r - b.r)
  currentStaffLines = staffLines

  // Compute S = median gap between adjacent staff lines (ignore large system gaps)
  const staffYs = staffLines.map(b => b.r)
  const staffGaps = staffYs.slice(1).map((y, i) => y - staffYs[i])
  const intraGaps = staffGaps.filter(g => g < 30).sort((a, b) => a - b)
  const S = intraGaps.length > 0 ? intraGaps[Math.floor(intraGaps.length / 2)] : 10

  // Draw detected staff line bounding boxes
  const ctxStaff = canvasStaff.getContext('2d')!
  ctxStaff.strokeStyle = 'rgba(255, 50, 50, 0.8)'
  ctxStaff.lineWidth = 1
  for (const { r, c, w, h } of staffLines) ctxStaff.strokeRect(c, r, w, h)

  log(`Stage 4: ${staffLines.length} staff lines found (expect multiple of 10)`)

  // ── Stage 6: column-wise staff line removal ───────────────────────────────
  // For each detected staff line, scan every column in its extent.
  // If the pixel immediately above AND below the line are both white → pure staff
  // line segment, erase it. If either neighbor is ink → a note crosses here, keep.
  const staffRemoved = new Uint8Array(binaryClean)
  const tolerance = 2  // pixels to search outside boundary before calling it a note
  for (const { r, c, w, h } of staffLines) {
    for (let x = c; x < c + w; x++) {
      // Trace upward from boundary top through connected black pixels.
      // If we travel more than `tolerance` pixels outside the boundary → note crossing.
      let noteAbove = false
      for (let yr = r - 1; yr >= 0; yr--) {
        if (!binaryClean[yr * width + x]) break      // hit white, stop — no note
        if (yr < r - tolerance) { noteAbove = true; break }  // still black too far out
      }

      // Trace downward from boundary bottom the same way.
      let noteBelow = false
      for (let yr = r + h; yr < height; yr++) {
        if (!binaryClean[yr * width + x]) break
        if (yr >= r + h + tolerance) { noteBelow = true; break }
      }

      // Only erase if neither side found a note
      if (!noteAbove && !noteBelow) {
        for (let yr = r; yr < r + h; yr++) staffRemoved[yr * width + x] = 0
      }
    }
  }
  renderBinary(staffRemoved, canvasStaffRemoved, width, height)
  const ctxRemoved = canvasStaffRemoved.getContext('2d')!
  ctxRemoved.strokeStyle = 'rgba(255, 50, 50, 0.8)'
  ctxRemoved.lineWidth = 1
  for (const { r, c, w, h } of staffLines) ctxRemoved.strokeRect(c, r, w, h)

  // ── SR2 + SR3: row-scan detection ────────────────────────────────────────
  const systemBoxes = filteredBoundaryBoxes.map(b => b.boundingBox)
  animStaffRemoved  = staffRemoved
  animFrames = buildAnimFrames(staffRemoved, width, height, S, staffLines, systemBoxes)
  animStep   = 0

  // SR2: show all confirmed results at once (same data as SR3, no animation)
  renderSR2Final(canvasNotesDetected, width, height)

  // SR3: animated playback (unchanged)
  renderAnimFrame()

  // Store state for MIDI cross-check (triggered when MIDI is loaded)
  currentConfirmedBoxes = animFrames
    .filter(f => f.kind === 'confirm_note' || f.kind === 'confirm_flag')
    .map(f => f as ConfirmedBox)
  currentWidth       = width
  currentHeight      = height
  currentS           = S
  currentStaffRemoved = staffRemoved
  currentSystemBoxes = systemBoxes
  renderMidiCrossCheck()

  // ── Note stages: threshold 210 + per-system erode → restore (Dream-Flower) ─
  // Dream-Flower re-thresholds at 210 for note stages (harder cutoff = cleaner ink)
  const binary210 = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) binary210[i] = blurred[i] < 210 ? 1 : 0

  const erodeKernel   = makeKernel(erodeKernelType.value   as any, 1, 4)
  const restoreKernel = makeKernel(restoreKernelType.value as any, 2, 2)

  // Process each system region independently (Dream-Flower crops per system before erode/restore)
  const eroded   = new Uint8Array(width * height)
  const restored = new Uint8Array(width * height)
  for (const box of filteredBoundaryBoxes) {
    const { r: br, c: bc, w: bw, h: bh } = box.boundingBox
    const sysBin = new Uint8Array(bw * bh)
    for (let row = 0; row < bh; row++)
      for (let col = 0; col < bw; col++)
        sysBin[row * bw + col] = binary210[Math.min(br + row, height - 1) * width + Math.min(bc + col, width - 1)]
    const sysEroded   = erode(sysBin,   bw, bh, erodeKernel)
    const sysRestored = dilate(sysEroded, bw, bh, restoreKernel)
    for (let row = 0; row < bh; row++)
      for (let col = 0; col < bw; col++) {
        const pr = br + row, pc = bc + col
        if (pr < height && pc < width) {
          eroded[pr * width + pc]   = sysEroded[row * bw + col]
          restored[pr * width + pc] = sysRestored[row * bw + col]
        }
      }
  }

  const eclipseKernel  = makeKernel(eclipseKernelType.value as any, 2, 2)
  const eclipseDilated = dilate(restored, width, height, eclipseKernel)

  renderBinary(eroded,        canvasEroded,   width, height)
  renderBinary(restored,      canvasRestored, width, height)
  renderBinary(eclipseDilated, canvasEclipse,  width, height)

  if (enableEclipseDetect.checked) {
    const restoredResult = getNotesEclipse(restored,       width, height, S)
    const eclipseResult  = getNotesEclipse(eclipseDilated, width, height, S)
    const restoredBase   = canvasRestored.getContext('2d')!.getImageData(0, 0, width, height)
    const eclipseBase    = canvasEclipse.getContext('2d')!.getImageData(0, 0, width, height)
    renderGradientVote(restoredResult, canvasVoteRestored, restoredBase)
    renderGradientVote(eclipseResult,  canvasVoteEclipse,  eclipseBase)
  }
}

function renderBinary(src: Uint8Array, canvas: HTMLCanvasElement, width: number, height: number) {
  const img = new ImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    const v = src[i] === 1 ? 0 : 255
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  canvas.getContext('2d')!.putImageData(img, 0, 0)
}

function drawStaffLinesOverlay(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = 'rgba(255, 50, 50, 0.6)'
  ctx.lineWidth = 1
  for (const { r, c, w, h } of currentStaffLines) ctx.strokeRect(c, r, w, h)
}

function renderSR2Final(canvas: HTMLCanvasElement, width: number, height: number) {
  if (!animStaffRemoved) return
  renderBinary(animStaffRemoved, canvas, width, height)
  const ctx = canvas.getContext('2d')!
  ctx.lineWidth = 1
  for (const f of animFrames) {
    if (f.kind === 'confirm_note') {
      ctx.fillStyle   = 'rgba(0,200,80,0.3)';  ctx.fillRect(f.c, f.r, f.w, f.h)
      ctx.strokeStyle = 'rgba(0,200,80,0.8)';  ctx.strokeRect(f.c, f.r, f.w, f.h)
    } else if (f.kind === 'confirm_flag') {
      ctx.fillStyle   = 'rgba(255,140,0,0.3)'; ctx.fillRect(f.c, f.r, f.w, f.h)
      ctx.strokeStyle = 'rgba(255,140,0,0.8)'; ctx.strokeRect(f.c, f.r, f.w, f.h)
    }
  }
  drawStaffLinesOverlay(ctx)
}

function gaussianBlur(grey: Uint8Array, width: number, height: number, sigma: number): Uint8Array {
  // Build 1-D Gaussian kernel, then apply as two separable passes (H then V)
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

  // Horizontal pass
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

  // Vertical pass
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
  // Build 256-bin histogram
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

function makeKernel(type: 'cross' | 'square' | 'horizontal' | 'vertical' | 'eclipse', width = 1, height = width): number[][] {
  const offsets: number[][] = []
  const halfW = Math.floor(width  / 2)
  const halfH = Math.floor(height / 2)

  if (type === 'cross') {
    for (let d = -halfH; d <= halfH; d++) offsets.push([d, 0])
    for (let d = -halfW; d <= halfW; d++) offsets.push([0, d])
  } else if (type === 'square') {
    for (let dr = -halfH; dr <= halfH; dr++)
      for (let dc = -halfW; dc <= halfW; dc++)
        offsets.push([dr, dc])
  } else if (type === 'horizontal') {
    for (let d = -halfW; d <= halfW; d++) offsets.push([0, d])
  } else if (type === 'vertical') {
    for (let d = -halfH; d <= halfH; d++) offsets.push([d, 0])
  } else if (type === 'eclipse') {
    for (let dr = -halfH; dr <= halfH; dr++)
      for (let dc = -halfW; dc <= halfW; dc++)
        if (halfW > 0 && halfH > 0 && (dc / halfW) ** 2 + (dr / halfH) ** 2 <= 1)
          offsets.push([dr, dc])
  }

  const seen = new Set<string>()
  return offsets.filter(([r, c]) => {
    const key = `${r},${c}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function erode(binary: Uint8Array, width: number, height: number, kernel: number[][]): Uint8Array {
  const output = new Uint8Array(width * height);

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let allOn = true;

      for (const [dr, dc] of kernel) {
        const nr = r + dr;
        const nc = c + dc;

        // Out of bounds counts as OFF — kills edges
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) {
          allOn = false;
          break;
        }

        if (!binary[nr * width + nc]) {
          allOn = false;
          break;
        }
      }

      output[r * width + c] = allOn ? 1 : 0;
    }
  }

  return output;
}

function dilate(binary: Uint8Array, width: number, height: number, kernel: number[][]): Uint8Array {
  const output = new Uint8Array(width * height)
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      for (const [dr, dc] of kernel) {
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
        if (binary[nr * width + nc] === 1) {
          output[r * width + c] = 1
          break
        }
      }
    }
  }
  return output
}

function labelComponents(src: Uint8Array, width: number, height: number): { labels: Int32Array, count: number } {
  const labels = new Int32Array(width * height) // 0 = unlabelled
  // Pre-allocate a flat stack: each entry is two ints (r, c) packed as r*width+c
  const stack = new Int32Array(width * height)
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
        const r = Math.floor(idx / width)
        const c = idx % width
        if (r > 0) stack[top++] = idx - width
        if (r < height - 1) stack[top++] = idx + width
        if (c > 0) stack[top++] = idx - 1
        if (c < width - 1) stack[top++] = idx + 1
      }
    }
  }

  return { labels, count: nextLabel - 1 }
}

function getComponentStats(labels: Int32Array, count: number, width: number, height: number) {
  const stats = Array.from({ length: count }, () => ({
    minR: Infinity, maxR: -Infinity,
    minC: Infinity, maxC: -Infinity,
    area: 0
  }));

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const label = labels[r * width + c];
      if (!label) continue;
      const b = stats[label - 1];
      if (r < b.minR) b.minR = r;
      if (r > b.maxR) b.maxR = r;
      if (c < b.minC) b.minC = c;
      if (c > b.maxC) b.maxC = c;
      b.area++
    }
  }
  return stats.map((s, i) => ({
    label: i + 1,
    area: s.area,
    boundingBox: { r: s.minR, c: s.minC, h: s.maxR - s.minR + 1, w: s.maxC - s.minC + 1 },
    aspectRatio: (s.maxC - s.minC + 1) / (s.maxR - s.minR + 1),
    fillDensity: s.area / ((s.maxR - s.minR + 1) * (s.maxC - s.minC + 1))
  }));
}



type EdgePixel = { r: number; c: number; nx: number; ny: number }
type EllipseResult = { cx: number; cy: number; majorAxis: number; minorAxis: number; aspectRatio: number }
type GradientVoteResult = { edgePixels: EdgePixel[]; centers: { r: number; c: number; score: number }[]; ellipses: EllipseResult[] }

function getNotesEclipse(src: Uint8Array, width: number, height: number, S: number): GradientVoteResult {
  const edgeThreshold = 0.15
  const maxVoteLen = Math.round(S * 2)
  const peakThreshold = S * 0.5
  const minPoints = 6
  const halfWin = Math.round(S)

  // ── Step 1: Sobel edge detection ─────────────────────────────────────────
  const edgePixels: EdgePixel[] = []
  let maxMag = 0

  const mags = new Float32Array(width * height)
  const gxs = new Float32Array(width * height)
  const gys = new Float32Array(width * height)

  for (let r = 1; r < height - 1; r++) {
    for (let c = 1; c < width - 1; c++) {
      const p = (row: number, col: number) => src[row * width + col]
      const gx = -p(r - 1, c - 1) + p(r - 1, c + 1)
        - 2 * p(r, c - 1) + 2 * p(r, c + 1)
        - p(r + 1, c - 1) + p(r + 1, c + 1)
      const gy = -p(r - 1, c - 1) - 2 * p(r - 1, c) - p(r - 1, c + 1)
        + p(r + 1, c - 1) + 2 * p(r + 1, c) + p(r + 1, c + 1)
      const mag = Math.sqrt(gx * gx + gy * gy)
      mags[r * width + c] = mag
      gxs[r * width + c] = gx
      gys[r * width + c] = gy
      if (mag > maxMag) maxMag = mag
    }
  }

  const threshold = maxMag * edgeThreshold
  for (let r = 1; r < height - 1; r++) {
    for (let c = 1; c < width - 1; c++) {
      const mag = mags[r * width + c]
      if (mag < threshold) continue
      const nx = gxs[r * width + c] / mag
      const ny = gys[r * width + c] / mag
      edgePixels.push({ r, c, nx, ny })
    }
  }

  // ── Step 2: vote along each gradient normal ───────────────────────────────
  const accum = new Float32Array(width * height)
  for (const { r, c, nx, ny } of edgePixels) {
    for (let t = -maxVoteLen; t <= maxVoteLen; t++) {
      const vr = Math.round(r + ny * t)
      const vc = Math.round(c + nx * t)
      if (vr < 0 || vr >= height || vc < 0 || vc >= width) continue
      accum[vr * width + vc] += 1
    }
  }

  // ── Step 3: non-max suppression to find peak centers ─────────────────────
  const centers: { r: number; c: number; score: number }[] = []
  for (let r = halfWin; r < height - halfWin; r++) {
    for (let c = halfWin; c < width - halfWin; c++) {
      const score = accum[r * width + c]
      if (score < peakThreshold) continue
      let isMax = true
      outer: for (let dr = -halfWin; dr <= halfWin; dr++) {
        for (let dc = -halfWin; dc <= halfWin; dc++) {
          if (dr === 0 && dc === 0) continue
          if (accum[(r + dr) * width + (c + dc)] > score) { isMax = false; break outer }
        }
      }
      if (isMax) centers.push({ r, c, score })
    }
  }

  // ── Step 4: fit ellipse per center from nearby edge pixels ───────────────
  const ellipses: EllipseResult[] = []
  for (const { r: cr, c: cc } of centers) {
    const nearby = edgePixels
      .filter(({ r, c }) => (r - cr) ** 2 + (c - cc) ** 2 < (S * 1.2) ** 2)
      .map(({ r, c }) => [r, c])
    if (nearby.length < minPoints) continue
    const ellipse = fitEllipse(nearby)
    if (ellipse.aspectRatio >= 0.7 && ellipse.aspectRatio <= 2.5) {
      ellipses.push(ellipse)
    }
  }

  return { edgePixels, centers, ellipses }
}

function renderGradientVote(result: GradientVoteResult, canvas: HTMLCanvasElement, base: ImageData) {
  const ctx = canvas.getContext('2d')!
  const stride = parseInt(voteStride.value)
  ctx.putImageData(base, 0, 0)

  if (showDots.checked) {
    ctx.fillStyle = 'rgba(255, 140, 0, 0.8)'
    for (let i = 0; i < result.edgePixels.length; i += stride) {
      const { r, c } = result.edgePixels[i]
      ctx.fillRect(c, r, 2, 2)
    }
  }

  if (showArrows.checked) {
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.7)'
    ctx.lineWidth = 1
    for (let i = 0; i < result.edgePixels.length; i += stride) {
      const { r, c, nx, ny } = result.edgePixels[i]
      ctx.beginPath()
      ctx.moveTo(c, r)
      ctx.lineTo(c + nx * 6, r + ny * 6)
      ctx.stroke()
    }
  }

  if (showCenters.checked) {
    ctx.strokeStyle = 'rgba(0, 220, 255, 0.9)'
    ctx.lineWidth = 1.5
    for (const { r, c } of result.centers) {
      ctx.beginPath(); ctx.moveTo(c - 8, r); ctx.lineTo(c + 8, r); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(c, r - 8); ctx.lineTo(c, r + 8); ctx.stroke()
    }
  }

  if (showEllipses.checked) {
    ctx.strokeStyle = 'rgba(0, 255, 80, 0.9)'
    ctx.lineWidth = 2
    for (const { cx, cy, majorAxis, minorAxis } of result.ellipses) {
      ctx.beginPath()
      ctx.ellipse(cx, cy, majorAxis / 2, minorAxis / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

function fitEllipse(pixels: number[][]) {
  // Compute centroid
  const n = pixels.length;
  const cx = pixels.reduce((s, [r, c]) => s + c, 0) / n;
  const cy = pixels.reduce((s, [r, c]) => s + r, 0) / n;

  // Compute second moments (covariance)
  let mxx = 0, myy = 0, mxy = 0;
  for (const [r, c] of pixels) {
    const dx = c - cx, dy = r - cy;
    mxx += dx * dx;
    myy += dy * dy;
    mxy += dx * dy;
  }
  mxx /= n; myy /= n; mxy /= n;

  // Eigenvalues → semi-axes of the ellipse
  const common = Math.sqrt((mxx - myy) ** 2 / 4 + mxy ** 2);
  const lambda1 = (mxx + myy) / 2 + common;
  const lambda2 = (mxx + myy) / 2 - common;

  return {
    cx, cy,
    majorAxis: 2 * Math.sqrt(lambda1),
    minorAxis: 2 * Math.sqrt(lambda2),
    aspectRatio: Math.sqrt(lambda1 / lambda2)
  };
}

// ── Note detection ────────────────────────────────────────────────────────────

type NoteCandidate = { r: number; c: number; w: number; h: number; type: 'notehead' | 'beam' | 'grouped' }

function detectNotes(
  staffRemoved: Uint8Array,
  width: number,
  height: number,
  S: number,
  systemBoxes: { r: number; c: number; w: number; h: number }[]
): NoteCandidate[] {
  const { labels, count } = labelComponents(staffRemoved, width, height)
  const stats = getComponentStats(labels, count, width, height)
  const results: NoteCandidate[] = []

  for (const s of stats) {
    const { r, c, w, h } = s.boundingBox
    const cx = c + w / 2, cy = r + h / 2

    // Must fall inside a system bounding box
    if (!systemBoxes.some(b => cy >= b.r && cy <= b.r + b.h && cx >= b.c && cx <= b.c + b.w)) continue

    // Skip tiny noise and page-spanning blobs
    if (s.area < S * S * 0.1) continue
    if (w > width * 0.5) continue

    const aspect  = w / h
    const density = s.area / (w * h)

    if (aspect > 2.5 && h < S * 0.5) {
      // Thin horizontal → beam or flag
      results.push({ r, c, w, h, type: 'beam' })

    } else if (w > S * 2 && h > S * 0.5) {
      // Large cluster → grouped/beamed notes; also scan inside for individual noteheads
      results.push({ r, c, w, h, type: 'grouped' })
      const nW = Math.round(S * 0.9), nH = Math.round(S * 0.8)
      for (let wr = r; wr <= r + h - nH; wr++) {
        for (let wc = c; wc <= c + w - nW; wc++) {
          let filled = 0
          for (let dr = 0; dr < nH; dr++)
            for (let dc = 0; dc < nW; dc++)
              if (staffRemoved[(wr + dr) * width + (wc + dc)]) filled++
          if (filled / (nW * nH) > 0.45) {
            results.push({ r: wr, c: wc, w: nW, h: nH, type: 'notehead' })
            wc += Math.round(nW * 0.8)  // skip ahead to avoid duplicate detections
          }
        }
      }

    } else if (w >= S * 0.4 && w <= S * 1.6 && h >= S * 0.3 && h <= S * 1.2
               && aspect >= 0.5 && aspect <= 2.0 && density > 0.4) {
      // Fits a note-sized box and is dense enough → isolated notehead
      results.push({ r, c, w, h, type: 'notehead' })
    }
  }

  return results
}

function renderNoteDetection(
  staffRemoved: Uint8Array,
  candidates: NoteCandidate[],
  canvas: HTMLCanvasElement,
  width: number,
  height: number
) {
  renderBinary(staffRemoved, canvas, width, height)
  const ctx = canvas.getContext('2d')!
  const fill   = { notehead: 'rgba(0,200,80,0.35)',   beam: 'rgba(255,140,0,0.35)',  grouped: 'rgba(0,150,255,0.25)' }
  const stroke = { notehead: 'rgba(0,200,80,0.9)',    beam: 'rgba(255,140,0,0.9)',   grouped: 'rgba(0,150,255,0.8)'  }
  ctx.lineWidth = 1
  for (const { r, c, w, h, type } of candidates) {
    ctx.fillStyle   = fill[type]
    ctx.strokeStyle = stroke[type]
    ctx.fillRect(c, r, w, h)
    ctx.strokeRect(c, r, w, h)
  }
}

// ── Animation builder + renderer ─────────────────────────────────────────────

function buildAnimFrames(
  staffRemoved: Uint8Array,
  width: number,
  height: number,
  S: number,
  staffLineBoxes: { r: number; c: number; w: number; h: number }[],
  systemBoxes:    { r: number; c: number; w: number; h: number }[]
): AnimFrame[] {
  const frames: AnimFrame[] = []
  currentProbeRecords = []
  const nW     = Math.round(S * 0.9)
  const nH     = Math.round(S * 0.8)
  const stride = Math.max(1, Math.round(nW * 0.5))

  for (const sys of systemBoxes) {
    // Staff lines belonging to this system
    const lines = staffLineBoxes
      .filter(l => { const cy = l.r + l.h / 2; return cy >= sys.r && cy <= sys.r + sys.h })
      .sort((a, b) => a.r - b.r)
    if (lines.length === 0) continue

    const lineYs = lines.map(l => l.r + Math.floor(l.h / 2))

    // Build scan row list with optional staff line metadata for probe logic
    type ScanRowInfo = { y: number; lineR?: number; lineH?: number }
    const scanRowInfos: ScanRowInfo[] = []

    // Staff line rows — carry bbox r/h so probe offsets can respect even/odd height
    for (let i = 0; i < lines.length; i++)
      scanRowInfos.push({ y: lineYs[i], lineR: lines[i].r, lineH: lines[i].h })

    // Fill every inter-line gap at S/2 intervals.
    // Normal gaps (~S) get one row; the treble-bass gap (~2-3S) gets multiple rows,
    // covering ledger-line notes that float between the two sections.
    const halfStep = Math.max(1, Math.round(S / 2))
    for (let i = 0; i < lineYs.length - 1; i++)
      for (let y = lineYs[i] + halfStep; y < lineYs[i + 1]; y += halfStep)
        scanRowInfos.push({ y })

    // Predicted positions above top staff line (half-steps of S/2), within system
    for (let k = 1; k <= 4; k++) {
      const y = Math.round(lineYs[0] - k * S / 2)
      if (y >= sys.r) scanRowInfos.push({ y })
    }

    // Predicted positions below bottom staff line, within system
    for (let k = 1; k <= 4; k++) {
      const y = Math.round(lineYs[lineYs.length - 1] + k * S / 2)
      if (y <= sys.r + sys.h) scanRowInfos.push({ y })
    }

    scanRowInfos.sort((a, b) => a.y - b.y)

    for (const rowInfo of scanRowInfos) {
      const scanY = rowInfo.y
      const wr = Math.round(scanY - nH / 2)
      frames.push({ kind: 'row_start', y: scanY, c: sys.c, w: sys.w })

      // Compute the two probe rows for this scan position.
      // For staff-line rows: even height → probe directly outside bbox edges;
      //                      odd height  → probe ±2 from center row.
      // For midpoint/predicted rows: treat as odd (probe ±2 from scanY).
      let probeAbove: number
      let probeBelow: number
      if (rowInfo.lineR !== undefined && rowInfo.lineH !== undefined) {
        const lR = rowInfo.lineR, lH = rowInfo.lineH
        if (lH % 2 === 0) {
          probeAbove = lR - 1
          probeBelow = lR + lH
        } else {
          const center = lR + Math.floor(lH / 2)
          probeAbove = center - 2
          probeBelow = center + 2
        }
      } else {
        probeAbove = scanY - 2
        probeBelow = scanY + 2
      }

      // Slide window across the row, collecting hit column positions.
      // A hit means the 3-pixel-wide probe strip above OR below is fully black.
      const hitCols: number[] = []
      for (let wc = sys.c; wc <= sys.c + sys.w - nW; wc += stride) {
        const xc = wc + Math.floor(nW / 2)  // centre x of window
        const checkRow = (row: number) =>
          row >= 0 && row < height &&
          [xc - 1, xc, xc + 1].every(x =>
            x >= 0 && x < width && staffRemoved[row * width + x] === 1)
        const hitAbove = checkRow(probeAbove)
        const hitBelow = checkRow(probeBelow)

        // For staff-line scan rows: the line itself must also have ink at this
        // column (a note crossing the line leaves black pixels that survive removal).
        // For midpoint/predicted rows no such check is needed.
        let staffBlack = true
        if (rowInfo.lineR !== undefined && rowInfo.lineH !== undefined) {
          staffBlack = false
          for (let yr = rowInfo.lineR; yr < rowInfo.lineR + rowInfo.lineH && !staffBlack; yr++)
            staffBlack = [xc - 1, xc, xc + 1].some(
              x => x >= 0 && x < width && staffRemoved[yr * width + x] === 1)
        }

        const isHit = (hitAbove || hitBelow) && staffBlack
        currentProbeRecords.push({ xc, yAbove: probeAbove, yBelow: probeBelow, hitAbove, hitBelow })
        if (isHit) {
          hitCols.push(wc)
          frames.push({ kind: 'scan_hit', r: wr, c: wc, w: nW, h: nH })
        } else {
          frames.push({ kind: 'scan', r: wr, c: wc, w: nW, h: nH })
        }
      }

      if (hitCols.length === 0) continue

      // Merge overlapping hit windows into runs
      hitCols.sort((a, b) => a - b)
      const runs: { start: number; end: number }[] = []
      let runStart = hitCols[0], runEnd = hitCols[0] + nW
      for (let i = 1; i < hitCols.length; i++) {
        if (hitCols[i] <= runEnd + stride) {
          runEnd = Math.max(runEnd, hitCols[i] + nW)
        } else {
          runs.push({ start: runStart, end: runEnd })
          runStart = hitCols[i]; runEnd = hitCols[i] + nW
        }
      }
      runs.push({ start: runStart, end: runEnd })

      // Classify each run: long span → flag/beam, short → notehead
      for (const { start, end } of runs) {
        const span = end - start
        if (span > S * 2)
          frames.push({ kind: 'confirm_flag', r: wr, c: start, w: span, h: nH })
        else
          frames.push({ kind: 'confirm_note', r: wr, c: start, w: span, h: nH })
      }
    }
  }

  return frames
}

function renderAnimFrame() {
  if (!animStaffRemoved) return
  const { width, height } = canvasNotesAnim
  renderBinary(animStaffRemoved, canvasNotesAnim, width, height)
  const ctx = canvasNotesAnim.getContext('2d')!

  // Accumulate all confirmed results up to current step
  for (let i = 0; i < animStep && i < animFrames.length; i++) {
    const f = animFrames[i]
    ctx.lineWidth = 1
    if (f.kind === 'confirm_note') {
      ctx.fillStyle = 'rgba(0,200,80,0.3)';  ctx.fillRect(f.c, f.r, f.w, f.h)
      ctx.strokeStyle = 'rgba(0,200,80,0.8)'; ctx.strokeRect(f.c, f.r, f.w, f.h)
    } else if (f.kind === 'confirm_flag') {
      ctx.fillStyle = 'rgba(255,140,0,0.3)'; ctx.fillRect(f.c, f.r, f.w, f.h)
      ctx.strokeStyle = 'rgba(255,140,0,0.8)'; ctx.strokeRect(f.c, f.r, f.w, f.h)
    }
  }

  // Highlight the current frame
  if (animStep < animFrames.length) {
    const f = animFrames[animStep]
    ctx.lineWidth = 2
    if (f.kind === 'row_start') {
      ctx.strokeStyle = 'rgba(0,200,255,0.8)'
      ctx.beginPath(); ctx.moveTo(f.c, f.y); ctx.lineTo(f.c + f.w, f.y); ctx.stroke()
    } else if (f.kind === 'scan') {
      ctx.strokeStyle = 'rgba(255,255,0,0.7)'; ctx.strokeRect(f.c, f.r, f.w, f.h)
    } else if (f.kind === 'scan_hit') {
      ctx.fillStyle = 'rgba(0,220,80,0.4)';  ctx.fillRect(f.c, f.r, f.w, f.h)
      ctx.strokeStyle = 'rgba(0,255,80,0.9)'; ctx.strokeRect(f.c, f.r, f.w, f.h)
    } else if (f.kind === 'confirm_note') {
      ctx.fillStyle = 'rgba(0,255,100,0.45)'; ctx.fillRect(f.c, f.r, f.w, f.h)
      ctx.strokeStyle = 'rgba(0,255,100,1)';  ctx.strokeRect(f.c, f.r, f.w, f.h)
    } else if (f.kind === 'confirm_flag') {
      ctx.fillStyle = 'rgba(255,170,0,0.45)'; ctx.fillRect(f.c, f.r, f.w, f.h)
      ctx.strokeStyle = 'rgba(255,170,0,1)';  ctx.strokeRect(f.c, f.r, f.w, f.h)
    }
  }

  // Legend
  const legend = [
    { color: 'rgba(0,200,255,0.9)',  label: 'Scan row'   },
    { color: 'rgba(255,255,0,0.8)',  label: 'Scan window' },
    { color: 'rgba(0,220,80,0.8)',   label: 'Density hit' },
    { color: 'rgba(0,200,80,0.8)',   label: 'Notehead'   },
    { color: 'rgba(255,140,0,0.8)',  label: 'Flag / beam' },
  ]
  ctx.font = '11px monospace'
  const lx = 8, ly = height - legend.length * 18 - 4
  legend.forEach(({ color, label }, i) => {
    const y = ly + i * 18
    ctx.fillStyle = color;  ctx.fillRect(lx, y, 12, 12)
    ctx.fillStyle = '#fff'; ctx.fillText(label, lx + 16, y + 10)
  })

  animStatusEl.textContent = `${animStep} / ${animFrames.length}`
  drawStaffLinesOverlay(ctx)
}

// ── MIDI parser ───────────────────────────────────────────────────────────────

function parseMidi(buf: Uint8Array): { pitch: number; timeMs: number }[] {
  let pos = 0
  const readU32 = () => { const v = (buf[pos]<<24)|(buf[pos+1]<<16)|(buf[pos+2]<<8)|buf[pos+3]; pos+=4; return v }
  const readU16 = () => { const v = (buf[pos]<<8)|buf[pos+1]; pos+=2; return v }
  const readVarLen = () => {
    let v = 0
    for (let i = 0; i < 4; i++) {
      const b = buf[pos++]; v = (v << 7) | (b & 0x7F)
      if (!(b & 0x80)) break
    }
    return v
  }

  pos = 8  // skip 'MThd' + chunk length (4+4)
  const _format = readU16()
  const ntrks   = readU16()
  const division = readU16()
  if (division & 0x8000) return []  // SMPTE not supported

  const ticksPerBeat = division
  const notes: { pitch: number; timeMs: number }[] = []

  for (let t = 0; t < ntrks; t++) {
    // Seek to next MTrk marker
    while (pos < buf.length - 4 &&
           !(buf[pos]===0x4D && buf[pos+1]===0x54 && buf[pos+2]===0x72 && buf[pos+3]===0x6B)) pos++
    pos += 4
    const trackLen = readU32()
    const trackEnd = pos + trackLen
    let absTick = 0
    let tempo   = 500000  // default 120 BPM (µs per beat)
    let lastStatus = 0

    while (pos < trackEnd) {
      absTick += readVarLen()
      let status = buf[pos]
      if (status & 0x80) { lastStatus = status; pos++ } else { status = lastStatus }
      const type = status & 0xF0

      if (type === 0x90 || type === 0x80) {
        const pitch = buf[pos++], vel = buf[pos++]
        if (type === 0x90 && vel > 0)
          notes.push({ pitch, timeMs: (absTick / ticksPerBeat) * (tempo / 1000) })
      } else if (type === 0xA0 || type === 0xB0 || type === 0xE0) { pos += 2 }
      else if (type === 0xC0 || type === 0xD0) { pos += 1 }
      else if (status === 0xFF) {
        const metaType = buf[pos++]
        const metaLen  = readVarLen()
        if (metaType === 0x51 && metaLen === 3)
          tempo = (buf[pos]<<16)|(buf[pos+1]<<8)|buf[pos+2]
        pos += metaLen
      } else if (status === 0xF0 || status === 0xF7) {
        pos += readVarLen()
      } else { pos++ }
    }
    pos = trackEnd
  }

  notes.sort((a, b) => a.timeMs - b.timeMs)
  return notes
}

// ── LCS helper ───────────────────────────────────────────────────────────────
// Returns pairs of matched indices {ai, bi} preserving order in both sequences.
function lcsWithIndices(a: number[], b: number[]): { ai: number; bi: number }[] {
  const n = a.length, m = b.length
  // dp[i][j] = LCS length of a[0..i-1] vs b[0..j-1]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  // Backtrack
  const result: { ai: number; bi: number }[] = []
  let i = n, j = m
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.unshift({ ai: i - 1, bi: j - 1 }); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return result
}

// ── MIDI cross-check ──────────────────────────────────────────────────────────

function renderMidiCrossCheck() {
  if (!currentStaffRemoved || midiNotes.length === 0 || currentConfirmedBoxes.length === 0) return
  const W = currentWidth, H = currentHeight, S = currentS

  // Linear time→x mapping across page width
  const totalMs = midiNotes[midiNotes.length - 1].timeMs || 1
  const midiXs  = midiNotes.map(n => Math.round((n.timeMs / totalMs) * W))

  // Sort detected noteboxes left→right (time order matches MIDI order)
  const noteBoxes = currentConfirmedBoxes.filter(b => b.kind === 'confirm_note')
  const boxesByX  = noteBoxes
    .map((b, bi) => ({ ...b, bi, xc: b.c + b.w / 2 }))
    .sort((a, b) => a.xc - b.xc)

  // Pass 1: rough pitch assignment — each box gets the pitch of its nearest MIDI note by x
  // (re-use allowed; LCS will resolve duplicates)
  const roughPitches = boxesByX.map(b => {
    let bestMi = 0, bestDist = Math.abs(midiXs[0] - b.xc)
    for (let mi = 1; mi < midiXs.length; mi++) {
      const d = Math.abs(midiXs[mi] - b.xc)
      if (d < bestDist) { bestDist = d; bestMi = mi }
    }
    return midiNotes[bestMi].pitch
  })

  // Pass 2: LCS between the detected pitch sequence and the MIDI pitch sequence
  const midiPitchSeq = midiNotes.map(n => n.pitch)
  const lcs = lcsWithIndices(roughPitches, midiPitchSeq)

  // di (index into boxesByX) → mi (index into midiNotes)
  const detectedToMidi = new Map<number, number>()
  const matchedMidi    = new Set<number>()
  for (const { ai, bi } of lcs) { detectedToMidi.set(ai, bi); matchedMidi.add(bi) }

  // For each system, find its 10 staff lines, split top-5 (treble) / bottom-5 (bass).
  // The dividing y is the midpoint between staff line index 4 and 5 (0-based).
  const systemDividers = currentSystemBoxes.map(sys => {
    const lines = currentStaffLines
      .filter(l => l.r + l.h / 2 >= sys.r && l.r + l.h / 2 <= sys.r + sys.h)
      .sort((a, b) => a.r - b.r)
    if (lines.length < 6) return null   // can't split — too few lines detected
    // Divider sits in the gap between the 5th and 6th line (indices 4 and 5)
    return (lines[4].r + lines[4].h / 2 + lines[5].r + lines[5].h / 2) / 2
  })

  const systemClef = (boxCenterY: number) => {
    for (let i = 0; i < currentSystemBoxes.length; i++) {
      const sys = currentSystemBoxes[i]
      if (boxCenterY < sys.r || boxCenterY > sys.r + sys.h) continue
      const divider = systemDividers[i]
      if (divider === null) return ''
      return boxCenterY < divider ? 'T' : 'B'
    }
    return ''
  }

  // Draw diff canvas
  canvasMidiDiff.width  = W
  canvasMidiDiff.height = H
  renderBinary(currentStaffRemoved, canvasMidiDiff, W, H)
  const ctx = canvasMidiDiff.getContext('2d')!
  drawStaffLinesOverlay(ctx)

  // Probe pixels: 3×1 strips that were checked above/below each scan window.
  // Hit strip = bright cyan; miss strip = dim grey — drawn at 1px height, 3px wide.
  for (const { xc, yAbove, yBelow, hitAbove, hitBelow } of currentProbeRecords) {
    for (const [y, hit] of [[yAbove, hitAbove], [yBelow, hitBelow]] as [number, boolean][]) {
      if (y < 0 || y >= H) continue
      ctx.fillStyle = hit ? 'rgba(0,230,255,0.9)' : 'rgba(160,160,160,0.25)'
      ctx.fillRect(xc - 1, y, 3, 1)
    }
  }
  ctx.lineWidth = 1

  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  const fontSize = Math.max(8, Math.round(S * 0.7))
  ctx.font = `bold ${fontSize}px monospace`

  const mismatches: { type: 'falsePos' | 'missed'; x: number; y: number; box?: ConfirmedBox }[] = []

  // Draw all detected boxes using boxesByX (sorted by x, indexed as di)
  for (let di = 0; di < boxesByX.length; di++) {
    const { r, c, w, h } = boxesByX[di]
    if (detectedToMidi.has(di)) {
      // LCS match → green + label
      ctx.fillStyle = 'rgba(0,200,80,0.25)';  ctx.fillRect(c, r, w, h)
      ctx.strokeStyle = 'rgba(0,200,80,0.7)'; ctx.strokeRect(c, r, w, h)

      const mi    = detectedToMidi.get(di)!
      const pitch = midiNotes[mi].pitch
      const name  = NOTE_NAMES[pitch % 12]
      const oct   = Math.floor(pitch / 12) - 1
      const clef  = systemClef(r + h / 2)
      const label = `${name}${oct}${clef ? ' ' + clef : ''}`
      const tx = c + w / 2, ty = r - 2
      ctx.fillStyle = '#000'
      ctx.fillText(label, tx - ctx.measureText(label).width / 2 + 1, ty + 1)
      ctx.fillStyle = 'rgba(0,255,100,1)'
      ctx.fillText(label, tx - ctx.measureText(label).width / 2, ty)
    } else {
      // Not in LCS → wrong / extra note → red
      ctx.fillStyle = 'rgba(255,50,50,0.3)';  ctx.fillRect(c, r, w, h)
      ctx.strokeStyle = 'rgba(255,50,50,0.9)'; ctx.strokeRect(c, r, w, h)
      mismatches.push({ type: 'falsePos', x: c + w / 2, y: r + h / 2, box: boxesByX[di] })
    }
  }

  // Missed = in MIDI but not in LCS → list in M3
  const missedLines: string[] = []
  for (let mi = 0; mi < midiNotes.length; mi++) {
    if (matchedMidi.has(mi)) continue
    const { pitch, timeMs } = midiNotes[mi]
    const name   = NOTE_NAMES[pitch % 12]
    const octave = Math.floor(pitch / 12) - 1
    missedLines.push(`#${mi + 1}  ${name}${octave}  (${timeMs.toFixed(0)} ms)`)
  }
  midiMissedEl.textContent = missedLines.length > 0 ? missedLines.join('\n') : 'none'

  // Legend
  const legend = [
    { color: 'rgba(0,200,80,0.8)',    label: 'Matched' },
    { color: 'rgba(255,50,50,0.8)',   label: 'False positive' },
    { color: 'rgba(0,230,255,0.9)',   label: 'Probe hit' },
    { color: 'rgba(160,160,160,0.5)', label: 'Probe miss' },
  ]
  ctx.font = '11px monospace'
  const lx = 8, ly = H - legend.length * 18 - 4
  legend.forEach(({ color, label }, i) => {
    const y = ly + i * 18
    ctx.fillStyle = color;  ctx.fillRect(lx, y, 12, 12)
    ctx.fillStyle = '#fff'; ctx.fillText(label, lx + 16, y + 10)
  })

  buildMismatchThumbnails(mismatches)
}

function buildMismatchThumbnails(
  mismatches: { type: 'falsePos' | 'missed'; x: number; y: number; box?: ConfirmedBox }[]
) {
  midiThumbs.innerHTML = ''
  const CROP = 40, SCALE = 4, DISP = CROP * SCALE
  const W = currentWidth, H = currentHeight

  for (const m of mismatches) {
    const cx = Math.round(m.x), cy = Math.round(m.y)
    const sx = Math.max(0, cx - CROP / 2), sy = Math.max(0, cy - CROP / 2)
    const ex = Math.min(W, sx + CROP),     ey = Math.min(H, sy + CROP)

    const thumb = document.createElement('canvas')
    thumb.width  = DISP
    thumb.height = DISP
    thumb.title  = m.type === 'falsePos' ? 'False positive' : 'Missed note'
    thumb.style.border = `2px solid ${m.type === 'falsePos' ? '#f55' : '#ff0'}`
    const tctx = thumb.getContext('2d')!

    tctx.fillStyle = '#fff'; tctx.fillRect(0, 0, DISP, DISP)

    if (currentStaffRemoved) {
      for (let r = sy; r < ey; r++) {
        for (let c = sx; c < ex; c++) {
          const v = currentStaffRemoved[r * W + c] ? 0 : 255
          tctx.fillStyle = `rgb(${v},${v},${v})`
          tctx.fillRect((c - sx) * SCALE, (r - sy) * SCALE, SCALE, SCALE)
        }
      }
    }

    // Probe pixels within the crop region, scaled up
    for (const { xc, yAbove, yBelow, hitAbove, hitBelow } of currentProbeRecords) {
      if (xc - 1 < sx || xc + 1 >= ex) continue  // outside crop x range
      for (const [y, hit] of [[yAbove, hitAbove], [yBelow, hitBelow]] as [number, boolean][]) {
        if (y < sy || y >= ey) continue
        tctx.fillStyle = hit ? 'rgba(0,230,255,0.95)' : 'rgba(160,160,160,0.4)'
        // Draw 3 pixels wide × SCALE tall so they're clearly visible at zoom
        tctx.fillRect((xc - 1 - sx) * SCALE, (y - sy) * SCALE, 3 * SCALE, SCALE)
      }
    }

    // Staff lines (clipped to crop region, scaled)
    tctx.strokeStyle = 'rgba(255,50,50,0.7)'; tctx.lineWidth = 1
    for (const { r, c, w, h } of currentStaffLines) {
      tctx.strokeRect((c - sx) * SCALE, (r - sy) * SCALE, w * SCALE, h * SCALE)
    }

    // Detection box
    if (m.box) {
      const { r, c, w, h } = m.box
      tctx.strokeStyle = m.type === 'falsePos' ? 'rgba(255,50,50,0.9)' : 'rgba(0,200,80,0.9)'
      tctx.lineWidth = 2
      tctx.strokeRect((c - sx) * SCALE, (r - sy) * SCALE, w * SCALE, h * SCALE)
    }

    // Type label
    tctx.font = `${SCALE * 3}px monospace`
    tctx.fillStyle = m.type === 'falsePos' ? '#f55' : '#ff0'
    tctx.fillText(m.type === 'falsePos' ? 'FP' : 'MISS', 3, SCALE * 3 + 1)

    midiThumbs.appendChild(thumb)
  }
}

// ── Slider listeners ──────────────────────────────────────────────────────────

gaussSigma.addEventListener('input', () => runPipeline())
useOtsu.addEventListener('change', () => runPipeline())
blackThreshold.addEventListener('input', () => {
  blackDisplay.textContent = blackThreshold.value
  runPipeline()
})
minLineWidth.addEventListener('input', () => {
  minLineDisplay.textContent = `${minLineWidth.value}%`
  runPipeline()
})
collapseGap.addEventListener('input', () => {
  collapseDisplay.textContent = collapseGap.value
  runPipeline()
})
dilateRadius.addEventListener('input', () => {
  dilateDisplay.textContent = dilateRadius.value
  runPipeline()
})
kernelType.addEventListener('change', () => runPipeline())
voteStride.addEventListener('input', () => {
  voteStrideDisp.textContent = voteStride.value
  runPipeline()
})
  ;[showDots, showArrows, showCenters, showEllipses].forEach(el =>
    el.addEventListener('change', () => runPipeline())
  )
erodeKernelType.addEventListener('change', () => runPipeline())
restoreKernelType.addEventListener('change', () => runPipeline())
eclipseKernelType.addEventListener('change', () => runPipeline())
enableEclipseDetect.addEventListener('change', () => runPipeline())

animSpeedInput.addEventListener('input', () => {
  animSpeedDisplay.textContent = `${animSpeedInput.value}ms`
})

btnAnimReset.addEventListener('click', () => {
  if (animInterval) { clearInterval(animInterval); animInterval = null; btnAnimPlay.textContent = '▶ Play' }
  animStep = 0
  renderAnimFrame()
})

btnAnimStep.addEventListener('click', () => {
  if (animStep < animFrames.length) { animStep++; renderAnimFrame() }
})

btnAnimPlay.addEventListener('click', () => {
  if (animInterval) {
    clearInterval(animInterval); animInterval = null
    btnAnimPlay.textContent = '▶ Play'
  } else {
    btnAnimPlay.textContent = '⏸ Pause'
    animInterval = window.setInterval(() => {
      if (animStep >= animFrames.length) {
        clearInterval(animInterval!); animInterval = null
        btnAnimPlay.textContent = '▶ Play'
        return
      }
      animStep++
      renderAnimFrame()
    }, parseInt(animSpeedInput.value))
  }
})

zoomInput.addEventListener('input', () => {
  const pct = parseInt(zoomInput.value)
  zoomDisplay.textContent = `${pct}%`
  const px = Math.round(350 * pct / 100)
  document.querySelectorAll<HTMLElement>('.stage').forEach(s => s.style.width = `${px}px`)
})
