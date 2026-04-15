/**
 * mic-test.ts
 *
 * A standalone test for microphone input and pitch detection.
 * This is NOT part of the main app — it's just for verifying things work.
 *
 * === What this file does ===
 * 1. Asks for mic permission
 * 2. Feeds audio into the Web Audio API
 * 3. Draws the frequency spectrum to a canvas (so you can SEE the sound)
 * 4. Finds peaks in the spectrum that correspond to musical notes
 * 5. Displays the detected note names
 *
 * === How audio analysis works ===
 *
 * The Web Audio API has an AnalyserNode.
 * It performs an FFT (Fast Fourier Transform) on the audio stream.
 * FFT turns a sound wave into a list of frequencies and their volumes (in dB).
 *
 * Example: you play an A4 note (440 Hz).
 * The FFT output will have a spike at 440 Hz (and smaller spikes at 880, 1320 Hz
 * — these are harmonics, also called overtones, and are normal for piano).
 *
 * To detect what note is playing:
 *   1. Find the frequency bins above a dB threshold (these are "loud" frequencies)
 *   2. Convert Hz → MIDI note number
 *   3. Those are your detected notes
 *
 * === Chord detection ===
 * A chord is just multiple notes at once, so multiple spikes in the FFT.
 * We find ALL spikes above the threshold, not just the loudest one.
 * The threshold slider controls how loud a spike must be to count.
 *
 * Challenge: piano harmonics (overtones) can be mistaken for real notes.
 * e.g. playing C3 will create a harmonic at G4. We need to be careful.
 * One strategy: only count notes if they're louder than nearby frequencies
 * (i.e., local peaks, not just any frequency above threshold).
 */

// =============================================
// DOM references
// =============================================
const startBtn = document.getElementById('start-btn') as HTMLButtonElement
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement
const freezeBtn = document.getElementById('freeze-btn') as HTMLButtonElement
// Method A
const spectrumCanvas = document.getElementById('spectrum-canvas') as HTMLCanvasElement
const notesPeak = document.getElementById('notes-peak') as HTMLDivElement
const thresholdSlider = document.getElementById('threshold') as HTMLInputElement
const thresholdDisplay = document.getElementById('threshold-display') as HTMLSpanElement
const prominenceSlider = document.getElementById('prominence') as HTMLInputElement
const prominenceDisplay = document.getElementById('prominence-display') as HTMLSpanElement
const harmonicsToggle = document.getElementById('harmonics-toggle') as HTMLInputElement
// Method B
const envelopeCanvas = document.getElementById('envelope-canvas') as HTMLCanvasElement
const notesEnvelope = document.getElementById('notes-envelope') as HTMLDivElement
const thresholdSliderB = document.getElementById('threshold-b') as HTMLInputElement
const thresholdDisplayB = document.getElementById('threshold-b-display') as HTMLSpanElement
const prominenceSliderB = document.getElementById('prominence-b') as HTMLInputElement
const prominenceDisplayB = document.getElementById('prominence-b-display') as HTMLSpanElement
const smoothingBassSlider = document.getElementById('smoothing-bass') as HTMLInputElement
const smoothingBassDisplay = document.getElementById('smoothing-bass-display') as HTMLSpanElement
const smoothingMidSlider = document.getElementById('smoothing-mid') as HTMLInputElement
const smoothingMidDisplay = document.getElementById('smoothing-mid-display') as HTMLSpanElement
const smoothingTrebleSlider = document.getElementById('smoothing-treble') as HTMLInputElement
const smoothingTrebleDisplay = document.getElementById('smoothing-treble-display') as HTMLSpanElement
const harmonicsToggleB = document.getElementById('harmonics-toggle-b') as HTMLInputElement
// Method C

const iterativeCanvas = document.getElementById('iterative-canvas') as HTMLCanvasElement
const notesIterative = document.getElementById('notes-iterative') as HTMLDivElement
const thresholdSliderC = document.getElementById('threshold-c') as HTMLInputElement
const thresholdDisplayC = document.getElementById('threshold-c-display') as HTMLSpanElement
const prominenceSliderC = document.getElementById('prominence-c') as HTMLInputElement
const prominenceDisplayC = document.getElementById('prominence-c-display') as HTMLSpanElement
const removalWidthSlider = document.getElementById('removal-width') as HTMLInputElement
const removalWidthDisplay = document.getElementById('removal-width-display') as HTMLSpanElement
const maxNotesSlider = document.getElementById('max-notes') as HTMLInputElement
const maxNotesDisplay = document.getElementById('max-notes-display') as HTMLSpanElement
// Method D
const cqtCanvas = document.getElementById('cqt-canvas') as HTMLCanvasElement
const notesCqt = document.getElementById('notes-cqt') as HTMLDivElement
const thresholdSliderD = document.getElementById('threshold-d') as HTMLInputElement
const thresholdDisplayD = document.getElementById('threshold-d-display') as HTMLSpanElement
const prominenceSliderD = document.getElementById('prominence-d') as HTMLInputElement
const prominenceDisplayD = document.getElementById('prominence-d-display') as HTMLSpanElement
const harmonicsToggleD = document.getElementById('harmonics-toggle-d') as HTMLInputElement
// Chord test
const chordBtn1 = document.getElementById('chord-btn-1') as HTMLButtonElement
const chordBtn2 = document.getElementById('chord-btn-2') as HTMLButtonElement
const chordStatus = document.getElementById('chord-status') as HTMLSpanElement
const blockA = document.getElementById('block-a') as HTMLDivElement
const blockB = document.getElementById('block-b') as HTMLDivElement
const blockC = document.getElementById('block-c') as HTMLDivElement
const blockD = document.getElementById('block-d') as HTMLDivElement
// Sequence detection
const seqToggleBtn = document.getElementById('seq-toggle-btn') as HTMLButtonElement
const seqResetBtn = document.getElementById('seq-reset-btn') as HTMLButtonElement
const seqProgress = document.getElementById('seq-progress') as HTMLSpanElement
const seqNextEl = document.getElementById('seq-next') as HTMLDivElement
const seqHitFill = document.getElementById('seq-hit-fill') as HTMLDivElement
const seqList = document.getElementById('seq-list') as HTMLDivElement
// Shared
const logEl = document.getElementById('log') as HTMLDivElement

const ctx = spectrumCanvas.getContext('2d')!
const ctxEnv = envelopeCanvas.getContext('2d')!
const ctxIter = iterativeCanvas.getContext('2d')!
const ctxCqt = cqtCanvas.getContext('2d')!

// Display range: A0 to A7
const MIN_FREQ = 27.5    // A0 Hz
const MAX_FREQ = 3520.0  // A7 Hz
const LABEL_HEIGHT = 30  // px reserved at bottom of each canvas for note labels

// Notes to label along the x-axis — musically meaningful landmarks
const LABEL_NOTES: { name: string; hz: number }[] = [
  { name: 'A0', hz: 27.50 },
  { name: 'C1', hz: 32.70 },
  { name: 'C2', hz: 65.41 },
  { name: 'C3', hz: 130.81 },
  { name: 'C4', hz: 261.63 },  // middle C
  { name: 'C5', hz: 523.25 },
  { name: 'C6', hz: 1046.50 },
  { name: 'C7', hz: 2093.00 },
  { name: 'A7', hz: 3520.00 },
]

/**
 * Draw note name labels along the bottom of a canvas.
 * Each label is positioned at the x coordinate matching its frequency.
 */
function drawNoteLabels(c: CanvasRenderingContext2D, width: number, height: number, hzPerBin: number): void {
  const minBin = MIN_FREQ / hzPerBin
  const maxBin = MAX_FREQ / hzPerBin
  const specHeight = height - LABEL_HEIGHT

  c.font = '10px monospace'
  c.textAlign = 'center'

  for (const note of LABEL_NOTES) {
    const bin = note.hz / hzPerBin
    const x = ((bin - minBin) / (maxBin - minBin)) * width

    // Tick mark at the boundary between spectrum and label area
    c.strokeStyle = 'rgba(180, 180, 180, 0.5)'
    c.beginPath()
    c.moveTo(x, specHeight)
    c.lineTo(x, specHeight + 5)
    c.stroke()

    // Note name
    c.fillStyle = note.name.startsWith('C4') ? '#fff' : 'rgba(180, 180, 180, 0.8)'
    c.fillText(note.name, x, height - 5)
  }
}

/**
 * Draw CQT note labels along the bottom of a canvas.
 * Used by all four methods since they all operate in semitone (CQT) space.
 */
function drawCQTLabels(c: CanvasRenderingContext2D, width: number, height: number): void {
  const barWidth = width / CQT_NUM_BINS
  const specH = height - LABEL_HEIGHT
  c.font = '10px monospace'
  c.textAlign = 'center'
  for (const label of CQT_LABELS) {
    const x = (label.bin + 0.5) * barWidth
    c.strokeStyle = 'rgba(180, 180, 180, 0.5)'
    c.beginPath()
    c.moveTo(x, specH)
    c.lineTo(x, specH + 5)
    c.stroke()
    c.fillStyle = label.name === 'C4' ? '#fff' : 'rgba(180, 180, 180, 0.8)'
    c.fillText(label.name, x, height - 5)
  }
}

// =============================================
// Chord test targets
// =============================================

const CHORD_TARGETS = [
  // Mid-range chord — good baseline test
  { label: 'B4 D5 G5', notes: [71, 74, 79] },
  // Three octaves of A — spans bass, mid, treble simultaneously
  { label: 'A2 A4 A6', notes: [45, 69, 93] },
] as const

// =============================================
// Sequence detection events
// =============================================

const SEQ_EVENTS: { label: string; notes: number[] }[] = [
  { label: 'A4', notes: [69] },
  { label: 'C#5', notes: [73] },
  { label: 'A5 + F#2', notes: [81, 42] },
  { label: 'G#5 + C#3', notes: [80, 49] },
  { label: 'A5 + F#3', notes: [81, 54] },
  { label: 'G#5', notes: [80] },
  { label: 'A5 + E2', notes: [81, 40] },
  { label: 'E5 + B2', notes: [76, 47] },
  { label: 'F#3 + A5', notes: [54, 81] },
]

// Frames of sustained detection needed before advancing to the next event
const SEQ_ADVANCE_FRAMES = 8
// Grace period after D advances: A/C keep checking the just-played event,
// verdicts are recorded when this expires (gives slower methods time to catch up)
const SEQ_GAP_FRAMES = 40

// =============================================
// State
// =============================================
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let stream: MediaStream | null = null
let animationId: number | null = null
let frozenData: Float32Array | null = null  // non-null = spectrum is frozen

let armedChordIndex: number | null = null
// Per-method confidence counters (A=0, B=1, C=2, D=3); matched when >= 25
const methodConfidence = [0, 0, 0, 0]
const CHORD_CONFIDENCE_MAX = 30
const CHORD_CONFIDENCE_MATCH = 25

let seqActive = false
let seqIndex = 0        // which event we're waiting for next
let seqHitFrames = 0    // consecutive frames current event was detected
let seqGapRemaining = 0 // grace/gap frames remaining after an advance

// Grace state — saved when D advances so A/C can keep checking the just-played event
let seqGraceNotes: number[] | null = null
let seqGraceLabel = ''
let seqGraceNum = 0

// Per-method hit counters for current seq event (A=0, B=1 unused, C=2, D=3)
const methodSeqHit = [0, 0, 0, 0]

// =============================================
// Note name lookup
// =============================================
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * Convert a frequency (Hz) to a MIDI note number.
 */
function hzToMidi(hz: number): number {
  const midi = Math.round(12 * Math.log2(hz / 440) + 69) //midi = 12 × log₂(hz / 440) + 69
  return midi
}

/**
 * Convert a MIDI note number to a readable name like "C4" or "F#3".
 */
function midiToName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1
  const semitone = midi % 12
  const name = NOTE_NAMES[semitone] + octave
  return name
}

// =============================================
// Start / Stop
// =============================================

startBtn.addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioContext = new AudioContext();

    analyser = audioContext.createAnalyser()
    analyser.fftSize = 16384
    analyser.smoothingTimeConstant = 0.0 // smooths out jitter (0=none, 1=max)

    audioContext.createMediaStreamSource(stream).connect(analyser)
    startBtn.disabled = true;
    stopBtn.disabled = false;

    startDrawLoop()

    log('Microphone started.')
  } catch (err) {
    log(`Error: ${err}`)
  }
})

stopBtn.addEventListener('click', () => {
  if (animationId != null) {
    cancelAnimationFrame(animationId);
  }
  if (stream != null) {
    stream.getTracks().forEach(t => t.stop());
  }
  if (audioContext != null) {
    audioContext.close();
  }
  startBtn.disabled = false;
  stopBtn.disabled = true;
  log('Stopped.')
})

// =============================================
// Draw loop — runs every animation frame (~60fps)
// =============================================

function startDrawLoop(): void {
  if (!analyser) return

  // The frequency data array — one value per FFT bin, in decibels (dB)
  // Length = analyser.frequencyBinCount = fftSize / 2
  const dataArray = new Float32Array(analyser.frequencyBinCount)

  function draw() {
    animationId = requestAnimationFrame(draw)

    // Fill dataArray — use frozen snapshot if one exists, otherwise live mic data
    if (frozenData) {
      dataArray.set(frozenData)
    } else {
      analyser!.getFloatFrequencyData(dataArray)
    }

    // --- Compute CQT once — all four methods share this ---
    const cqt = computeCQT(dataArray)

    // --- Method A ---
    drawSpectrum(cqt)
    const threshold = parseFloat(thresholdSlider.value)
    const detectedPeak = detectNotes(cqt, threshold)
    notesPeak.textContent = detectedPeak.length > 0 ? detectedPeak.join('  ') : '—'
    tickChordMatch(0, blockA, detectedPeak)
    tickSeqMethodMatch(0, blockA, detectedPeak)

    // --- Method B (hidden) ---
    // tickChordMatch(1, blockB, [])  // skipped

    // --- Method C ---
    const thresholdC = parseFloat(thresholdSliderC.value)
    const prominenceC = parseFloat(prominenceSliderC.value)
    const removalRatio = parseFloat(removalWidthSlider.value) / 100
    const maxNotes = parseInt(maxNotesSlider.value)
    drawIterativeSpectrum(cqt, thresholdC, prominenceC, removalRatio, maxNotes)
    const detectedIterative = detectNotesIterative(cqt, thresholdC, prominenceC, removalRatio, maxNotes)
    notesIterative.textContent = detectedIterative.length > 0 ? detectedIterative.join('  ') : '—'
    tickChordMatch(2, blockC, detectedIterative)
    tickSeqMethodMatch(2, blockC, detectedIterative)

    // --- Method D ---
    const thresholdD = parseFloat(thresholdSliderD.value)
    const prominenceD = parseFloat(prominenceSliderD.value)
    drawCQTSpectrum(cqt, thresholdD, prominenceD)
    const detectedCqt = detectNotesCQT(cqt, thresholdD, prominenceD, harmonicsToggleD.checked)
    notesCqt.textContent = detectedCqt.length > 0 ? detectedCqt.join('  ') : '—'
    tickChordMatch(3, blockD, detectedCqt)
    tickSeqMethodMatch(3, blockD, detectedCqt)

    // --- Update chord status label ---
    if (armedChordIndex !== null) {
      const anyMatch = methodConfidence.some(c => c >= CHORD_CONFIDENCE_MATCH)
      chordStatus.textContent = anyMatch
        ? `✓ ${CHORD_TARGETS[armedChordIndex].label}`
        : `Listening for ${CHORD_TARGETS[armedChordIndex].label}…`
    }

    // --- Sequence detection ---
    tickSequence(cqt)
  }

  draw()
}

// =============================================
// Spectrum visualiser
// =============================================

function drawSpectrum(cqt: Float32Array): void {
  const width = spectrumCanvas.width
  const height = spectrumCanvas.height

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  // TODO: draw the frequency spectrum as vertical bars
  //
  // Each index i in dataArray corresponds to a frequency:
  //   freq = i × (audioContext!.sampleRate / analyser!.fftSize)
  //
  // dataArray[i] is the volume in dB (typically -100 to 0)
  // Map -100 dB → bar height 0,  0 dB → bar height = canvas height
  //
  // You probably only want to show up to ~4000 Hz (piano range is ~27–4200 Hz)
  // so only draw the first portion of the array.
  //
  // Hint: barWidth = width / numBarsToShow
  //       barHeight = ((dataArray[i] + 100) / 100) * height
  //       ctx.fillStyle = '#0f0'  (or colour by frequency)
  //       ctx.fillRect(x, height - barHeight, barWidth, barHeight)

  const barWidth = width / CQT_NUM_BINS
  const specH = height - LABEL_HEIGHT

  // Green bars — one per semitone (A0–C8)
  for (let n = 0; n < CQT_NUM_BINS; n++) {
    const barHeight = ((cqt[n] + 100) / 100) * specH
    ctx.fillStyle = '#0f0'
    ctx.fillRect(n * barWidth, specH - barHeight, barWidth, barHeight)
  }

  // Red — noise floor
  const threshold = parseFloat(thresholdSlider.value)
  const thresholdY = specH - ((threshold + 100) / 100) * specH
  ctx.strokeStyle = 'rgba(255, 100, 100, 0.7)'
  ctx.beginPath()
  ctx.moveTo(0, thresholdY)
  ctx.lineTo(width, thresholdY)
  ctx.stroke()

  // Yellow = local average,  Orange = local average + prominence
  // Window is in semitones — uniform across all registers (unlike Hz-based window)
  const semitoneWindow = 6
  const prominence = parseFloat(prominenceSlider.value)

  ctx.beginPath()
  let firstAvg = true
  ctx.strokeStyle = 'rgba(255, 220, 0, 0.5)'
  for (let n = 0; n < CQT_NUM_BINS; n++) {
    const lo = Math.max(0, n - semitoneWindow)
    const hi = Math.min(CQT_NUM_BINS - 1, n + semitoneWindow)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += cqt[k]
    const y = specH - ((sum / (hi - lo + 1) + 100) / 100) * specH
    const x = (n + 0.5) * barWidth
    if (firstAvg) { ctx.moveTo(x, y); firstAvg = false } else ctx.lineTo(x, y)
  }
  ctx.stroke()

  ctx.beginPath()
  let firstProm = true
  ctx.strokeStyle = 'rgba(255, 160, 0, 0.9)'
  for (let n = 0; n < CQT_NUM_BINS; n++) {
    const lo = Math.max(0, n - semitoneWindow)
    const hi = Math.min(CQT_NUM_BINS - 1, n + semitoneWindow)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += cqt[k]
    const y = specH - ((sum / (hi - lo + 1) + prominence + 100) / 100) * specH
    const x = (n + 0.5) * barWidth
    if (firstProm) { ctx.moveTo(x, y); firstProm = false } else ctx.lineTo(x, y)
  }
  ctx.stroke()

  drawCQTLabels(ctx, width, height)
}

// =============================================
// Note detection
// =============================================

/**
 * TODO: Find all musical notes currently being played.
 *
 * Steps:
 *   1. Calculate the frequency for each FFT bin:
 *      freq = binIndex × (sampleRate / fftSize)
 *      Only care about bins in the piano range: ~27 Hz (A0) to ~4200 Hz (C8)
 *
 *   2. Find LOCAL PEAKS above the threshold
 *      A local peak at index i means: dataArray[i] > threshold
 *      AND dataArray[i] > dataArray[i-1]
 *      AND dataArray[i] > dataArray[i+1]
 *      (This filters out harmonics that aren't the dominant frequency in their region)
 *
 *   3. Convert each peak's bin index → Hz → MIDI note number
 *
 *   4. Deduplicate: multiple bins can map to the same MIDI note
 *      Use a Set<number> to track which MIDI notes you've already added
 *
 *   5. Return the note names as strings (e.g. ["C4", "E4", "G4"])
 *
 * Things to watch out for:
 *   - Very low frequencies (below A0 = MIDI 21) should be ignored
 *   - Very high frequencies (above C8 = MIDI 108) should be ignored
 *   - Piano harmonics: if you detect C3 + G4, the G4 might be a harmonic of C3
 *     For now, don't worry about this — just detect everything and tune the threshold
 */
function detectNotes(cqt: Float32Array, noiseFloorDb: number): string[] {
  const prominence = parseFloat(prominenceSlider.value)
  // ±6 semitones — uniform window in CQT space (same for bass and treble)
  const semitoneWindow = 6

  const peaks: { midi: number; hz: number }[] = []
  const seenMidi = new Set<number>()

  for (let n = 1; n < CQT_NUM_BINS - 1; n++) {
    const db = cqt[n]
    if (db < noiseFloorDb) continue
    if (db <= cqt[n - 1] || db <= cqt[n + 1]) continue

    const lo = Math.max(0, n - semitoneWindow)
    const hi = Math.min(CQT_NUM_BINS - 1, n + semitoneWindow)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += cqt[k]
    if (db - sum / (hi - lo + 1) < prominence) continue

    const midi = CQT_MIDI_MIN + n
    if (seenMidi.has(midi)) continue
    seenMidi.add(midi)

    const hz = 440 * Math.pow(2, (midi - 69) / 12)
    peaks.push({ midi, hz })
  }

  peaks.sort((a, b) => a.hz - b.hz)
  const finalPeaks = harmonicsToggle.checked ? suppressHarmonics(peaks) : peaks
  return finalPeaks.map(p => midiToName(p.midi))
}

/**
 * Removes peaks that are harmonics of a lower detected peak.
 *
 * For each low note (fundamental), its harmonics occur at integer multiples
 * of its frequency: 2×, 3×, 4×, 5×...
 * If a higher detected peak falls within ±toleranceHz of one of those
 * multiples, it's an overtone — not a real note being played.
 *
 * We work in Hz (not MIDI) because harmonic ratios are exact frequency
 * multiples, but they don't land precisely on equal-temperament semitones.
 */
function suppressHarmonics(
  peaks: { midi: number; hz: number }[]
): { midi: number; hz: number }[] {
  const toleranceHz = 15  // how close a peak must be to a harmonic to be removed
  const maxHarmonic = 8   // check up to the 8th harmonic (covers most piano overtones)
  const isHarmonic = new Set<number>()  // tracks midi numbers flagged as harmonics

  for (let i = 0; i < peaks.length; i++) {
    if (isHarmonic.has(peaks[i].midi)) continue  // skip, this one is already flagged

    const fundamental = peaks[i].hz

    // Check every higher peak against this fundamental's harmonic series
    for (let j = i + 1; j < peaks.length; j++) {
      const candidate = peaks[j].hz

      for (let n = 2; n <= maxHarmonic; n++) {
        const harmonicHz = fundamental * n
        // Scale tolerance with harmonic number — higher harmonics drift further
        // from perfect integer multiples due to piano string inharmonicity
        if (Math.abs(candidate - harmonicHz) < toleranceHz * Math.sqrt(n)) {
          isHarmonic.add(peaks[j].midi)
          break
        }
      }
    }
  }

  return peaks.filter(p => !isHarmonic.has(p.midi))
}

// =============================================
// Method B: Spectral Envelope detection
// =============================================

/**
 * Alternative detection approach: smooth the spectrum first, then find peaks.
 *
 * Instead of finding raw peaks and then removing harmonics after the fact,
 * this method averages the spectrum over a wide-enough window that the harmonic
 * series of each note blends into one broad hump. The peaks of that smooth curve
 * are the played notes — harmonics were never visible to begin with.
 *
 * Window size trade-off:
 *   Too narrow → harmonics still show as separate peaks
 *   Too wide   → adjacent notes merge into one hump
 *   ~150 Hz works reasonably across the piano range
 */
/**
 * Build the smoothed envelope using proportional-bandwidth smoothing.
 *
 * smoothingRatio: window width as a fraction of the bin's own frequency.
 *   e.g. 0.5 = window is ±50% of the current frequency at every point.
 *
 * For bin i at frequency f = i × hzPerBin:
 *   windowBins = round(f × smoothingRatio / hzPerBin)
 *              = round(i × smoothingRatio)        ← simplifies nicely
 *
 * This means the window grows proportionally with frequency, matching how
 * harmonic spacing also grows proportionally — so the blur always covers
 * roughly the same number of harmonics regardless of register.
 */
// Crossover frequencies for the three smoothing bands (fixed at musical boundaries)
const BAND_C3 = 130.81  // Hz
const BAND_C6 = 1046.50 // Hz

/**
 * Interpolate the smoothing ratio for a given frequency.
 * Linearly blends between bass/mid/treble ratios at the band boundaries.
 */
function smoothingRatioAt(hz: number, bassRatio: number, midRatio: number, trebleRatio: number): number {
  if (hz <= BAND_C3) {
    const t = (hz - 27.5) / (BAND_C3 - 27.5)
    return bassRatio + (midRatio - bassRatio) * Math.max(0, Math.min(1, t))
  }
  if (hz <= BAND_C6) {
    const t = (hz - BAND_C3) / (BAND_C6 - BAND_C3)
    return midRatio + (trebleRatio - midRatio) * Math.max(0, Math.min(1, t))
  }
  return trebleRatio
}

function buildEnvelope(
  cqt: Float32Array,
  bassRatio: number, midRatio: number, trebleRatio: number,
): Float32Array {
  // In CQT space, each bin is one semitone, so the smoothing window is in semitones.
  // The slider values (0–1.5 after /100) are scaled to a semitone count:
  //   ratio=0.8 → 10 semitones,  ratio=0.3 → 4,  ratio=0.15 → 2
  const envelope = new Float32Array(CQT_NUM_BINS)
  for (let n = 0; n < CQT_NUM_BINS; n++) {
    // Pick the smoothing ratio for this bin's register (A0–C3 / C3–C6 / C6–C8)
    const ratio = n <= 27 ? bassRatio : n <= 63 ? midRatio : trebleRatio
    const semitoneWin = Math.max(1, Math.round(ratio * 12))
    const lo = Math.max(0, n - semitoneWin)
    const hi = Math.min(CQT_NUM_BINS - 1, n + semitoneWin)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += cqt[k]
    envelope[n] = sum / (hi - lo + 1)
  }
  return envelope
}

function detectNotesEnvelope(
  cqt: Float32Array,
  noiseFloorDb: number,
  prominence: number,
  bassRatio: number, midRatio: number, trebleRatio: number,
  suppressHarmonicsB: boolean,
): string[] {
  const envelope = buildEnvelope(cqt, bassRatio, midRatio, trebleRatio)
  const semitoneWindow = 6

  const seenMidi = new Set<number>()
  const peaks: { midi: number; hz: number }[] = []

  for (let n = 1; n < CQT_NUM_BINS - 1; n++) {
    const db = envelope[n]
    if (db < noiseFloorDb) continue
    if (db <= envelope[n - 1] || db <= envelope[n + 1]) continue

    const lo = Math.max(0, n - semitoneWindow)
    const hi = Math.min(CQT_NUM_BINS - 1, n + semitoneWindow)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += envelope[k]
    if (db - sum / (hi - lo + 1) < prominence) continue

    const midi = CQT_MIDI_MIN + n
    if (seenMidi.has(midi)) continue
    seenMidi.add(midi)
    const hz = 440 * Math.pow(2, (midi - 69) / 12)
    peaks.push({ midi, hz })
  }

  peaks.sort((a, b) => a.hz - b.hz)
  const finalPeaks = suppressHarmonicsB ? suppressHarmonics(peaks) : peaks
  return finalPeaks.map(p => midiToName(p.midi))
}

function drawEnvelopeSpectrum(
  cqt: Float32Array,
  noiseFloorDb: number,
  prominence: number,
  bassRatio: number, midRatio: number, trebleRatio: number,
): void {
  const width = envelopeCanvas.width
  const height = envelopeCanvas.height
  const barWidth = width / CQT_NUM_BINS
  const specH = height - LABEL_HEIGHT
  const envelope = buildEnvelope(cqt, bassRatio, midRatio, trebleRatio)

  ctxEnv.clearRect(0, 0, width, height)
  ctxEnv.fillStyle = '#000'
  ctxEnv.fillRect(0, 0, width, height)

  // Dark green — raw CQT underneath
  for (let n = 0; n < CQT_NUM_BINS; n++) {
    const barHeight = ((cqt[n] + 100) / 100) * specH
    ctxEnv.fillStyle = '#1a5e1a'
    ctxEnv.fillRect(n * barWidth, specH - barHeight, barWidth, barHeight)
  }

  // Semi-transparent cyan — smoothed envelope on top
  for (let n = 0; n < CQT_NUM_BINS; n++) {
    const barHeight = ((envelope[n] + 100) / 100) * specH
    ctxEnv.fillStyle = 'rgba(0, 188, 212, 0.6)'
    ctxEnv.fillRect(n * barWidth, specH - barHeight, barWidth, barHeight)
  }

  // Red — noise floor
  const floorY = specH - ((noiseFloorDb + 100) / 100) * specH
  ctxEnv.strokeStyle = 'rgba(255, 100, 100, 0.8)'
  ctxEnv.beginPath()
  ctxEnv.moveTo(0, floorY)
  ctxEnv.lineTo(width, floorY)
  ctxEnv.stroke()

  // Orange — local avg + prominence threshold (±6 semitone window in CQT space)
  const semitoneWindow = 6
  ctxEnv.beginPath()
  let first = true
  ctxEnv.strokeStyle = 'rgba(255, 160, 0, 0.9)'
  for (let n = 0; n < CQT_NUM_BINS; n++) {
    const lo = Math.max(0, n - semitoneWindow)
    const hi = Math.min(CQT_NUM_BINS - 1, n + semitoneWindow)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += envelope[k]
    const localAvg = sum / (hi - lo + 1)
    const x = (n + 0.5) * barWidth
    const y = specH - ((localAvg + prominence + 100) / 100) * specH
    if (first) { ctxEnv.moveTo(x, y); first = false } else ctxEnv.lineTo(x, y)
  }
  ctxEnv.stroke()

  drawCQTLabels(ctxEnv, width, height)
}

// =============================================
// Method C: Iterative Harmonic Suppression
// =============================================

/**
 * Core iterative algorithm — shared by detection and drawing.
 *
 * Each iteration:
 *   1. Find the single loudest local peak above the noise floor + prominence
 *   2. Record it as a detected note
 *   3. Zero out that frequency AND all its harmonics (n×2, n×3 ... n×8)
 *      in a working copy of the spectrum
 *   4. Repeat on the now-cleaner residual
 *
 * Because we process the strongest note first and physically remove its
 * harmonic series before looking for the next note, harmonics of loud bass
 * notes can never be mistaken for quieter treble notes — the key weakness
 * of the single-pass approaches in Methods A and B.
 */
interface IterativeResult {
  notes: { midi: number; hz: number }[]
  removedBins: number[]    // CQT bin indices zeroed out (for visualisation)
  fundamentalBins: number[] // winning bin per iteration
}

// Harmonic offsets in semitones for n = 2..8 integer harmonics
// e.g. 2nd harmonic = 2× freq = exactly 12 semitones up
const HARMONIC_SEMITONE_OFFSETS = [12, 19, 24, 28, 31, 34, 36]

function runIterative(
  cqt: Float32Array,
  noiseFloorDb: number,
  prominence: number,
  removalRatio: number,
  maxNotes: number,
): IterativeResult {
  // Work on a mutable copy — the original cqt is never modified
  const spectrum = Float32Array.from(cqt)

  const notes: { midi: number; hz: number }[] = []
  const removedBins: number[] = []
  const fundamentalBins: number[] = []
  const seenMidi = new Set<number>()

  // removalRatio (0.01–0.50) → how many semitone bins to wipe either side of a harmonic
  const removalHalfWidth = Math.max(1, Math.round(removalRatio * 10))
  const semitoneWindow = 6

  for (let iter = 0; iter < maxNotes; iter++) {
    // --- Find the loudest prominent local peak in the residual ---
    let bestBin = -1
    let bestDb = -Infinity

    for (let n = 1; n < CQT_NUM_BINS - 1; n++) {
      const db = spectrum[n]
      if (db < noiseFloorDb) continue
      if (db <= spectrum[n - 1] || db <= spectrum[n + 1]) continue

      // Prominence: ±6 semitones — uniform window regardless of register
      const lo = Math.max(0, n - semitoneWindow)
      const hi = Math.min(CQT_NUM_BINS - 1, n + semitoneWindow)
      let sum = 0
      for (let k = lo; k <= hi; k++) sum += spectrum[k]
      if (db - sum / (hi - lo + 1) < prominence) continue

      if (db > bestDb) { bestDb = db; bestBin = n }
    }

    if (bestBin === -1) break

    const midi = CQT_MIDI_MIN + bestBin
    if (seenMidi.has(midi)) break
    seenMidi.add(midi)

    const hz = 440 * Math.pow(2, (midi - 69) / 12)
    notes.push({ midi, hz })
    fundamentalBins.push(bestBin)

    // --- Remove fundamental + harmonics using semitone offsets ---
    for (const offset of [0, ...HARMONIC_SEMITONE_OFFSETS]) {
      const harmonicBin = bestBin + offset
      if (harmonicBin >= CQT_NUM_BINS) break
      const lo = Math.max(0, harmonicBin - removalHalfWidth)
      const hi = Math.min(CQT_NUM_BINS - 1, harmonicBin + removalHalfWidth)
      for (let k = lo; k <= hi; k++) {
        removedBins.push(k)
        spectrum[k] = noiseFloorDb - 20
      }
    }
  }

  notes.sort((a, b) => a.hz - b.hz)
  return { notes, removedBins, fundamentalBins }
}

function detectNotesIterative(
  cqt: Float32Array,
  noiseFloorDb: number,
  prominence: number,
  removalRatio: number,
  maxNotes: number,
): string[] {
  const { notes } = runIterative(cqt, noiseFloorDb, prominence, removalRatio, maxNotes)
  return notes.map(p => midiToName(p.midi))
}

function drawIterativeSpectrum(
  cqt: Float32Array,
  noiseFloorDb: number,
  prominence: number,
  removalRatio: number,
  maxNotes: number,
): void {
  const width = iterativeCanvas.width
  const height = iterativeCanvas.height
  const barWidth = width / CQT_NUM_BINS
  const specH = height - LABEL_HEIGHT

  const { removedBins, fundamentalBins } =
    runIterative(cqt, noiseFloorDb, prominence, removalRatio, maxNotes)

  const removedSet = new Set(removedBins)

  ctxIter.clearRect(0, 0, width, height)
  ctxIter.fillStyle = '#000'
  ctxIter.fillRect(0, 0, width, height)

  // Purple = removed harmonic region,  green = untouched
  for (let n = 0; n < CQT_NUM_BINS; n++) {
    const barHeight = ((cqt[n] + 100) / 100) * specH
    ctxIter.fillStyle = removedSet.has(n) ? 'rgba(180, 80, 200, 0.6)' : '#1a5e1a'
    ctxIter.fillRect(n * barWidth, specH - barHeight, barWidth, barHeight)
  }

  // White vertical markers at each detected fundamental
  for (const bin of fundamentalBins) {
    const x = (bin + 0.5) * barWidth
    ctxIter.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctxIter.lineWidth = 1.5
    ctxIter.beginPath()
    ctxIter.moveTo(x, 0)
    ctxIter.lineTo(x, specH)
    ctxIter.stroke()
    ctxIter.lineWidth = 1
  }

  // Red — noise floor
  const floorY = specH - ((noiseFloorDb + 100) / 100) * specH
  ctxIter.strokeStyle = 'rgba(255, 100, 100, 0.7)'
  ctxIter.beginPath()
  ctxIter.moveTo(0, floorY)
  ctxIter.lineTo(width, floorY)
  ctxIter.stroke()

  drawCQTLabels(ctxIter, width, height)
}

// =============================================
// Method D: Constant-Q Transform (CQT)
// =============================================

/**
 * CQT gives one output bin per semitone across the full piano range (A0–C8, 88 notes).
 * Unlike FFT which spaces bins linearly in Hz, CQT spaces them logarithmically —
 * each semitone gets the same width regardless of register.
 *
 * === How we compute it from FFT output ===
 *
 * For each semitone k, its center frequency is:
 *   f_k = 440 × 2^((midi - 69) / 12)
 *
 * The Q factor defines how wide each bin is relative to its frequency:
 *   Q = 1 / (2^(1/12) - 1) ≈ 17.0
 *   bandwidth_k = f_k / Q
 *
 * We compute the CQT bin by doing a Hann-windowed weighted average of the FFT
 * bins that fall within [f_k - bandwidth/2, f_k + bandwidth/2].
 * Working in linear magnitude (not dB) before averaging, then converting back.
 *
 * === Why this is better for bass ===
 *
 * At A1 (110 Hz) with fftSize=8192 and sampleRate=48000:
 *   FFT: one semitone ≈ 6.5 Hz ≈ 1 FFT bin   ← barely one bin per note
 *   CQT: always exactly 1 bin per semitone, properly windowed
 *
 * Bass notes that were smeared across 1-2 FFT bins each get a clean,
 * well-resolved CQT bin with proper frequency separation.
 */

// CQT constant — 12 bins per octave gives Q ≈ 17
const CQT_Q = 1 / (Math.pow(2, 1 / 12) - 1)  // ≈ 17.0

// MIDI range for 88 piano keys
const CQT_MIDI_MIN = 21   // A0
const CQT_MIDI_MAX = 108  // C8
const CQT_NUM_BINS = CQT_MIDI_MAX - CQT_MIDI_MIN + 1  // 88

// CQT label positions — bin index (0-based from A0) for each label
const CQT_LABELS: { name: string; bin: number }[] = [
  { name: 'A0', bin: 0 },
  { name: 'C1', bin: 3 },
  { name: 'C2', bin: 15 },
  { name: 'C3', bin: 27 },
  { name: 'C4', bin: 39 },  // middle C
  { name: 'C5', bin: 51 },
  { name: 'C6', bin: 63 },
  { name: 'C7', bin: 75 },
  { name: 'C8', bin: 87 },
]

/**
 * Compute 88 CQT bins from FFT magnitude data.
 * Returns dB values, one per piano key (index 0 = A0, index 87 = C8).
 */
function computeCQT(dataArray: Float32Array): Float32Array {
  if (!audioContext || !analyser) return new Float32Array(CQT_NUM_BINS).fill(-100)

  const hzPerBin = audioContext.sampleRate / analyser.fftSize
  const cqt = new Float32Array(CQT_NUM_BINS)

  for (let n = 0; n < CQT_NUM_BINS; n++) {
    const midi = CQT_MIDI_MIN + n
    const fk = 440 * Math.pow(2, (midi - 69) / 12)  // center frequency
    const bw = fk / CQT_Q                             // CQT bin bandwidth
    const loHz = fk - bw / 2
    const hiHz = fk + bw / 2
    const loBin = Math.max(0, Math.floor(loHz / hzPerBin))
    const hiBin = Math.min(dataArray.length - 1, Math.ceil(hiHz / hzPerBin))

    let weightedSum = 0
    let totalWeight = 0

    for (let i = loBin; i <= hiBin; i++) {
      const binHz = i * hzPerBin
      const t = (binHz - fk) / (bw / 2)
      if (Math.abs(t) > 1) continue

      // Hann window weight — peaks at centre, tapers to 0 at edges
      const weight = 0.5 * (1 + Math.cos(Math.PI * t))

      // Convert dB → linear magnitude for proper averaging
      const linear = Math.pow(10, dataArray[i] / 20)
      weightedSum += weight * linear
      totalWeight += weight
    }

    // Convert weighted average back to dB
    cqt[n] = totalWeight > 0
      ? 20 * Math.log10(Math.max(weightedSum / totalWeight, 1e-10))
      : -100
  }

  return cqt
}

/**
 * Detect notes from the 88-bin CQT array.
 * Much simpler than FFT detection — each bin IS already a semitone,
 * so no Hz→MIDI conversion is needed.
 * Prominence window is in semitones (not Hz), so it's uniform across registers.
 */
function detectNotesCQT(
  cqt: Float32Array,
  noiseFloorDb: number,
  prominence: number,
  suppressHarmonicsOn: boolean,
): string[] {
  // Prominence window: ±6 semitones (half an octave either side)
  const semitoneWindow = 6

  const peaks: { midi: number; hz: number }[] = []
  const seenMidi = new Set<number>()

  for (let n = 1; n < CQT_NUM_BINS - 1; n++) {
    const db = cqt[n]
    if (db < noiseFloorDb) continue
    if (db <= cqt[n - 1] || db <= cqt[n + 1]) continue  // must be local peak

    // Prominence: must stand out above the average of ±semitoneWindow bins
    const lo = Math.max(0, n - semitoneWindow)
    const hi = Math.min(CQT_NUM_BINS - 1, n + semitoneWindow)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += cqt[k]
    if (db - sum / (hi - lo + 1) < prominence) continue

    const midi = CQT_MIDI_MIN + n
    if (seenMidi.has(midi)) continue
    seenMidi.add(midi)

    const hz = 440 * Math.pow(2, (midi - 69) / 12)
    peaks.push({ midi, hz })
  }

  peaks.sort((a, b) => a.hz - b.hz)
  const finalPeaks = suppressHarmonicsOn ? suppressHarmonics(peaks) : peaks
  return finalPeaks.map(p => midiToName(p.midi))
}

function drawCQTSpectrum(
  cqt: Float32Array,
  noiseFloorDb: number,
  prominence: number,
): void {
  const width = cqtCanvas.width
  const height = cqtCanvas.height
  const barWidth = width / CQT_NUM_BINS
  const specH = height - LABEL_HEIGHT

  ctxCqt.clearRect(0, 0, width, height)
  ctxCqt.fillStyle = '#000'
  ctxCqt.fillRect(0, 0, width, height)

  // One bar per semitone — all equal width
  for (let n = 0; n < CQT_NUM_BINS; n++) {
    const barHeight = ((cqt[n] + 100) / 100) * specH
    ctxCqt.fillStyle = '#b45309'  // amber — distinct from the green FFT charts
    ctxCqt.fillRect(n * barWidth, specH - barHeight, barWidth, barHeight)
  }

  // Red — noise floor
  const floorY = specH - ((noiseFloorDb + 100) / 100) * specH
  ctxCqt.strokeStyle = 'rgba(255, 100, 100, 0.7)'
  ctxCqt.beginPath()
  ctxCqt.moveTo(0, floorY)
  ctxCqt.lineTo(width, floorY)
  ctxCqt.stroke()

  // Orange — prominence threshold (local avg + prominence, ±6 semitone window)
  const semitoneWindow = 6
  ctxCqt.beginPath()
  let first = true
  ctxCqt.strokeStyle = 'rgba(255, 160, 0, 0.9)'
  for (let n = 0; n < CQT_NUM_BINS; n++) {
    const lo = Math.max(0, n - semitoneWindow)
    const hi = Math.min(CQT_NUM_BINS - 1, n + semitoneWindow)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += cqt[k]
    const y = specH - ((sum / (hi - lo + 1) + prominence + 100) / 100) * specH
    const x = n * barWidth
    if (first) { ctxCqt.moveTo(x, y); first = false } else ctxCqt.lineTo(x, y)
  }
  ctxCqt.stroke()

  // Note labels — positioned by bin index, not Hz
  ctxCqt.font = '10px monospace'
  ctxCqt.textAlign = 'center'
  for (const label of CQT_LABELS) {
    const x = (label.bin + 0.5) * barWidth
    ctxCqt.strokeStyle = 'rgba(180, 180, 180, 0.5)'
    ctxCqt.beginPath()
    ctxCqt.moveTo(x, specH)
    ctxCqt.lineTo(x, specH + 5)
    ctxCqt.stroke()
    ctxCqt.fillStyle = label.name === 'C4' ? '#fff' : 'rgba(180, 180, 180, 0.8)'
    ctxCqt.fillText(label.name, x, height - 5)
  }
}

// =============================================
// Threshold slider
// =============================================

thresholdSlider.addEventListener('input', () => {
  thresholdDisplay.textContent = `${thresholdSlider.value} dB`
})

prominenceSlider.addEventListener('input', () => {
  prominenceDisplay.textContent = `${prominenceSlider.value} dB`
})

smoothingBassSlider.addEventListener('input', () => {
  smoothingBassDisplay.textContent = `${smoothingBassSlider.value}%`
})
smoothingMidSlider.addEventListener('input', () => {
  smoothingMidDisplay.textContent = `${smoothingMidSlider.value}%`
})
smoothingTrebleSlider.addEventListener('input', () => {
  smoothingTrebleDisplay.textContent = `${smoothingTrebleSlider.value}%`
})

thresholdSliderB.addEventListener('input', () => {
  thresholdDisplayB.textContent = `${thresholdSliderB.value} dB`
})

thresholdSliderC.addEventListener('input', () => {
  thresholdDisplayC.textContent = `${thresholdSliderC.value} dB`
})
prominenceSliderC.addEventListener('input', () => {
  prominenceDisplayC.textContent = `${prominenceSliderC.value} dB`
})
removalWidthSlider.addEventListener('input', () => {
  removalWidthDisplay.textContent = `${removalWidthSlider.value}%`
})
maxNotesSlider.addEventListener('input', () => {
  maxNotesDisplay.textContent = maxNotesSlider.value
})

prominenceSliderB.addEventListener('input', () => {
  prominenceDisplayB.textContent = `${prominenceSliderB.value} dB`
})

thresholdSliderD.addEventListener('input', () => {
  thresholdDisplayD.textContent = `${thresholdSliderD.value} dB`
})

/**
 * Called each frame for one method.
 * Checks whether that method's detected notes contain all chord target notes,
 * advances/retreats its confidence counter, and toggles the chord-match glow.
 */
function tickChordMatch(methodIdx: number, block: HTMLElement, detected: string[]): void {
  if (armedChordIndex === null) {
    methodConfidence[methodIdx] = 0
    block.classList.remove('chord-match')
    return
  }
  const targetNames = CHORD_TARGETS[armedChordIndex].notes.map(m => midiToName(m))
  const detectedSet = new Set(detected)
  const hit = targetNames.every(name => detectedSet.has(name))

  // Rise fast (×2), fall slow (×1) — hysteresis prevents flickering
  methodConfidence[methodIdx] = hit
    ? Math.min(methodConfidence[methodIdx] + 2, CHORD_CONFIDENCE_MAX)
    : Math.max(methodConfidence[methodIdx] - 1, 0)

  block.classList.toggle('chord-match', methodConfidence[methodIdx] >= CHORD_CONFIDENCE_MATCH)
}

/**
 * Check if a set of MIDI notes are all present and prominent in the CQT.
 * Uses Method D's noise floor and prominence sliders.
 */
function checkCQTNotes(cqt: Float32Array, midis: readonly number[]): boolean {
  const noiseFloor = parseFloat(thresholdSliderD.value)
  const prom = parseFloat(prominenceSliderD.value)
  const semWin = 6
  return midis.every(midi => {
    const n = midi - CQT_MIDI_MIN
    if (n < 0 || n >= CQT_NUM_BINS) return false
    const db = cqt[n]
    if (db < noiseFloor) return false
    const lo = Math.max(0, n - semWin)
    const hi = Math.min(CQT_NUM_BINS - 1, n + semWin)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += cqt[k]
    return db - sum / (hi - lo + 1) >= prom
  })
}

/**
 * Called each frame for one method.
 * During normal listening: checks the current seq event.
 * During the grace period (after D advances): keeps checking the just-played
 * event so slower methods have time to register their verdict.
 */
function tickSeqMethodMatch(methodIdx: number, block: HTMLElement, detected: string[]): void {
  // Decide what notes to check right now
  let targetNotes: number[] | null = null

  if (seqActive && seqGapRemaining > 0 && seqGraceNotes !== null) {
    targetNotes = seqGraceNotes  // grace period — check the event D just played
  } else if (seqActive && seqGapRemaining === 0 && seqIndex < SEQ_EVENTS.length) {
    targetNotes = SEQ_EVENTS[seqIndex].notes  // normal listening
  }

  if (targetNotes === null) {
    methodSeqHit[methodIdx] = Math.max(methodSeqHit[methodIdx] - 1, 0)
    if (methodSeqHit[methodIdx] === 0) block.classList.remove('seq-match')
    return
  }

  const targetNames = targetNotes.map(m => midiToName(m))
  const detectedSet = new Set(detected)
  const hit = targetNames.every(name => detectedSet.has(name))

  methodSeqHit[methodIdx] = hit
    ? Math.min(methodSeqHit[methodIdx] + 2, SEQ_ADVANCE_FRAMES)
    : Math.max(methodSeqHit[methodIdx] - 1, 0)

  block.classList.toggle('seq-match', methodSeqHit[methodIdx] >= SEQ_ADVANCE_FRAMES)
}

/**
 * Called each frame while sequence detection is active.
 * Checks the current target event against live CQT data and advances the
 * sequence when sustained detection is long enough.
 */
function tickSequence(cqt: Float32Array): void {
  if (!seqActive) return

  // ── Grace / gap period ──────────────────────────────────────────────────
  if (seqGapRemaining > 0) {
    seqGapRemaining--
    seqHitFill.style.width = '0%'

    // When grace expires: all methods have had their window — record verdicts
    if (seqGapRemaining === 0 && seqGraceNotes !== null) {
      const methodVerdicts: [string, number][] = [['A', 0], ['C', 2], ['D', 3]]
      const verdicts = methodVerdicts
        .map(([lbl, idx]) => `${lbl}${methodSeqHit[idx] >= SEQ_ADVANCE_FRAMES ? '✓' : '✗'}`)
        .join(' ')

      const line = document.createElement('div')
      line.textContent = `${seqGraceNum}. ${seqGraceLabel}  —  ${verdicts}`
      seqList.appendChild(line)
      seqList.scrollTop = seqList.scrollHeight

      seqProgress.textContent = `${seqIndex} / ${SEQ_EVENTS.length}`
      methodSeqHit.fill(0)
      seqGraceNotes = null

      if (seqIndex >= SEQ_EVENTS.length) {
        seqNextEl.textContent = '— Complete —'
        seqActive = false
        seqToggleBtn.textContent = '▶ Start'
      } else {
        seqNextEl.textContent = `Next: ${SEQ_EVENTS[seqIndex].label}`
      }
    }
    return
  }

  if (seqIndex >= SEQ_EVENTS.length) return

  // ── Normal detection ────────────────────────────────────────────────────
  const target = SEQ_EVENTS[seqIndex]
  const hit = checkCQTNotes(cqt, target.notes)

  seqHitFrames = hit
    ? Math.min(seqHitFrames + 2, SEQ_ADVANCE_FRAMES)
    : Math.max(seqHitFrames - 1, 0)

  seqHitFill.style.width = `${(seqHitFrames / SEQ_ADVANCE_FRAMES) * 100}%`

  if (seqHitFrames >= SEQ_ADVANCE_FRAMES) {
    // Save grace state — verdicts recorded when gap expires (gives A/C time to catch up)
    seqGraceNotes = [...target.notes]
    seqGraceLabel = target.label
    seqGraceNum = seqIndex + 1

    seqIndex++
    seqHitFrames = 0
    seqGapRemaining = SEQ_GAP_FRAMES
  }
}

function armChord(index: number): void {
  const btn = index === 0 ? chordBtn1 : chordBtn2
  const other = index === 0 ? chordBtn2 : chordBtn1

  if (armedChordIndex === index) {
    // Disarm
    armedChordIndex = null
    methodConfidence.fill(0)
    btn.classList.remove('armed', 'matched')
    for (const b of [blockA, blockB, blockC, blockD]) b.classList.remove('chord-match')
    chordStatus.textContent = '—'
  } else {
    // Arm this chord, disarm the other
    armedChordIndex = index
    methodConfidence.fill(0)
    btn.classList.add('armed')
    btn.classList.remove('matched')
    other.classList.remove('armed', 'matched')
    for (const b of [blockA, blockB, blockC, blockD]) b.classList.remove('chord-match')
    chordStatus.textContent = `Listening for ${CHORD_TARGETS[index].label}…`
  }
}

chordBtn1.addEventListener('click', () => armChord(0))
chordBtn2.addEventListener('click', () => armChord(1))

seqToggleBtn.addEventListener('click', () => {
  if (seqIndex >= SEQ_EVENTS.length) return  // complete — must reset first
  seqActive = !seqActive
  seqToggleBtn.textContent = seqActive ? '■ Stop' : '▶ Start'
  if (!seqActive) {
    seqHitFrames = 0
    seqHitFill.style.width = '0%'
    methodSeqHit.fill(0)
    for (const b of [blockA, blockC, blockD]) b.classList.remove('seq-match')
  }
})

seqResetBtn.addEventListener('click', () => {
  seqActive = false
  seqIndex = 0
  seqHitFrames = 0
  seqGapRemaining = 0
  methodSeqHit.fill(0)
  seqToggleBtn.textContent = '▶ Start'
  seqList.innerHTML = ''
  seqProgress.textContent = `0 / ${SEQ_EVENTS.length}`
  seqNextEl.textContent = `Next: ${SEQ_EVENTS[0].label}`
  seqHitFill.style.width = '0%'
  for (const b of [blockA, blockC, blockD]) b.classList.remove('seq-match')
})

prominenceSliderD.addEventListener('input', () => {
  prominenceDisplayD.textContent = `${prominenceSliderD.value} dB`
})

freezeBtn.addEventListener('click', () => {
  if (frozenData) {
    // Unfreeze — go back to live audio
    frozenData = null
    freezeBtn.textContent = '❚❚ Freeze'
    freezeBtn.style.background = ''
  } else {
    // Freeze — take a snapshot of the current spectrum
    if (!analyser) return
    const snapshot = new Float32Array(analyser.frequencyBinCount)
    analyser.getFloatFrequencyData(snapshot)
    frozenData = snapshot
    freezeBtn.textContent = '▶ Unfreeze'
    freezeBtn.style.background = '#c0392b'
    log('Spectrum frozen. Adjust sliders, then Unfreeze to resume.')
  }
})

// =============================================
// Logging helper
// =============================================

function log(msg: string): void {
  const line = document.createElement('div')
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  logEl.prepend(line)
}
