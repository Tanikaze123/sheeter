/**
 * pdfProcessor.ts — Phase 3
 *
 * Two responsibilities:
 *   1. RENDER — use PDF.js to draw each page of the sheet music onto a <canvas>
 *   2. DETECT — analyse the rendered pixels to find where each measure is on screen
 *               so we can highlight the right region as the user plays
 *
 * === How measure detection works ===
 *
 *  Staff lines are thin horizontal black lines that span most of the page width.
 *  Barlines are thin vertical black lines that cross all 5 lines of a staff.
 *
 *  Step 1: scan horizontal pixel rows → find rows that are mostly black → staff lines
 *  Step 2: group staff lines into systems (a "system" = one row of music across the page)
 *          each system has exactly 5 staff lines (treble) + 5 (bass) = 10 lines
 *  Step 3: for each system, scan vertical columns → find columns that are black
 *          all the way from top to bottom of the system → barlines
 *  Step 4: adjacent barlines define a measure bounding box { x, y, width, height }
 *
 *  This gives us a list of MeasureBounds[], one per measure, in page order.
 *  We then map MeasureBounds[i] ↔ ParsedMeasure[i] from the MIDI.
 *
 * === Limitations ===
 *  - Won't be perfect on pickup bars, irregular layouts, or very dense pages
 *  - Multi-page PDFs: each page is processed separately; measure index carries over
 */

import * as pdfjsLib from 'pdfjs-dist'

// Tell PDF.js where to find its worker script (Vite handles this automatically)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// Pixel bounding box for a single measure on a specific page
export interface MeasureBounds {
  page: number     // 0-based page index
  x: number        // left edge in canvas pixels
  y: number        // top edge (top of staff system)
  width: number
  height: number   // full height of the staff system containing this measure
  measureIndex: number  // matches ParsedMeasure.index
}

export interface ProcessedPDF {
  pageCount: number
  // Call renderPage(n) to draw page n onto a canvas, returns the ImageData for analysis
  renderPage: (pageIndex: number, canvas: HTMLCanvasElement) => Promise<ImageData>
  measures: MeasureBounds[]  // filled in after detectMeasures() is called
}

export async function loadPDF(file: File): Promise<ProcessedPDF> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const allMeasures: MeasureBounds[] = [];
  const pageCache = new Map<number, HTMLCanvasElement>();
  let measureOffset: number = 0
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 })

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not get canvas context')
    await page.render({ canvasContext: context, viewport }).promise

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)

    pageCache.set(pageNum, canvas)

    const measures = detectMeasures(imageData, pageNum - 1, measureOffset)
    measureOffset += measures.length

    allMeasures.push(...measures)
  }

  console.log("Num pages: ", pdf.numPages)

  return {
    pageCount: pdf.numPages,
    measures: allMeasures,  // filled in after detectMeasures() is called
    renderPage: async (pageIndex, canvas) => {
      const cached = pageCache.get(pageIndex + 1)!
      canvas.width = cached.width
      canvas.height = cached.height
      canvas.getContext('2d')!.drawImage(cached, 0, 0)
      return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
    }
  }
}

/**
 * TODO Phase 3: implement measure detection
 *
 * Takes a rendered page's pixel data and returns bounding boxes for each measure.
 * pageIndex is passed through so MeasureBounds knows which page each box is on.
 * measureOffset is the total number of measures already found on previous pages.
 *
 * Hints:
 *   - imageData.data is a flat Uint8ClampedArray: [R, G, B, A, R, G, B, A, ...]
 *   - pixel at (x, y) starts at index: (y * imageData.width + x) * 4
 *   - a pixel is "black" if R < 50 && G < 50 && B < 50 (and A > 200)
 *   - scan row by row to find staff lines (long horizontal black runs)
 *   - scan column by column within each system to find barlines
 */
export function detectMeasures(
  imageData: ImageData,
  pageIndex: number,
  measureOffset: number,
): MeasureBounds[] {
  // TODO: implement staff line detection, then barline detection



  return []  // replace with real results
}

// return is the pixel is black or not
function isBlack(data: Uint8ClampedArray, x: number, y: number, width: number) : boolean {
  const pixelIndex = (y * width + x) * 4
  const R = data[pixelIndex],G = data[pixelIndex + 1],B = data[pixelIndex + 2],A = data[pixelIndex + 3]
  if (R < 50 && G < 50 && B < 50 && A > 200) {return true}
  return false
}