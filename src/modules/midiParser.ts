/**
 * Parses a MIDI file and extracts the data we need for:
 *   - Score synchronisation (which notes at which time)
 *   - Hand guidance (which track = left hand, which = right hand)
 *   - Annotations (note names to display on the PDF overlay)
 *
 * We use the @tonejs/midi library.
 * Docs: https://github.com/Tonejs/Midi
 */

import { Midi } from '@tonejs/midi'

// The shape of a single parsed note used throughout the app
export interface ParsedNote {
  midi: number        // MIDI note number (e.g. 60 = C4)
  name: string        // Human-readable name (e.g. "C4", "F#3")
  time: number        // Time in seconds when the note starts
  duration: number    // How long the note lasts, in seconds
  hand: 'left' | 'right' | 'unknown'
}

// A measure groups the notes that fall within it
export interface ParsedMeasure {
  index: number        // Measure number (0-based)
  startTime: number    // Time in seconds when this measure starts
  endTime: number      // Time in seconds when this measure ends
  notes: ParsedNote[]  // All notes in this measure
}

// The full parsed score, ready for the rest of the app to use
export interface ParsedScore {
  durationSeconds: number    // Total length of the piece
  bpm: number                // Tempo in beats per minute
  timeSignatureNumerator: number    // e.g. 3 in "3/4"
  timeSignatureDenominator: number  // e.g. 4 in "3/4"
  measures: ParsedMeasure[]
  allNotes: ParsedNote[]
}

/**
 * parses File into a readable format with both bass and treble tracks merged into one
 */
export async function parseMidi(file: File): Promise<ParsedScore> {

  const checkList = {
    left: ["bass", "left"],
    right: ["treble", "right"]
  }

  const arrayBuffer = await file.arrayBuffer();
  const midi = new Midi(arrayBuffer);

  const tempo = midi.header.tempos[0].bpm ?? 120;
  const timeSignatureNumerator = midi.header.timeSignatures[0].timeSignature[0];
  const timeSignatureDenominator = midi.header.timeSignatures[0].timeSignature[1];

  const secPerBeat = 60 / tempo;
  const secPerMeasure = secPerBeat * timeSignatureNumerator * (4 / timeSignatureDenominator);

  const allNotes: ParsedNote[] = [];
  const noteMap = new Map<number, ParsedNote[]>();

  // extract all notes from both tracks into one array
  midi.tracks.forEach((track, index) => {
    const notes = track.notes
    let trackHand: 'left' | 'right' | 'unknown'
    // Check which hand it is for
    if (checkList.left.includes(track.name.toLowerCase())) {
      trackHand = 'left'
    } else if (checkList.right.includes(track.name.toLowerCase())) {
      trackHand = 'right'
    } else {
      trackHand = 'unknown'
      if (index == 0) {
        trackHand = 'left'
      } else {
        trackHand = 'right'
      }
      console.log("Assuming trackhand to be " + trackHand)
      console.log('cant detect track: ' + track.name)
    }
    notes.forEach(note => {
      allNotes.push({
        midi: note.midi,
        name: note.name,
        time: note.time,
        duration: note.duration,
        hand: trackHand
      })
    })
  })

  allNotes.forEach(note => {
    const i = Math.floor(note.time / secPerMeasure) //index will be the time (in seconds) where the note is played
    if (!noteMap.has(i)) {
      noteMap.set(i, [])
    }
    noteMap.get(i)?.push(note)
  })

  const parsedMeasure = Array.from(noteMap, ([key, value]) => ({
    index: key,      // Measure number (0-based)
    startTime: key * secPerMeasure,   // Time in seconds when this measure starts
    endTime: (key + 1) * secPerMeasure,     // Time in seconds when this measure ends
    notes: value  // All notes in this measure
  }))

  const parsedScore = {
    durationSeconds: midi.duration,    // Total length of the piece
    bpm: tempo,                // Tempo in beats per minute
    timeSignatureNumerator: timeSignatureNumerator,    // e.g. 3 in "3/4"
    timeSignatureDenominator: timeSignatureDenominator,  // e.g. 4 in "3/4"
    measures: parsedMeasure,
    allNotes: allNotes,
  }

  return parsedScore
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/**
 *  Converts midi numbers to note names text format
 */
export function midiNoteToName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const semitone = midi % 12
  return NOTE_NAMES[semitone] + octave
}
