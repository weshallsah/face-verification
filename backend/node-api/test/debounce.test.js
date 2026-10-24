import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyModule } from './_paths.js';

const { createDebouncer } = await verifyModule('debounce.js');
const { describe, stepOf } = await verifyModule('guidance.js');

test('the first message is shown at once', () => {
  const d = createDebouncer(300);
  assert.equal(d.push('fit', 0), 'fit');
});

test('a new message replaces the old one only after it has been steady for 300 ms', () => {
  const d = createDebouncer(300);
  d.push('fit', 0);
  assert.equal(d.push('dark', 100), 'fit');
  assert.equal(d.push('dark', 399), 'fit');
  assert.equal(d.push('dark', 400), 'dark');
});

test('a message that flickers in and out never appears', () => {
  const d = createDebouncer(300);
  d.push('fit', 0);
  const shown = [];
  for (let t = 50; t <= 2000; t += 50) shown.push(d.push(t % 100 === 0 ? 'dark' : 'fit', t));
  assert.ok(shown.every((s) => s === 'fit'));
});

test('going back to the shown message cancels a pending change', () => {
  const d = createDebouncer(300);
  d.push('fit', 0);
  d.push('dark', 100);
  d.push('fit', 250);
  assert.equal(d.push('dark', 500), 'fit');       // the 300 ms count starts again from 500
  assert.equal(d.push('dark', 800), 'dark');
});

test('a different candidate restarts the wait', () => {
  const d = createDebouncer(300);
  d.push('fit', 0);
  d.push('dark', 100);
  assert.equal(d.push('closer', 350), 'fit');
  assert.equal(d.push('closer', 650), 'closer');
});

test('force() is for phase changes: immediate, and clears pending changes', () => {
  const d = createDebouncer(300);
  d.push('fit', 0);
  d.push('dark', 100);
  assert.equal(d.force('keepGoing'), 'keepGoing');
  assert.equal(d.value, 'keepGoing');
  assert.equal(d.push('keepGoing', 150), 'keepGoing');
});

test('neutral phase: live messages from the brief', () => {
  assert.deepEqual(describe('neutral', 'no_face'), { key: 'fit', tone: 'n', ring: 'search' });
  assert.equal(describe('neutral', '').key, 'fit');
  assert.equal(describe('neutral', 'closer').key, 'closer');
  assert.equal(describe('neutral', 'back').key, 'back');
  assert.equal(describe('neutral', 'centre').key, 'centre');
  assert.equal(describe('neutral', 'multi').key, 'multi');
  assert.equal(describe('neutral', 'dark').key, 'dark');
  for (const c of ['closer', 'back', 'centre', 'multi', 'dark', 'bright']) {
    assert.equal(describe('neutral', c).tone, 'bad', c);
    assert.equal(describe('neutral', c).ring, 'problem', c);
  }
  assert.deepEqual(describe('neutral', 'ok'), { key: 'hold', tone: 'n', ring: 'hold' });
});

test('look straight / relax / open eyes are neutral coaching, not red problems', () => {
  for (const [code, key] of [['yaw', 'lookStraight'], ['mouth', 'relax'], ['eyes', 'openEyes']]) {
    const d = describe('neutral', code);
    assert.equal(d.key, key);
    assert.equal(d.tone, 'n');
    assert.notEqual(d.ring, 'problem');
  }
});

test('move / return / retry / captured', () => {
  assert.equal(describe('move', '').key, 'move');
  assert.equal(describe('move', 'keep_going').key, 'keepGoing');
  assert.equal(describe('move', '').ring, 'move');
  assert.equal(describe('return', '').key, 'returnGreat');
  assert.equal(describe('return', 'multi').tone, 'bad');
  assert.equal(describe('return', 'multi').ring, 'move');   // lit segments stay visible
  assert.equal(describe('retry').key, 'retry');
  assert.deepEqual(describe('captured'), { key: 'captured', tone: 'ok', ring: 'captured' });
});

test('step indicator: Position / Move / Done', () => {
  assert.deepEqual(['neutral', 'move', 'return', 'retry', 'captured'].map(stepOf), [0, 1, 1, 1, 2]);
});
