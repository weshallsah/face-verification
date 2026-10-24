import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { VERIFY_DIR, verifyModule } from './_paths.js';

const { sectorToSegment, litSegments, SEGMENTS } = await verifyModule('ring-map.js');
const { binOf, updateCal, screenSector } = await verifyModule('motion.js');
const { tickGeometry } = await verifyModule('components/ring.js');

test('sector -> segment is a one-to-one mapping', () => {
  const seen = new Set();
  for (let s = 0; s < SEGMENTS; s++) seen.add(sectorToSegment(s));
  assert.equal(seen.size, SEGMENTS);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(sectorToSegment), [1, 0, 7, 6, 5, 4, 3, 2]);
});

test('segment boundaries sit on the axes, like the server bins (segments run clockwise from the top)', () => {
  // The first tick of segment 1 is tick 6: centre at 45 + 3.75 degrees clockwise from the top.
  const g = tickGeometry(6, 100, 100, 0, 0);
  const deg = (Math.atan2(g.x, -g.y) * 180) / Math.PI;
  assert.ok(Math.abs(deg - 48.75) < 1e-6);
});

// ---- the mirrored preview ---------------------------------------------------------------------------
// The preview is shown mirrored, but frames (and so pose and nose position) are NOT mirrored. When the person
// moves toward the right side of the SCREEN, the nose moves toward image-LEFT (dNose < 0) and "up" is image-up
// (dNoseY < 0). The sign of yaw / pitch from the pose matrix is arbitrary, so every sign convention is tried.
function lit(screenDir, { yawSign, pitchSign }) {
  const cal = { x: 0, y: 0 };
  const bins = new Set();
  for (let i = 1; i <= 8; i++) {
    const k = i / 8;
    const dyaw = yawSign * screenDir.x * 15 * k, dpitch = pitchSign * screenDir.y * 10.5 * k;
    const dNose = -screenDir.x * 0.25 * k, dNoseY = -screenDir.y * 0.25 * k;
    updateCal(cal, dyaw, dpitch, dNose, dNoseY);
    if (Math.hypot(dyaw / 10, dpitch / 7) >= 1.1) bins.add(binOf(dyaw / 10, dpitch / 7));
  }
  return [...litSegments(bins, cal)];
}

// clockwise angle from the top of a screen direction, and of a segment's centre
const dirAngle = (d) => (((Math.atan2(d.x, d.y) * 180) / Math.PI) + 360) % 360;
const segCentre = (seg) => seg * 45 + 22.5;
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

const DIRS = {
  right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: 1 }, down: { x: 0, y: -1 },
  upRight: { x: 0.707, y: 0.707 }, upLeft: { x: -0.707, y: 0.707 }, downRight: { x: 0.707, y: -0.707 }, downLeft: { x: -0.707, y: -0.707 },
};

for (const [yawSign, pitchSign] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
  const world = `yaw ${yawSign}, pitch ${pitchSign}`;

  test(`head toward the screen's right lights the right side of the ring (${world})`, () => {
    const segs = lit(DIRS.right, { yawSign, pitchSign });
    assert.ok(segs.length >= 1);
    for (const s of segs) assert.ok(s === 1 || s === 2, `segment ${s} must be on the right (1 = upper right, 2 = lower right)`);
  });

  test(`head toward the screen's left lights the left side (${world})`, () => {
    for (const s of lit(DIRS.left, { yawSign, pitchSign })) assert.ok(s === 5 || s === 6, `segment ${s}`);
  });

  test(`up / down light the top / bottom (${world})`, () => {
    for (const s of lit(DIRS.up, { yawSign, pitchSign })) assert.ok(s === 7 || s === 0, `up: segment ${s}`);
    for (const s of lit(DIRS.down, { yawSign, pitchSign })) assert.ok(s === 3 || s === 4, `down: segment ${s}`);
  });

  test(`all eight directions land within one segment of where the head went (${world})`, () => {
    for (const [name, d] of Object.entries(DIRS)) {
      const segs = lit(d, { yawSign, pitchSign });
      assert.ok(segs.length >= 1, name);
      for (const s of segs) assert.ok(angDiff(segCentre(s), dirAngle(d)) <= 45, `${name}: segment ${s}`);
    }
  });
}

test('there is no extra left/right flip: the mapping itself is not mirrored', () => {
  // With a known orientation (cal >= 0 on both axes) bin 0 (just above screen-right) lights segment 1 (upper right).
  assert.equal(sectorToSegment(screenSector(0, { x: 1, y: 1 })), 1);
  // Only the learned orientation moves it to the mirror-image segment.
  assert.equal(sectorToSegment(screenSector(0, { x: -1, y: 1 })), 6);
});

test('the preview is mirrored by CSS (<video> and the frozen frame); uploaded frames are not', () => {
  const css = fs.readFileSync(path.join(VERIFY_DIR, 'css', 'app.css'), 'utf8');
  const rule = css.match(/\.cam-video,\s*\.cam-freeze\s*\{[^}]*\}/);
  assert.ok(rule, 'rule for .cam-video / .cam-freeze exists');
  assert.match(rule[0], /transform:\s*scaleX\(-1\)/);
  const capture = fs.readFileSync(path.join(VERIFY_DIR, 'js', 'capture.js'), 'utf8');
  assert.match(capture, /drawImage\(video, 0, 0, bw, bh\);\s*\/\/ un-mirrored/);
});
