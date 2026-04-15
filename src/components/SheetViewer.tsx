/**
 * SheetViewer.tsx — Phase 3 + 6
 *
 * Renders the PDF sheet music and draws highlights + annotations on top.
 *
 * Two <canvas> elements are stacked:
 *   pdf-canvas     — PDF.js draws here once per page (never touched again)
 *   overlay-canvas — highlights, note name labels, zoom effects drawn here
 *
 * Because the rendering is imperative (canvas draw calls), this component
 * exposes a ref handle (SheetViewerHandle) so the parent can drive it:
 *   viewerRef.current.highlightMeasure(3)
 *   viewerRef.current.setAnnotationsVisible(true)
 *
 * TODO Phase 3: implement rendering and highlight
 * TODO Phase 6: implement annotations and scroll-to-measure zoom
 */

import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { MeasureBounds, ProcessedPDF } from '../modules/pdfProcessor'
import type { ParsedNote } from '../modules/midiParser'

export interface SheetViewerHandle {
  setMeasureData(measures: MeasureBounds[], measureNotes: Map<number, ParsedNote[]>): void
  highlightMeasure(measureIndex: number): void
  setAnnotationsVisible(visible: boolean): void
  renderPage(pdf: ProcessedPDF, pageIndex: number): Promise<void>
}

interface SheetViewerProps {
  showAnnotations: boolean
}

const SheetViewer = forwardRef<SheetViewerHandle, SheetViewerProps>(
  function SheetViewer(_props, ref) {
    const pdfCanvasRef     = useRef<HTMLCanvasElement>(null)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)

    // Mutable refs for internal state — avoids stale closure issues in imperative code
    const measuresRef      = useRef<MeasureBounds[]>([])
    const measureNotesRef  = useRef<Map<number, ParsedNote[]>>(new Map())
    const showAnnotations  = useRef(_props.showAnnotations)

    useImperativeHandle(ref, () => ({
      setMeasureData(measures, measureNotes) {
        // TODO Phase 3: store bounds, then re-render overlay if needed
        measuresRef.current     = measures
        measureNotesRef.current = measureNotes
      },

      highlightMeasure(_measureIndex) {
        const overlay = overlayCanvasRef.current
        if (!overlay) return
        const ctx = overlay.getContext('2d')
        if (!ctx) return

        // TODO Phase 6:
        //   1. ctx.clearRect(0, 0, overlay.width, overlay.height)
        //   2. Look up measuresRef.current[measureIndex]
        //   3. Draw highlight rectangle (rgba(255, 220, 0, 0.3))
        //   4. If showAnnotations.current: drawAnnotations(ctx, bounds, notes)
        //   5. scrollToMeasure(bounds)
      },

      setAnnotationsVisible(visible) {
        showAnnotations.current = visible
        // TODO Phase 6: re-draw the current measure with updated setting
      },

      async renderPage(pdf, pageIndex) {
        const canvas = pdfCanvasRef.current
        if (!canvas) return
        await pdf.renderPage(pageIndex, canvas)
      }
    }))
    

    return (
      <div id="sheet-container">
        <canvas ref={pdfCanvasRef}     id="pdf-canvas" />
        <canvas ref={overlayCanvasRef} id="overlay-canvas" />
      </div>
    )
  }
)

export default SheetViewer
