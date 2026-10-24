import { MOTION_BINS, screenSector } from './motion.js';

// The UI ring has 8 segments numbered CLOCKWISE from the top: segment i spans [45 i, 45 (i + 1)) degrees
// measured clockwise from 12 o'clock, so segment boundaries sit on the axes, exactly like the server bins.
//   segment 0 = upper right (12 -> 1:30), 1 = right-upper (1:30 -> 3), 2 = right-lower ...
export const SEGMENTS = MOTION_BINS;

// Screen sector (math angle, counter-clockwise from screen-right, from screenSector()) -> ring segment.
// Sector s covers math angles [45 s, 45 s + 45), i.e. clockwise-from-top [45 - 45 s, 90 - 45 s).
//
// There is deliberately NO extra left/right flip here. The preview is mirrored, and screenSector()
// already compares the head movement with where the nose moves in the mirrored preview, so its output is
// in screen terms. Flipping again would light the wrong side.
export function sectorToSegment(sector) {
  return (((1 - sector) % SEGMENTS) + SEGMENTS) % SEGMENTS;
}

// Raw bins reached so far -> set of ring segments to light.
export function litSegments(bins, cal) {
  return new Set([...bins].map((b) => sectorToSegment(screenSector(b, cal))));
}
