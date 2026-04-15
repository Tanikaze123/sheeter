/**
 * cleaner.ts
 *
 * Standalone sheet music cleaner following Dream-Flower's pipeline:
 *   1. Greyscale → Gaussian blur (σ≈1.25, matching their 5×5 kernel) → Otsu binary
 *   2. Dilate with 40×10 rect kernel → connected components → system bounding boxes
 *   3. Per system: re-threshold at 210 → erode (1×4 vertical) → restore (2×2 ellipse)
 *   4. Render the full-page cleaned binary
 */

import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// ── DOM ───────────────────────────────────────────────────────────────────────

const pdfInput      = document.getElementById('pdf-input')      as HTMLInputElement
const pageInput     = document.getElementById('page-input')     as HTMLInputElement
const zoomInput     = document.getElementById('zoom')           as HTMLInputElement
const zoomDisplay   = document.getElementById('zoom-display')   as HTMLSpanElement
const statusEl      = document.getElementById('status')         as HTMLDivElement
const canvasOriginal = document.getElementById('canvas-original') as HTMLCanvasElement
const canvasCleaned  = document.getElementById('canvas-cleaned')  as HTMLCanvasElement

// ── State ─────────────────────────────────────────────────────────────────────

let pdf: any = null

function status(msg: string) { statusEl.textContent = msg }

// ── PDF loading ───────────────────────────────────────────────────────────────

pdfInput.addEventListener('change', async () => {
  const file = pdfInput.files?.[0]
  if (!file) return
  status('Loading PDF…')
  const buf = await file.arrayBuffer()
  pdf = await pdfjsLib.getDocument({ data: buf }).promise
  pageInput.max = String(pdf.numPages)
  status(`Loaded — ${pdf.numPages} page(s). Rendering…`)
  await renderAndClean(parseInt(pageInput.value))
})

pageInput.addEventListener('change', async () => {
  if (!pdf) return
  await renderAndClean(parseInt(pageInput.value))
})

zoomInput.addEventListener('input', () => {
  const pct = parseInt(zoomInput.value)
  zoomDisplay.textContent = `${pct}%`
  const px = Math.round(600 * pct / 100)
  canvasOriginal.style.width = `${px}px`
  canvasCleaned.style.width  = `${px}px`
})

// ── Main ──────────────────────────────────────────────────────────────────────

async function renderAndClean(pageNum: number) {
  if (!pdf) return
  const page     = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale: 1.5 })

  canvasOriginal.width  = viewport.width
  canvasOriginal.height = viewport.height
  canvasCleaned.width   = viewport.width
  canvasCleaned.height  = viewport.height

  const ctx = canvasOriginal.getContext('2d')!
  await page.render({ canvasContext: ctx, viewport }).promise
  const imageData = ctx.getImageData(0, 0, viewport.width, viewport.height)

  status('Cleaning…')
  const cleaned = clean(imageData)
  renderBinary(cleaned, canvasCleaned, viewport.width, viewport.height)
  status(`Done — page ${pageNum} of ${pdf.numPages}`)
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

function clean(imageData: ImageData): Uint8Array {
  const { data, width, height } = imageData

  // 1. Greyscale
  const grey = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++)
    grey[i] = Math.round((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3)

  // 2. Gaussian blur (σ = 1.25 ≈ Dream-Flower's 5×5 kernel)
  const blurred = gaussianBlur(grey, width, height, 1.25)

  // 3. Otsu binary for system detection
  const otsu   = otsuThreshold(blurred)
  const binary = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) binary[i] = blurred[i] < otsu ? 1 : 0

  // 4. Dilate 40×10 → connected components → system bounding boxes (width > 80%)
  const sysKernel  = makeKernel('square', 40, 10)
  const dilated    = dilate(binary, width, height, sysKernel)
  const { labels, count } = labelComponents(dilated, width, height)
  const stats      = getComponentStats(labels, count, width, height)
  const systems    = stats.filter(s => s.boundingBox.w > width * 0.8)

  // 5. Per-system: threshold 210 → erode (1×4 vertical) → restore (2×2 ellipse)
  const erodeKernel   = makeKernel('vertical', 1, 4)
  const restoreKernel = makeKernel('eclipse',  2, 2)

  const binary210 = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) binary210[i] = blurred[i] < 210 ? 1 : 0

  const result = new Uint8Array(width * height)
  for (const sys of systems) {
    const { r: br, c: bc, w: bw, h: bh } = sys.boundingBox
    const sysBin = new Uint8Array(bw * bh)
    for (let row = 0; row < bh; row++)
      for (let col = 0; col < bw; col++)
        sysBin[row * bw + col] = binary210[Math.min(br + row, height - 1) * width + Math.min(bc + col, width - 1)]

    const sysEroded   = erode(sysBin,    bw, bh, erodeKernel)
    const sysRestored = dilate(sysEroded, bw, bh, restoreKernel)

    for (let row = 0; row < bh; row++)
      for (let col = 0; col < bw; col++) {
        const pr = br + row, pc = bc + col
        if (pr < height && pc < width)
          result[pr * width + pc] = sysRestored[row * bw + col]
      }
  }

  return result
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderBinary(src: Uint8Array, canvas: HTMLCanvasElement, width: number, height: number) {
  const img = new ImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    const v = src[i] === 1 ? 0 : 255
    img.data[i * 4]     = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  canvas.getContext('2d')!.putImageData(img, 0, 0)
}

// ── Image processing primitives ───────────────────────────────────────────────

function gaussianBlur(grey: Uint8Array, width: number, height: number, sigma: number): Uint8Array {
  const radius = Math.ceil(sigma * 3)
  const size   = 2 * radius + 1
  const kernel = new Float32Array(size)
  let sum = 0
  for (let i = 0; i < size; i++) {
    kernel[i] = Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma))
    sum += kernel[i]
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum

  const tmp = new Float32Array(width * height)
  const out = new Uint8Array(width * height)

  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      let acc = 0, wsum = 0
      for (let k = -radius; k <= radius; k++) {
        const nc = Math.min(Math.max(c + k, 0), width - 1)
        const w  = kernel[k + radius]
        acc += grey[r * width + nc] * w; wsum += w
      }
      tmp[r * width + c] = acc / wsum
    }

  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      let acc = 0, wsum = 0
      for (let k = -radius; k <= radius; k++) {
        const nr = Math.min(Math.max(r + k, 0), height - 1)
        const w  = kernel[k + radius]
        acc += tmp[nr * width + c] * w; wsum += w
      }
      out[r * width + c] = Math.round(acc / wsum)
    }

  return out
}

function otsuThreshold(grey: Uint8Array): number {
  const hist = new Float32Array(256)
  for (let i = 0; i < grey.length; i++) hist[grey[i]]++
  const n = grey.length
  let bestT = 0, bestVar = 0, w0 = 0, sum0 = 0
  const totalSum = hist.reduce((s, v, i) => s + v * i, 0)
  let w1 = n, sum1 = totalSum
  for (let t = 0; t < 256; t++) {
    w0 += hist[t]; sum0 += t * hist[t]
    w1 -= hist[t]; sum1 -= t * hist[t]
    if (w0 === 0 || w1 === 0) continue
    const variance = (w0 * w1 * (sum0 / w0 - sum1 / w1) ** 2) / (n * n)
    if (variance > bestVar) { bestVar = variance; bestT = t }
  }
  return bestT
}

function makeKernel(type: 'square' | 'horizontal' | 'vertical' | 'eclipse' | 'cross', width = 1, height = width): number[][] {
  const offsets: number[][] = []
  const halfW = Math.floor(width  / 2)
  const halfH = Math.floor(height / 2)
  if (type === 'square') {
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
  } else if (type === 'cross') {
    for (let d = -halfH; d <= halfH; d++) offsets.push([d, 0])
    for (let d = -halfW; d <= halfW; d++) offsets.push([0, d])
  }
  const seen = new Set<string>()
  return offsets.filter(([r, c]) => {
    const key = `${r},${c}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function erode(src: Uint8Array, width: number, height: number, kernel: number[][]): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      let all = true
      for (const [dr, dc] of kernel) {
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= height || nc < 0 || nc >= width || !src[nr * width + nc]) { all = false; break }
      }
      out[r * width + c] = all ? 1 : 0
    }
  return out
}

function dilate(src: Uint8Array, width: number, height: number, kernel: number[][]): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++)
      for (const [dr, dc] of kernel) {
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
        if (src[nr * width + nc]) { out[r * width + c] = 1; break }
      }
  return out
}

function labelComponents(src: Uint8Array, width: number, height: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(width * height)
  const stack  = new Int32Array(width * height)
  let nextLabel = 1
  for (let r0 = 0; r0 < height; r0++)
    for (let c0 = 0; c0 < width; c0++) {
      if (!src[r0 * width + c0] || labels[r0 * width + c0]) continue
      const label = nextLabel++
      let top = 0
      stack[top++] = r0 * width + c0
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
  return { labels, count: nextLabel - 1 }
}

function getComponentStats(labels: Int32Array, count: number, width: number, height: number) {
  const stats = Array.from({ length: count }, () => ({ minR: Infinity, maxR: -Infinity, minC: Infinity, maxC: -Infinity, area: 0 }))
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const lbl = labels[r * width + c]
      if (!lbl) continue
      const s = stats[lbl - 1]
      if (r < s.minR) s.minR = r; if (r > s.maxR) s.maxR = r
      if (c < s.minC) s.minC = c; if (c > s.maxC) s.maxC = c
      s.area++
    }
  return stats.map((s, i) => ({
    label: i + 1,
    area:  s.area,
    boundingBox: { r: s.minR, c: s.minC, w: s.maxC - s.minC + 1, h: s.maxR - s.minR + 1 },
  }))
}
