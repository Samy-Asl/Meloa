import assert from 'node:assert/strict';
import test from 'node:test';
import { TakePlayer } from '../take-player.js';

function playerFixture({ shouldFail = () => false } = {}) {
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const elements = new Map();
  for (const id of ['take-play', 'take-seek', 'take-waveform', 'take-current', 'take-duration', 'take-player-status']) {
    elements.set('#' + id, {
      attributes: new Map(),
      dataset: {},
      parentElement: { style: { setProperty() {} } },
      setAttribute(name, value) { this.attributes.set(name, value); },
      getAttribute(name) { return this.attributes.get(name); },
    });
  }
  const review = {
    dataset: {},
    querySelector: selector => elements.get(selector),
    querySelectorAll: () => [],
  };
  let stops = 0;
  let playCalls = 0;
  const context = {
    currentTime: 1,
    createBufferSource: () => ({
      connect() {},
      disconnect() {},
      start() { if (shouldFail()) throw new Error('Audio unavailable'); },
      stop() { stops++; },
    }),
  };
  const player = new TakePlayer(review, {
    resume: async () => context,
    beforePlay: () => { playCalls++; },
    canPlay: () => true,
  });
  return { player, context, review, stops: () => stops, playCalls: () => playCalls };
}

test('a source that fails to start leaves the player retryable', async () => {
  let shouldFail = true;
  const { player, review } = playerFixture({ shouldFail: () => shouldFail });
  player.setTracks({ original: { duration: 5, buffer: {} } }, 'original');
  await player.toggle();
  assert.match(player.status.textContent, /Lecture impossible/);
  assert.equal(player.playButton.getAttribute('aria-label'), 'Lire la prise');
  assert.equal(review.dataset.playing, 'false');
  shouldFail = false;
  await player.toggle();
  assert.equal(review.dataset.playing, 'true');
});

test('a seek failure stops the old source and keeps the chosen position', async () => {
  let shouldFail = false;
  const { player, review, stops } = playerFixture({ shouldFail: () => shouldFail });
  player.setTracks({ original: { duration: 5, buffer: {} } }, 'original');
  await player.toggle();
  shouldFail = true;
  player.seekTo(2);
  assert.equal(stops(), 1);
  assert.equal(review.dataset.playing, 'false');
  assert.equal(player.elapsed, 2);
  assert.match(player.status.textContent, /Lecture impossible/);
});

test('selecting result preloads without playing and can share a pending load', async () => {
  const { player, review, playCalls } = playerFixture();
  let loads = 0;
  let finish;
  const buffer = new Promise(resolve => { finish = resolve; });
  player.setTracks({
    original: { duration: 8, buffer: {} },
    result: { duration: 5, load() { loads++; return buffer; } },
  }, 'original');
  player.select('result');
  assert.equal(playCalls(), 0);
  const playback = player.toggle();
  await Promise.resolve();
  assert.equal(loads, 1);
  finish({});
  await playback;
  assert.equal(loads, 1);
  assert.equal(review.dataset.playing, 'true');
});
