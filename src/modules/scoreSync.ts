/**
 * scoreSync.ts — Phase 6
 *
 * The "brain" of the live feedback system.
 *
 * Takes detected notes from the microphone and figures out:
 *   - Which measure in the score the user is currently playing
 *   - Whether they played correctly
 *   - What the next notes to play are
 *
 * === Matching strategy ===
 * We use a "fuzzy forward" approach:
 *   - Keep a pointer to the current position in the score
 *   - When notes are detected, check if any of them match notes
 *     expected at or near the current position
 *   - If yes → advance the pointer, emit a position update
 *   - If no  → stay put (don't penalise wrong notes harshly)
 *   - If the user is stuck for too long → optionally skip forward
 *
 * === Chord matching ===
 * For a chord to count as "played":
 *   - At least N out of M expected notes must be detected
 *   - Start with N = 1 (any note advances), then tune upward
 *   - This handles the limitations of microphone chord detection
 *
 * TODO Phase 6: tune these thresholds once detection is working
 */

import type { ParsedMeasure, ParsedNote } from './midiParser.ts'
import type { DetectionFrame } from './pitchDetector.ts'

export interface SyncState {
  currentMeasureIndex: number
  currentNoteIndex: number       // within the measure
  isComplete: boolean            // reached end of score
}

export interface SyncEvent {
  state: SyncState
  matchedNotes: ParsedNote[]     // notes from the score that were matched
  nextNotes: ParsedNote[]        // upcoming notes (for the "next to play" panel)
}

export type OnSyncUpdate = (event: SyncEvent) => void

/**
 * TODO Phase 6: implement this class
 *
 * Usage:
 *   const sync = new ScoreSync(measures, onUpdate)
 *   // then feed it detection frames from pitchDetector:
 *   sync.processFrame(detectionFrame)
 */
export class ScoreSync {
  private measures: ParsedMeasure[]
  private onUpdate: OnSyncUpdate
  private state: SyncState

  constructor(measures: ParsedMeasure[], onUpdate: OnSyncUpdate) {
    this.measures = measures
    this.onUpdate = onUpdate
    this.state = { currentMeasureIndex: 0, currentNoteIndex: 0, isComplete: false }
  }

  /**
   * TODO: process one detection frame
   *
   * Steps:
   *   1. Get the expected notes at the current position
   *   2. Check how many of the detected notes match expected ones
   *      Hint: compare midi numbers, allow ±1 semitone tolerance for mic inaccuracy
   *   3. If enough match (see chord matching strategy above):
   *      a. advance the note/measure pointer
   *      b. collect the next N notes as "upcoming"
   *      c. call this.onUpdate() with a SyncEvent
   */
  processFrame(frame: DetectionFrame): void {
    // TODO: implement
  }

  // Resets back to the beginning of the score
  reset(): void {
    this.state = { currentMeasureIndex: 0, currentNoteIndex: 0, isComplete: false }
  }

  // TODO: add a skip() method that jumps forward by one measure
  //       useful if the user gets stuck
}
