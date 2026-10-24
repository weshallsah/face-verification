// HEAD_MOTION geometry, moved out of the old test page UNCHANGED so it can be unit tested.
// The server re-measures the uploaded JPEGs with the same 8 bins: do not change the bin layout.

export const MOTION_BINS = 8;

// Normalised head offset (nx = yaw / MOTION_YAW_DEG, ny = pitch / MOTION_PITCH_DEG) -> raw sector.
// Raw sector k covers the angle [k * 45, (k + 1) * 45) degrees of atan2(ny, nx), so sector
// boundaries sit ON the axes.
export function binOf(nx, ny) {
  return Math.floor((((Math.atan2(ny, nx) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * MOTION_BINS) % MOTION_BINS;
}

// Evidence for the on-screen orientation of yaw / pitch, from where the nose moves in the image.
// The frame is NOT mirrored, the preview is: screen-right is the nose moving toward image-left,
// screen-up is the nose moving up.
export function updateCal(cal, dyaw, dpitch, dNose, dNoseY) {
  if (Math.abs(dyaw) > 3 && Math.abs(dNose) > 0.03) cal.x += dyaw * -dNose;
  if (Math.abs(dpitch) > 2 && Math.abs(dNoseY) > 0.02) cal.y += dpitch * -dNoseY;
}

// Raw sector (angle of the yaw/pitch offset) -> sector on screen. The pose matrix signs are arbitrary,
// so the mapping is learned from the nose position in the (mirrored) preview. Only whole-sector flips are
// possible, so lit sectors always map one-to-one. The result is a MATH sector: 0 starts at screen-right
// and runs counter-clockwise, 45 degrees each. ring-map.js turns it into a ring segment.
export function screenSector(bin, cal) {
  const theta = ((bin + 0.5) * 2 * Math.PI) / MOTION_BINS;
  const x = (cal.x >= 0 ? 1 : -1) * Math.cos(theta), y = (cal.y >= 0 ? 1 : -1) * Math.sin(theta);
  const phi = (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
  return Math.floor(phi / (2 * Math.PI / MOTION_BINS)) % MOTION_BINS;
}
