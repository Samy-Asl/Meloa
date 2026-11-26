import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeProject, encodeProject, fitsArrangement } from '../project.js';

const note = (pitch, step, length = 2) => ({ pitch, step, length, velocity: 0.75 });
const chord = [60, 64, 67].map(pitch => note(pitch, 0));
const selection = new Set(chord);
const move = (notes, offset) => notes.map(n => ({ ...n, step: n.step + offset }));

test('a chord can move partly over its original position', () => {
  assert.ok(fitsArrangement(chord, move(chord, 1), selection));
});

test('one occupied voice blocks the entire destination', () => {
  const existing = [...chord, note(64, 8)];
  assert.equal(fitsArrangement(existing, move(chord, 7), selection), false);
  assert.ok(fitsArrangement(existing, move(chord, 10), selection));
});

test('resizing two selected notes cannot create an internal overlap', () => {
  const pair = [note(60, 0), note(60, 3)];
  assert.equal(fitsArrangement(pair, pair.map(n => ({ ...n, length: 4 })), new Set(pair)), false);
});

test('the final step accepts a hit or a one-step piano note', () => {
  const notes = [note('kick', 63, 1), note(84, 63, 1)];
  assert.deepEqual(decodeProject(encodeProject(notes, 118)), { notes, bpm: 118 });
});

test('invalid imported projects cannot introduce unknown voices or broken timing', () => {
  for (const item of [note(35, 0), note(60, 63, 2), note('snare', 1, 2), note('voice', 1), note(60, -1)]) {
    assert.throws(() => decodeProject(encodeProject([item], 92)));
  }
  assert.throws(() => decodeProject(encodeProject([note(60, 1), note(60, 2)], 92)));
  assert.throws(() => decodeProject(encodeProject([], 0)));
});
