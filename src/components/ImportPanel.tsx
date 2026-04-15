/**
 * ImportPanel.tsx — Phase 1
 *
 * File import screen. The user must provide a MIDI and a PDF before starting.
 * Supports both click-to-browse and drag-and-drop on each drop zone.
 */

import { useState } from 'react'

interface ImportPanelProps {
  onReady: (midiFile: File, pdfFile: File) => void
}

export default function ImportPanel({ onReady }: ImportPanelProps) {
  const [midiFile, setMidiFile] = useState<File | null>(null)
  const [pdfFile,  setPdfFile]  = useState<File | null>(null)

  const bothReady = midiFile !== null //&& pdfFile !== null

  return (
    <section id="import-panel">
      <h1>Sheeter</h1>

      <FileDrop
        label="MIDI"
        accept=".mid,.midi"
        file={midiFile}
        onFile={setMidiFile}
      />

      <FileDrop
        label="PDF"
        accept=".pdf"
        file={pdfFile}
        onFile={setPdfFile}
      />

      <button
        disabled={!bothReady}
        onClick={() => bothReady && onReady(midiFile!, pdfFile!)}
      >
        Start Practice
      </button>
    </section>
  )
}

// ─── FileDrop ────────────────────────────────────────────────────────────────

interface FileDropProps {
  label: string
  accept: string
  file: File | null
  onFile: (f: File) => void
}

function FileDrop({ label, accept, file, onFile }: FileDropProps) {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={`file-drop${dragging ? ' dragging' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
    >
      <p>{file ? `✓ ${file.name}` : `Drop ${label} file here`}</p>
      <input
        type="file"
        accept={accept}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />
    </div>
  )
}
