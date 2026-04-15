/**
 * pitchDetector.ts — Phase 5
 *
 * Listens to the microphone and detects which notes the user is playing.
 *
 * === The hard part: chords ===
 * Detecting a single note (monophonic) is easy.
 * Detecting multiple simultaneous notes (polyphonic) is much harder.
 *
 * We use Essentia.js which has a polyphonic pitch salience algorithm
 * designed specifically for instruments like piano.
 * Docs: https://essentia.upf.edu/essentiajs
 *
 * === How it works ===
 *   1. Get microphone access via getUserMedia()
 *   2. Feed audio into a Web Audio API AnalyserNode (gives us frequency data)
 *   3. Pass frequency data into Essentia's PitchSalienceFunction
 *   4. Essentia returns a list of candidate pitches with confidence scores
 *   5. We filter to pitches above a confidence threshold → detected notes
 *
 * === Important: mobile microphone access ===
 *   - The page MUST be served over HTTPS or localhost for getUserMedia to work
 *   - On your local network (http://192.168.x.x) it may NOT work on iOS Safari
 *   - Solution: either use a self-signed certificate, or test on Android Chrome first
 *   - TODO: investigate this limitation and document the workaround
 */

// The result of one detection frame
export interface DetectionFrame {
  timestamp: number    // performance.now() when this was captured
  notes: DetectedNote[]
}

export interface DetectedNote {
  midi: number       // MIDI note number (e.g. 60 = C4)
  name: string       // human-readable (e.g. "C4")
  confidence: number // 0.0 – 1.0, how sure we are
}

// Callback called ~every 50ms with the latest detected notes
export type OnNotesDetected = (frame: DetectionFrame) => void

/**
 * TODO Phase 5: implement this function
 *
 * Steps:
 *   1. Call navigator.mediaDevices.getUserMedia({ audio: true })
 *   2. Create an AudioContext and connect the mic stream to an AnalyserNode
 *      Hint: set fftSize to 4096 or 8192 for better frequency resolution
 *   3. Load Essentia.js (it's a WASM module, must be awaited)
 *   4. Start a requestAnimationFrame loop:
 *      a. Get frequency data from the AnalyserNode
 *      b. Run Essentia pitch salience
 *      c. Convert Hz values to MIDI note numbers (see hzToMidi below)
 *      d. Filter by confidence threshold (start with 0.1, tune it)
 *      e. Call onDetected with the results
 *   5. Return a cleanup function that stops the mic and cancels the loop
 */
export async function startListening(onDetected: OnNotesDetected): Promise<() => void> {
  // TODO: implement

  throw new Error('startListening not yet implemented')
}

/**
 * TODO (helper): convert a frequency in Hz to the nearest MIDI note number
 *
 * Formula: midi = 12 * log2(hz / 440) + 69
 * Hint: Math.round() to snap to the nearest semitone
 *
 * Examples:
 *   440 Hz → 69 (A4)
 *   261.63 Hz → 60 (C4 / middle C)
 */
export function hzToMidi(hz: number): number {
  // TODO: implement
  return 0
}
