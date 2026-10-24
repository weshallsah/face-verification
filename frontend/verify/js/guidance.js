// Capture phase + latest guidance code -> what the camera screen shows. Pure, no DOM, no text:
// `key` indexes strings.en.js (S.camera.msg[key]).
//
// phase: 'neutral' | 'move' | 'return' | 'retry' | 'captured'
// code (from capture.js guidance()): '' | 'no_face' | 'multi' | 'closer' | 'back' | 'centre' | 'dark' |
//   'bright' | 'yaw' | 'mouth' | 'eyes' | 'keep_going'
// ring: 'search' | 'problem' | 'hold' | 'move' | 'captured'
// tone: 'n' (neutral) | 'bad' (problem, fix it) | 'ok'

const PROBLEMS = { multi: 'multi', closer: 'closer', back: 'back', centre: 'centre', dark: 'dark', bright: 'bright' };
// Coaching, not a problem: the person is nearly there, so no red.
const COACHING = { yaw: 'lookStraight', mouth: 'relax', eyes: 'openEyes' };

export function describe(phase, code = '') {
  switch (phase) {
    case 'neutral':
      if (PROBLEMS[code]) return { key: PROBLEMS[code], tone: 'bad', ring: 'problem' };
      if (COACHING[code]) return { key: COACHING[code], tone: 'n', ring: 'search' };
      if (code === 'ok') return { key: 'hold', tone: 'n', ring: 'hold' };
      return { key: 'fit', tone: 'n', ring: 'search' };            // no face yet
    case 'move':
      return { key: code === 'keep_going' ? 'keepGoing' : 'move', tone: 'n', ring: 'move' };
    case 'return':
      // The filled segments stay on screen, so the ring keeps its "move" look even for a problem.
      if (PROBLEMS[code]) return { key: PROBLEMS[code], tone: 'bad', ring: 'move' };
      if (COACHING[code]) return { key: COACHING[code], tone: 'n', ring: 'move' };
      if (code === 'no_face') return { key: 'fit', tone: 'n', ring: 'move' };
      return { key: 'returnGreat', tone: 'n', ring: 'move' };
    case 'retry':
      return { key: 'retry', tone: 'n', ring: 'move' };
    case 'captured':
      return { key: 'captured', tone: 'ok', ring: 'captured' };
    default:
      return { key: 'fit', tone: 'n', ring: 'search' };
  }
}

export const stepOf = (phase) => (phase === 'captured' ? 2 : phase === 'neutral' ? 0 : 1);
