/**
 * Feedback.tsx — Phase 6
 *
 * Displays the current and upcoming notes for both hands.
 * Driven by ScoreSync via props — no detection logic here.
 */

import type { ParsedNote } from '../modules/midiParser'

interface FeedbackProps {
  currentNotes: ParsedNote[]
  nextNotes: ParsedNote[]
  isComplete: boolean
}

export default function Feedback({ currentNotes, nextNotes, isComplete }: FeedbackProps) {
  if (isComplete) {
    return (
      <div id="feedback-panel">
        <p id="complete-message">Well done — piece complete!</p>
      </div>
    )
  }

  // TODO Phase 6: split currentNotes into left/right hand using note.hand
  // Fallback: notes below MIDI 60 (middle C) are left hand
  const leftNotes  = currentNotes.filter(n => n.hand === 'left'  || (n.hand === 'unknown' && n.midi < 60))
  const rightNotes = currentNotes.filter(n => n.hand === 'right' || (n.hand === 'unknown' && n.midi >= 60))

  return (
    <div id="feedback-panel">
      <div id="hand-guide">
        <div className="hand" id="left-hand">
          {leftNotes.length > 0 ? leftNotes.map(n => n.name).join('  ') : 'Left'}
        </div>
        <div className="hand" id="right-hand">
          {rightNotes.length > 0 ? rightNotes.map(n => n.name).join('  ') : 'Right'}
        </div>
      </div>

      <div id="next-notes">
        {/* TODO Phase 6: show upcoming notes smaller / greyed out */}
        {nextNotes.length > 0 && (
          <span className="next-label">Next: {nextNotes.map(n => n.name).join('  ')}</span>
        )}
      </div>
    </div>
  )
}
