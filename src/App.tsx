import { useState, useRef, useDeferredValue, useEffect } from 'react'
import ImportPanel from './components/ImportPanel'
import Feedback from './components/Feedback'
import SheetViewer, { type SheetViewerHandle } from './components/SheetViewer'
import { ParsedNote, parseMidi } from './modules/midiParser'
import { loadPDF, ProcessedPDF } from './modules/pdfProcessor'

type AppView = 'import' | 'practice'

export default function App() {
  const [view,      setView]     = useState<AppView>('import')
  const [midiFile,  setMidiFile] = useState<File | null>(null)
  const [pdfFile,   setPdfFile]  = useState<File | null>(null)
  const [processedPdf, setProcessedPdf] = useState<ProcessedPDF | null>(null)

  async function handleReady(midi: File, pdf: File) {
    const [score, PDF] = await Promise.all([
      parseMidi(midi),
      loadPDF(pdf)
    ])
    console.log(score)
    setMidiFile(midi)
    setPdfFile(pdf)
    setProcessedPdf(PDF)
    setView('practice')
  }

  if (view === 'practice' && midiFile && pdfFile) {
    return (
      <PracticeView
        midiFile={midiFile}
        pdfFile={pdfFile}
        pdf={processedPdf!}
        onBack={() => setView('import')}
      />
    )
  }

  return <ImportPanel onReady={handleReady} />
}

// ─── PracticeView ─────────────────────────────────────────────────────────────

interface PracticeViewProps {
  midiFile: File
  pdfFile: File
  pdf: ProcessedPDF
  onBack: () => void
}

function PracticeView({ pdf, onBack }: PracticeViewProps) {
  const viewerRef = useRef<SheetViewerHandle>(null)
  const [showAnnotations, setShowAnnotations] = useState(false)
  const [tempo, setTempo] = useState(100)

  // TODO Phase 6: replace with real ScoreSync output
  const [currentNotes] = useState<ParsedNote[]>([])
  const [nextNotes]    = useState<ParsedNote[]>([])
  const [isComplete]   = useState(false)

  function handleAnnotationsToggle(checked: boolean) {
    setShowAnnotations(checked)
    viewerRef.current?.setAnnotationsVisible(checked)
  }

  useEffect(() => {
    // Small timeout ensures the canvas ref is attached before we draw
    const id = setTimeout(() => {
      console.log('viewer ref:', viewerRef.current)
      console.log('pdf:', pdf)
      viewerRef.current?.renderPage(pdf, 0)
    }, 50)
    return () => clearTimeout(id)
  }, [])

  return (
    <div id="practice-view">
      <SheetViewer ref={viewerRef} showAnnotations={showAnnotations} />

      <Feedback
        currentNotes={currentNotes}
        nextNotes={nextNotes}
        isComplete={isComplete}
      />

      <div id="controls">
        <button>▶ Play Reference</button>
        <button>■ Stop</button>
        <button onClick={onBack}>← Back</button>

        <label>
          Tempo: <span>{tempo}%</span>
          <input
            type="range"
            min="25"
            max="150"
            value={tempo}
            onChange={e => setTempo(Number(e.target.value))}
          />
        </label>

        <label>
          <input
            type="checkbox"
            checked={showAnnotations}
            onChange={e => handleAnnotationsToggle(e.target.checked)}
          />
          Show note names
        </label>
      </div>
    </div>
  )
}
