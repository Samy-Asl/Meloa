import { decodeProject, download, encodeProject, fitsArrangement, readSaved, saveLocal } from './project.js';
import { transcribe } from './listen.js';
import { formatTime, renderPattern, TakePlayer } from './take-player.js';
import { DRUMS, STEP_COUNT, STEPS_PER_MEASURE, StudioAudio } from './audio.js';

const $ = id => document.getElementById(id);
const grid = $('grid');
const scroll = $('grid-scroll');
const tabs = [...document.querySelectorAll('[role="tab"]')];
const noteSettings = $('note-settings');
const pitchClasses = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const pitches = Array.from({ length: 49 }, (_, index) => 84 - index);
const keys = 'qzsedftgyhujk';
const instruments = {
  piano: pitches.map(pitch => ({ pitch, label: pitchName(pitch), natural: !pitchName(pitch).includes('♯') })),
  drums: DRUMS.map(drum => ({ pitch: drum.id, label: drum.label, natural: true })),
};
const controls = {
  step: $('note-step'), length: $('note-length'), pitch: $('note-pitch'), velocity: $('note-velocity'),
};
const tips = {
  draw: 'Clique pour écrire. Glisse une note pour la déplacer ou tire son bord droit pour changer sa durée.',
  select: 'Trace un cadre autour des notes ou touche-les une à une. Glisse ensuite la sélection.',
  erase: 'Touche une note pour l’effacer. Annuler permet de la retrouver.',
  pan: 'Fais glisser la grille pour explorer les quatre mesures et les octaves.',
};
let tool = 'draw';
let saved;
try { saved = readSaved(); } catch { $('save-state').textContent = 'Sauvegarde locale illisible'; }
let notes = saved?.notes ?? example();
let mode = 'piano';
let selected = null;
let selection = new Set();
let blocks = new Map();
let drag = null;
let dragFrame = 0;
let currentSnapshot = encodeProject(notes, saved?.bpm ?? 92);
const past = [];
const future = [];
let rows = new Map();
let lastCell = null;
let animation = null;
let playRequest = 0;
let playPending = false;
let auditionSession = 0;
let loadingAudio = null;

const audio = new StudioAudio(step => notes.filter(note => note.step === step), saved?.bpm ?? 92);

function pitchName(pitch) {
  return `${pitchClasses[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

function example() {
  const result = [];
  const chords = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
  const tune = [[69, 67], [65, 69], [67, 64], [62, 67]];
  chords.forEach((chord, measure) => {
    const start = measure * STEPS_PER_MEASURE;
    chord.forEach(pitch => {
      result.push({ pitch, step: start, length: 6, velocity: 0.58 });
      result.push({ pitch, step: start + 8, length: 5, velocity: 0.52 });
    });
    result.push({ pitch: tune[measure][0], step: start + 6, length: 2, velocity: 0.74 });
    result.push({ pitch: tune[measure][1], step: start + 13, length: 3, velocity: 0.71 });

    for (const step of [0, 6, 8]) result.push({ pitch: 'kick', step: start + step, length: 1, velocity: step === 0 ? 0.80 : 0.59 });
    for (const step of [4, 12]) result.push({ pitch: 'snare', step: start + step, length: 1, velocity: 0.75 });
    for (const step of [0, 2, 4, 6, 8, 10, 12]) {
      result.push({ pitch: 'hat-closed', step: start + step, length: 1, velocity: step % 4 === 0 ? 0.47 : 0.36 });
    }
    result.push({ pitch: 'hat-open', step: start + 14, length: 1, velocity: 0.46 });
  });
  return result;
}

function button(text, cssClass) {
  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = text;
  item.className = cssClass;
  return item;
}

function stepLabel(step) {
  const bar = Math.floor(step / STEPS_PER_MEASURE) + 1;
  const beat = Math.floor(step % STEPS_PER_MEASURE / 4) + 1;
  return `mesure ${bar}, temps ${beat}, pas ${step % 4 + 1}`;
}

function buildGrid() {
  const previousScroll = scroll.scrollLeft;
  grid.dataset.mode = mode;
  const header = document.createElement('div');
  header.className = 'grid-header';
  const title = document.createElement('span');
  title.className = 'grid-label';
  title.textContent = mode === 'piano' ? 'Notes' : 'Frappes';
  const measures = document.createElement('div');
  measures.className = 'measures';
  for (let bar = 1; bar <= STEP_COUNT / STEPS_PER_MEASURE; bar += 1) {
    const measure = document.createElement('div');
    measure.className = 'ruler-measure';
    for (let beat = 0; beat < 4; beat++) {
      const seek = button(beat ? String(beat + 1) : 'M' + bar, 'ruler-beat');
      seek.dataset.seek = (bar - 1) * STEPS_PER_MEASURE + beat * 4;
      const description = 'Placer la lecture à la mesure ' + bar + ', temps ' + (beat + 1);
      seek.setAttribute('aria-label', description);
      seek.title = description;
      measure.append(seek);
    }
    measures.append(measure);
  }
  header.append(title, measures);

  blocks = new Map();
  rows = new Map();
  const content = document.createDocumentFragment();
  content.append(header);
  for (const { pitch, label, natural } of instruments[mode]) {
    const row = document.createElement('div');
    row.className = 'grid-row';
    const name = button(label, natural ? 'grid-label is-natural' : 'grid-label');
    name.dataset.preview = pitch;
    name.setAttribute('aria-label', `Écouter ${label}`);
    const steps = document.createElement('div');
    steps.className = 'steps';
    const cells = [];
    for (let step = 0; step < STEP_COUNT; step += 1) {
      const cell = button('', 'step');
      cell.dataset.step = step;
      cell.dataset.pitch = pitch;
      cell.style.gridColumn = step + 1;
      cell.setAttribute('aria-label', `${label}, ${stepLabel(step)}`);
      cell.tabIndex = -1;
      cells.push(cell);
      steps.append(cell);
    }
    row.append(name, steps);
    rows.set(pitch, { steps, cells, covered: new Set() });
    content.append(row);
  }
  const playhead = document.createElement('div');
  playhead.className = 'playhead';
  playhead.setAttribute('aria-hidden', 'true');
  content.append(playhead);
  grid.replaceChildren(content);
  lastCell = rows.get(mode === 'piano' ? 60 : 'kick').cells[0];
  lastCell.tabIndex = 0;
  scroll.scrollLeft = previousScroll;
  scroll.scrollTop = mode === 'piano' ? rows.get(67).steps.offsetTop - header.offsetHeight : 0;
  renderNotes();
  showPosition();
}

function renderNotes() {
  const present = new Set();
  const occupied = new Map();
  for (const note of notes) {
    const row = rows.get(note.pitch);
    if (!row) continue;
    present.add(note);
    let block = blocks.get(note);
    if (!block) {
      block = document.createElement('span');
      block.className = 'note-block';
      block.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'block-name';
      block.append(name);
      if (mode === 'piano') {
        const grip = document.createElement('span');
        grip.className = 'resize';
        block.append(grip);
      }
      blocks.set(note, block);
    }
    if (block.parentElement !== row.steps) row.steps.append(block);
    block.dataset.start = note.step;
    block.dataset.voice = note.pitch;
    block.firstElementChild.textContent = mode === 'piano' && note.length >= 3 ? pitchName(note.pitch) : '';
    block.classList.toggle('is-selected', selection.has(note));
    block.style.gridColumn = (note.step + 1) + ' / span ' + note.length;
    block.style.opacity = 0.58 + note.velocity * 0.42;
    if (!occupied.has(row)) occupied.set(row, new Set());
    for (let i = note.step; i < note.step + note.length; i++) occupied.get(row).add(i);
  }
  for (const [note, block] of blocks) {
    if (present.has(note)) continue;
    block.remove();
    blocks.delete(note);
  }
  for (const row of rows.values()) {
    const next = occupied.get(row) ?? new Set();
    for (const i of row.covered) if (!next.has(i)) row.cells[i].removeAttribute('aria-pressed');
    for (const i of next) if (!row.covered.has(i)) row.cells[i].setAttribute('aria-pressed', 'true');
    row.covered = next;
  }
  updateOverview();
}

function selectNote(note, message) {
  selection = new Set(note ? [note] : []);
  showSelection(note, message);
}

function showSelection(primary, message) {
  selected = selection.has(primary) ? primary : selection.values().next().value ?? null;
  const multiple = selection.size > 1;
  noteSettings.hidden = !selected;
  controls.step.parentElement.hidden = multiple;
  controls.length.parentElement.hidden = multiple || mode === 'drums';
  controls.pitch.parentElement.hidden = multiple || mode === 'drums';
  $('edit-help').textContent = message || (multiple ? selection.size + ' notes sélectionnées' : selected
    ? instruments[mode].find(item => item.pitch === selected.pitch).label + ' · ' + stepLabel(selected.step)
    : tips[tool]);
  if (selected) {
    controls.step.value = selected.step + 1;
    controls.length.value = selected.length;
    controls.length.max = maxLength(selected.pitch, selected.step, selected);
    controls.pitch.value = selected.pitch;
    controls.velocity.value = Math.round(selected.velocity * 100);
  }
  renderNotes();
}

function recordChange() {
  const next = encodeProject(notes, audio.bpm);
  if (next === currentSnapshot) return;
  past.push(currentSnapshot);
  if (past.length > 80) past.shift();
  future.length = 0;
  currentSnapshot = next;
  persist();
}

function persist() {
  try {
    saveLocal(currentSnapshot);
    $('save-state').textContent = 'Enregistré sur cet appareil';
  } catch { $('save-state').textContent = 'Stockage indisponible · télécharge le projet'; }
  syncHistory();
}

function syncHistory() {
  $('undo').disabled = !past.length || !!recording;
  $('redo').disabled = !future.length || !!recording;
  $('export-wav').disabled = !notes.length || exporting;
}

function restore(project) {
  stop();
  notes = project.notes;
  audio.setTempo(project.bpm);
  refreshTakeTempo();
  $('tempo').value = project.bpm;
  selectNote(null);
}

function historyStep(forward) {
  if (recording || drag) return;
  const source = forward ? future : past;
  if (!source.length) return;
  (forward ? past : future).push(currentSnapshot);
  currentSnapshot = source.pop();
  restore(decodeProject(currentSnapshot));
  persist();
  $('edit-help').textContent = forward ? 'Modification rétablie.' : 'Modification annulée.';
}

function maxLength(pitch, step, excluded) {
  let end = STEP_COUNT;
  for (const note of notes) {
    if (note === excluded || note.pitch !== pitch) continue;
    if (note.step <= step && step < note.step + note.length) return 0;
    if (step < note.step) end = Math.min(end, note.step);
  }
  return end - step;
}

function readPitch(value) {
  return mode === 'piano' ? Number(value) : value;
}

function editCell(cell) {
  const point = Number(cell.dataset.step);
  const pitch = readPitch(cell.dataset.pitch);
  const existing = notes.find(note => note.pitch === pitch && note.step <= point && point < note.step + note.length);
  if (tool === 'pan') return;
  if (tool === 'erase') { if (existing) { selectNote(existing); deleteSelected(); } return; }
  if (tool === 'select') { if (existing) toggleMember(existing); else selectNote(null); return; }
  if (existing) {
    selectNote(existing);
    return;
  }
  const snap = Number($('snap').value);
  const step = Math.floor(point / snap) * snap;
  if (!maxLength(pitch, step)) { showSelection(selected, 'La position alignée est occupée.'); return; }
  const note = { pitch, step, length: Math.min(mode === 'piano' ? Math.max(2, snap) : 1, maxLength(pitch, step)), velocity: 0.74 };
  notes.push(note);
  audio.refreshStep(step);
  selectNote(note);
  recordChange();
  audition(note);
}

function updateSelected(field) {
  if (!selected) return;
  if (field === 'velocity') {
    for (const note of selection) note.velocity = controls.velocity.valueAsNumber / 100;
    refreshSteps(selection);
    recordChange();
    showSelection(selected);
    audition(selected);
    return;
  }
  if (selection.size !== 1) return;
  const candidate = { ...selected };
  if (field === 'step') candidate.step = controls.step.valueAsNumber - 1;
  if (field === 'length') candidate.length = controls.length.valueAsNumber;
  if (field === 'pitch') candidate.pitch = Number(controls.pitch.value);
  if (!applyPositions([candidate])) return;
  if (field === 'pitch') audition(selected);
}

function refreshSteps(items) {
  new Set(Array.from(items, note => note.step)).forEach(step => audio.refreshStep(step));
}

function deleteSelected() {
  if (!selection.size) return;
  const removed = selection;
  notes = notes.filter(note => !removed.has(note));
  refreshSteps(removed);
  selectNote(null);
  recordChange();
}

async function prepareAudio() {
  if (loadingAudio) return loadingAudio;
  if (!audio.buffers.size) $('status').textContent = 'Chargement des sons…';
  loadingAudio = audio.ready().then(() => {
    $('status').textContent = '';
  }).catch(error => {
    $('status').textContent = 'Impossible de charger les sons. Réessaie.';
    console.error(error);
    throw error;
  }).finally(() => {
    loadingAudio = null;
  });
  return loadingAudio;
}

async function audition(note) {
  if (recording === 'mic') return;
  const session = auditionSession;
  try {
    await prepareAudio();
    if (session === auditionSession) audio.preview({ ...note, length: Math.min(note.length, 3) });
  } catch {
    // The status above offers a retry on the next interaction.
  }
}

async function togglePlay() {
  if (recording === 'mic') return;
  if (audio.playing) {
    audio.pause();
    updateTransport();
    return;
  }
  takePlayer.pause();
  const request = ++playRequest;
  playPending = true;
  $('play').disabled = true;
  try {
    await prepareAudio();
    if (request !== playRequest) return;
    audio.start();
    updateTransport();
  } catch {
    // Keep the play button available for a retry.
  } finally {
    if (request === playRequest) {
      playPending = false;
      $('play').disabled = recording === 'mic';
    }
  }
}

function stop() {
  takePlayer.pause();
  stopTransport();
}

function stopTransport() {
  playRequest += 1;
  playPending = false;
  auditionSession += 1;
  audio.stop();
  $('play').disabled = recording === 'mic';
  updateTransport();
}

function showPosition() {
  const position = audio.position;
  const measure = Math.floor(position / STEPS_PER_MEASURE) + 1;
  const beat = Math.floor(position % STEPS_PER_MEASURE / 4) + 1;
  const display = `0${measure} · 0${beat}`;
  if ($('position').value !== display) $('position').value = display;
  grid.classList.toggle('is-running', audio.playing || position > 0);
  if (grid.dataset.playingBar !== String(measure)) {
    grid.dataset.playingBar = String(measure);
    document.querySelectorAll('.measure-jump').forEach((item, index) => item.classList.toggle('current-bar', index === measure - 1));
  }
  grid.style.setProperty('--playhead', position / STEP_COUNT);
}

function animatePosition() {
  showPosition();
  animation = requestAnimationFrame(animatePosition);
}

function updateTransport() {
  $('play-label').textContent = audio.playing ? 'Pause' : 'Lecture';
  $('play-icon').setAttribute('d', audio.playing ? 'M4 3h3.7v12H4zm6.3 0H14v12h-3.7z' : 'M5 2.8 15 9 5 15.2Z');
  cancelAnimationFrame(animation);
  animation = null;
  if (audio.playing) animatePosition();
  else showPosition();
}

function switchMode(next, focus = false) {
  if (next === mode) return;
  cancelGesture();
  selection.clear();
  mode = next;
  selected = null;
  for (const tab of tabs) {
    const active = tab.dataset.mode === mode;
    tab.tabIndex = active ? 0 : -1;
    tab.setAttribute('aria-selected', active);
    if (active && focus) tab.focus();
  }
  $('instrument-panel').setAttribute('aria-labelledby', mode === 'piano' ? 'piano-tab' : 'drums-tab');
  if (mode === 'drums' && recording === 'keys') finishKeys();
  $('keyboard-panel').hidden = mode === 'drums';
  $('pitch-setting').hidden = mode === 'drums';
  controls.length.parentElement.hidden = mode === 'drums';
  buildGrid();
  selectNote(null);
}

function refill(next, prompt) {
  if (notes.length && !window.confirm(prompt)) return;
  const oldSteps = new Set([...notes, ...next].map(note => note.step));
  notes = next;
  oldSteps.forEach(step => audio.refreshStep(step));
  selectNote(null);
  recordChange();
}

grid.addEventListener('click', event => {
  const ruler = event.target.closest('[data-seek]');
  if (ruler) {
    audio.seek(Number(ruler.dataset.seek));
    showPosition();
    return;
  }
  if (event.target.closest('.note-block')) return;
  const cell = event.target.closest('[data-step]');
  if (cell) {
    if (event.detail && suppressClick) return;
    lastCell.tabIndex = -1;
    lastCell = cell;
    cell.tabIndex = 0;
    editCell(cell);
    return;
  }
  const label = event.target.closest('[data-preview]');
  if (label) audition({ pitch: readPitch(label.dataset.preview), length: 2, velocity: 0.77 });
});

grid.addEventListener('keydown', event => {
  const cell = event.target.closest('[data-step]');
  if (!cell || (event.shiftKey && selection.size)) return;
  const pitch = readPitch(cell.dataset.pitch);
  const step = Number(cell.dataset.step);
  const index = instruments[mode].findIndex(item => item.pitch === pitch);
  let next;
  switch (event.key) {
    case 'ArrowLeft': next = rows.get(pitch).cells[step - 1]; break;
    case 'ArrowRight': next = rows.get(pitch).cells[step + 1]; break;
    case 'ArrowUp': next = rows.get(instruments[mode][index - 1]?.pitch)?.cells[step]; break;
    case 'ArrowDown': next = rows.get(instruments[mode][index + 1]?.pitch)?.cells[step]; break;
    case 'Delete':
    case 'Backspace':
      event.preventDefault();
      event.stopPropagation();
      if (selected) deleteSelected();
      else {
        const atCursor = noteAt(pitch, step);
        if (atCursor) { selectNote(atCursor); deleteSelected(); }
      }
      return;
    default: return;
  }
  event.preventDefault();
  if (!next) return;
  lastCell.tabIndex = -1;
  lastCell = next;
  next.tabIndex = 0;
  if (selection.size) selectNote(null);
  next.focus();
});

tabs.forEach(tab => {
  tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  tab.addEventListener('keydown', event => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'piano' : event.key === 'End' ? 'drums' : mode === 'piano' ? 'drums' : 'piano';
    switchMode(next, true);
  });
});

let octave = 4;
let exporting = false;
let suppressClick = false;
let recording = '';
let take = [];
let takeResult = [];
let takeMode = 'piano';
let takeOrigin = '';
let takeBpm = audio.bpm;
let keyStart = null;
let keyTimeout;
let micSession;
let micState = 'idle';
let analysisWorker = null;
let analysing = false;
let method = 'both';
let originalTrack = null;
let resultTrack = null;
let lastTransferred = null;
const held = new Map();
const keyboardButtons = new Map();
const review = $('take-review');
const recordCard = $('mic-record').closest('.mic-record-card');
const takePlayer = new TakePlayer(review, {
  resume: () => audio.resume(),
  beforePlay: stopTransport,
  canPlay: () => !recording,
});

function drawTakePattern() {
  renderPattern($('take-pattern-canvas'), takeResult, STEP_COUNT);
}
new ResizeObserver(drawTakePattern).observe($('take-pattern-canvas'));

function refreshTakeControls({ resetPlayer = false } = {}) {
  const isMic = recording === 'mic';
  const isKeys = recording === 'keys';
  const micLabels = {
    idle: 'Enregistrer au micro',
    opening: 'Annuler',
    recording: 'Terminer la prise',
    stopping: 'Finalisation…',
  };
  recordCard.dataset.recordState = micState;
  $('key-record').textContent = isKeys ? 'Terminer la prise' : 'Enregistrer le clavier';
  $('mic-record-label').textContent = micLabels[micState];
  $('mic-record').disabled = isKeys || micState === 'stopping';
  $('key-record').disabled = isMic;
  $('key-record').setAttribute('aria-pressed', String(isKeys));
  $('mic-record').setAttribute('aria-pressed', String(isMic));
  $('play').disabled = isMic || playPending;
  for (const choice of document.querySelectorAll('[data-listen-mode]')) {
    choice.disabled = Boolean(recording);
    choice.setAttribute('aria-pressed', String(method === choice.dataset.listenMode));
  }
  $('enhance').disabled = Boolean(recording);
  $('tempo').disabled = Boolean(recording);
  $('open-project').disabled = $('clear-pattern').disabled = $('load-example').disabled = Boolean(recording);
  $('transfer').disabled = Boolean(recording) || analysing || !take.length;
  $('key-take-link').hidden = takeOrigin !== 'keys' || !takeResult.length || Boolean(recording);
  $('take-caption').hidden = !takeOrigin || (!originalTrack && !takeResult.length);
  $('take-caption').textContent = takeOrigin === 'keys' ? 'Prise clavier' : 'Prise micro';
  review.dataset.takeState = analysing ? 'analysing' : take.length ? 'ready' : takeResult.length ? 'sent' : 'empty';
  const destination = takeMode === 'drums' ? 'Batterie' : 'Piano';
  const noun = takeMode === 'drums' ? 'frappe' : 'note';
  const count = takeResult.length;
  $('take-summary').textContent = analysing ? 'Analyse en cours…' : count
    ? count + ' ' + noun + (count > 1 ? 's' : '') + ' · ' + destination
    : 'Aucun résultat à transférer.';
  $('take-pattern').classList.toggle('is-empty', !count);
  takePlayer.emptyMessage = recording ? '' : 'La prise apparaîtra après l’enregistrement.';
  takePlayer.setTracks({ original: originalTrack, result: resultTrack }, takeOrigin === 'keys' ? 'result' : 'original', { reset: resetPlayer });
  drawTakePattern();
  syncHistory();
}

function makeResultTrack(notes, bpm) {
  if (!notes.length) return null;
  const end = Math.max(...notes.map(note => note.step + note.length));
  const duration = end * 60 / (bpm * 4) + 0.5;
  return {
    bpm, duration,
    async load() {
      await audio.loadSamples();
      return audio.renderLoop(notes, bpm, duration);
    },
  };
}

function updateMicMonitor(seconds = 0, peak = 0) {
  const level = Math.min(100, Math.max(0, Math.round((60 + 20 * Math.log10(peak)) * (100 / 60))));
  const display = formatTime(seconds);
  if ($('mic-clock').textContent !== display) $('mic-clock').textContent = display;
  $('mic-level').style.setProperty('--level', level + '%');
  $('mic-level').setAttribute('aria-valuenow', String(level));
}

function refreshTakeTempo() {
  $('mic-limit').textContent = formatTime(STEP_COUNT * audio.stepDuration);
  if (resultTrack?.bpm !== audio.bpm) resultTrack = makeResultTrack(takeResult, audio.bpm);
  refreshTakeControls();
}

function arm(kind) {
  if (recording || ((take.length || analysing) && !confirm('Remplacer la prise en attente ?'))) return false;
  takePlayer.pause();
  analysisWorker?.terminate();
  analysisWorker = null;
  analysing = false;
  take = [];
  takeResult = [];
  originalTrack = null;
  resultTrack = null;
  lastTransferred = null;
  $('take-show-grid').hidden = true;
  takeBpm = audio.bpm;
  takeOrigin = kind;
  recording = kind;
  $('take-status').textContent = '';
  $('mic-status').dataset.tone = 'neutral';
  $('mic-status').textContent = '';
  $('key-status').textContent = '';
  updateMicMonitor();
  return true;
}

function describeTake(detected) {
  analysing = false;
  take = detected;
  takeResult = detected;
  resultTrack = makeResultTrack(detected, audio.bpm);
  const count = detected.length;
  $('take-status').textContent = !count && takeOrigin === 'mic'
    ? 'Aucun événement détecté. Tu peux changer le mode ou refaire une prise.'
    : '';
  if (takeOrigin === 'keys') $('key-status').textContent = count ? 'Prise clavier prête.' : 'Aucune note jouée.';
  refreshTakeControls();
}

function releaseKey(id) {
  const item = held.get(id);
  if (!item) return;
  held.delete(id);
  if (![...held.values()].some(other => other.key === item.key)) item.key.classList.remove('is-active');
  if (item.source) audio.release(item.source);
  if (item.note) item.note.length = Math.max(1, Math.min(STEP_COUNT - item.note.step, Math.round((performance.now() - item.started) / (audio.stepDuration * 1000))));
}

function finishKeys() {
  if (recording !== 'keys') return;
  clearTimeout(keyTimeout);
  for (const id of [...held.keys()]) releaseKey(id);
  recording = '';
  describeTake(take);
}

async function pressKey(id, pitch, key) {
  if (recording === 'mic' || held.has(id)) return;
  const started = performance.now();
  const item = { key, started };
  held.set(id, item);
  key.classList.add('is-active');
  if (recording === 'keys') {
    if (keyStart === null) {
      keyStart = started;
      keyTimeout = setTimeout(finishKeys, STEP_COUNT * audio.stepDuration * 1000);
      $('key-status').textContent = 'Enregistrement du clavier en cours…';
    }
    const elapsedSteps = Math.round((started - keyStart) / (audio.stepDuration * 1000));
    const step = audio.playing ? Math.round(audio.position) % STEP_COUNT : elapsedSteps;
    if (step < STEP_COUNT) {
      item.note = { pitch, step, length: 1, velocity: 0.78 };
      take.push(item.note);
    }
  }
  try {
    await prepareAudio();
    if (held.get(id) === item) item.source = audio.preview({ pitch, velocity: 0.78, length: STEP_COUNT });
  } catch { /* prepareAudio displays the error. */ }
}

function setOctave(value) {
  for (const id of [...held.keys()]) releaseKey(id);
  octave = Math.min(5, Math.max(2, value));
  $('octave').textContent = `Do${octave} – Do${octave + 1}`;
  $('oct-down').disabled = octave === 2;
  $('oct-up').disabled = octave === 5;
  keyboardButtons.clear();
  $('keyboard').replaceChildren();
  [...keys].forEach((letter, index) => {
    const pitch = (octave + 1) * 12 + index;
    const name = pitchName(pitch);
    const key = button(name, name.includes('♯') ? 'key is-black' : 'key');
    const shortcut = document.createElement('kbd');
    shortcut.textContent = letter.toUpperCase();
    key.append(shortcut);
    key.setAttribute('aria-label', `Jouer ${name}, touche ${shortcut.textContent}`);
    key.onpointerdown = event => {
      if (event.button !== 0) return;
      key.setPointerCapture(event.pointerId);
      pressKey(event.pointerId, pitch, key);
    };
    key.onpointerup = key.onpointercancel = key.onlostpointercapture = event => releaseKey(event.pointerId);
    key.onclick = event => {
      if (event.detail === 0) {
        pressKey('assist', pitch, key);
        setTimeout(() => releaseKey('assist'), 240);
      }
    };
    $('keyboard').append(key);
    keyboardButtons.set(letter, { pitch, key });
  });
}

$('oct-up').onclick = () => setOctave(octave + 1);
$('oct-down').onclick = () => setOctave(octave - 1);
document.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target.closest?.('input, select, textarea, [contenteditable]')) return;
  if (event.code === 'Space' && !event.target.closest?.('button, a')) {
    event.preventDefault();
    if (!$('play').disabled) togglePlay();
    return;
  }
  if (mode !== 'piano') return;
  const letter = event.key.toLowerCase();
  if (letter === 'w' || letter === 'x') setOctave(octave + (letter === 'x' ? 1 : -1));
  const item = keyboardButtons.get(letter);
  if (item) pressKey(event.code, item.pitch, item.key);
});
document.addEventListener('keyup', event => releaseKey(event.code));
window.addEventListener('blur', () => {
  for (const id of [...held.keys()]) releaseKey(id);
});
$('key-record').onclick = async () => {
  if (recording === 'keys') return finishKeys();
  if (!arm('keys')) return;
  takeMode = 'piano';
  keyStart = null;
  $('key-status').textContent = 'Joue la première note pour démarrer.';
  refreshTakeControls({ resetPlayer: true });
  try {
    await prepareAudio();
  } catch { finishKeys(); }
};

function makeWav(data, rate, channels = 1) {
  const view = new DataView(new ArrayBuffer(44 + data.length * 2));
  const tag = (index, text) => [...text].forEach((char, i) => view.setUint8(index + i, char.charCodeAt(0)));
  tag(0, 'RIFF'); tag(8, 'WAVE'); tag(12, 'fmt '); tag(36, 'data');
  for (const [index, value] of [[4, 36 + data.length * 2], [16, 16], [24, rate], [28, rate * 2 * channels], [40, data.length * 2]]) view.setUint32(index, value, true);
  for (const [index, value] of [[20, 1], [22, channels], [32, channels * 2], [34, 16]]) view.setUint16(index, value, true);
  data.forEach((value, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true));
  return URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
}

function analyseTake() {
  $('listen-help').textContent = {
    both: 'Fredonne une note à la fois. Meloa relève les hauteurs, les départs et les durées.',
    pitch: 'Fredonne une note à la fois. Chaque hauteur détectée sera placée sur un temps.',
    rhythm: 'Tape ton rythme. Chaque attaque détectée déclenchera un kick.',
  }[method];
  if (!originalTrack || recording) return;
  const source = originalTrack;
  const selectedMethod = method;
  const enhanced = $('enhance').checked;
  takeMode = selectedMethod === 'rhythm' ? 'drums' : 'piano';
  analysisWorker?.terminate();
  analysisWorker = null;
  analysing = true;
  take = [];
  takeResult = [];
  resultTrack = null;
  $('take-status').textContent = '';
  lastTransferred = null;
  $('take-show-grid').hidden = true;
  refreshTakeControls();
  const fallback = () => {
    analysisWorker?.terminate();
    analysisWorker = null;
    try {
      describeTake(transcribe(source.samples, source.rate, selectedMethod, takeBpm, enhanced));
    } catch {
      analysing = false;
      $('take-status').textContent = 'Analyse impossible. Réessaie en changeant le mode.';
      refreshTakeControls();
    }
  };
  try {
    const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
    analysisWorker = worker;
    worker.onmessage = ({ data }) => {
      if (worker !== analysisWorker) return;
      worker.terminate();
      analysisWorker = null;
      describeTake(data);
    };
    worker.onerror = event => {
      event.preventDefault();
      if (worker === analysisWorker) fallback();
    };
    worker.postMessage({ samples: source.samples, rate: source.rate, mode: selectedMethod, bpm: takeBpm, enhanced });
  } catch {
    fallback();
  }
}
for (const choice of document.querySelectorAll('[data-listen-mode]')) {
  choice.onclick = () => {
    if (method === choice.dataset.listenMode) return;
    method = choice.dataset.listenMode;
    analyseTake();
    refreshTakeControls();
  };
}
$('enhance').onchange = analyseTake;

function cleanMic(session) {
  clearTimeout(session.deadline);
  clearTimeout(session.stopTimeout);
  if (session.node) session.node.port.onmessage = null;
  session.stream?.getTracks().forEach(track => track.stop());
  session.input?.disconnect();
  session.node?.disconnect();
  if (session.context && session.context.state !== 'closed') session.context.close().catch(() => {});
}
function endMic(session, error) {
  if (micSession !== session) return;
  micSession = null;
  cleanMic(session);
  recording = '';
  micState = 'idle';
  const rate = session.context?.sampleRate;
  updateMicMonitor(rate ? session.samples / rate : 0);
  if (error || !session.samples) {
    $('mic-status').dataset.tone = error === 'Prise annulée.' ? 'neutral' : 'error';
    $('mic-status').textContent = error || 'Prise vide. Réessaie.';
    refreshTakeControls();
    return;
  }
  const samples = new Float32Array(session.samples);
  let offset = 0;
  for (const chunk of session.chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  originalTrack = {
    samples, rate, duration: samples.length / rate,
    load(context) {
      const buffer = context.createBuffer(1, samples.length, rate);
      buffer.copyToChannel(samples, 0);
      return buffer;
    },
  };
  $('mic-status').textContent = 'Prise enregistrée.';
  analyseTake();
}
function finishMic() {
  const session = micSession;
  if (!session || micState === 'stopping') return;
  if (!session.node) return endMic(session, 'Prise annulée.');
  micState = 'stopping';
  $('mic-status').textContent = 'Finalisation de la prise…';
  refreshTakeControls();
  session.node.port.postMessage('stop');
  session.stopTimeout = setTimeout(() => endMic(session), 800);
}

$('mic-record').onclick = async () => {
  if (recording === 'mic') return finishMic();
  if (!arm('mic')) return;
  stop();
  const session = { chunks: [], samples: 0 };
  micSession = session;
  micState = 'opening';
  $('mic-status').textContent = 'Ouverture du microphone…';
  refreshTakeControls({ resetPlayer: true });
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    session.context = new Context();
    await session.context.resume();
    if (session !== micSession) return;
    session.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
    if (session !== micSession) return cleanMic(session);
    await session.context.audioWorklet.addModule(new URL('./recorder.js', import.meta.url));
    if (session !== micSession) return;
    const rate = session.context.sampleRate;
    const frames = Math.ceil(STEP_COUNT * audio.stepDuration * rate);
    session.node = new AudioWorkletNode(session.context, 'meloa-mic', { processorOptions: { frames } });
    session.node.port.onmessage = ({ data }) => {
      if (data === null) return endMic(session);
      session.chunks.push(data);
      session.samples += data.length;
      let peak = 0;
      for (const sample of data) peak = Math.max(peak, Math.abs(sample));
      updateMicMonitor(session.samples / rate, peak);
    };
    session.node.onprocessorerror = () => endMic(session, 'Le microphone a été interrompu. Réessaie.');
    session.input = session.context.createMediaStreamSource(session.stream);
    session.input.connect(session.node);
    session.node.connect(session.context.destination);
    session.stream.getAudioTracks()[0].onended = () => {
      if (micSession === session) finishMic();
    };
    session.deadline = setTimeout(finishMic, frames / rate * 1000 + 350);
    micState = 'recording';
    $('mic-status').textContent = 'Micro ouvert · quatre mesures maximum.';
    refreshTakeControls();
  } catch (error) {
    endMic(session, error.name === 'NotAllowedError'
      ? 'Accès refusé. Autorise le microphone dans ton navigateur.'
      : 'Micro indisponible. Vérifie le périphérique et réessaie.');
  }
};

$('transfer').onclick = () => {
  if (recording || analysing || !take.length) return;
  takePlayer.pause();
  let added = 0;
  let trimmed = 0;
  let firstAdded;
  const skipped = [];
  for (const entry of take) {
    const length = Math.min(entry.length, maxLength(entry.pitch, entry.step));
    if (!length) {
      skipped.push(entry);
      continue;
    }
    if (length < entry.length) trimmed++;
    const note = { ...entry, length };
    notes.push(note);
    firstAdded ??= note;
    audio.refreshStep(note.step);
    added++;
  }
  if (firstAdded) {
    lastTransferred = firstAdded;
    $('take-show-grid').hidden = false;
    switchMode(takeMode);
    selectNote(firstAdded);
    recordChange();
    revealSelected();
  }
  take = skipped;
  refreshTakeControls();
  const noun = takeMode === 'drums' ? 'frappe' : 'note';
  const details = [added ? added + ' ' + noun + (added > 1 ? 's ajoutées.' : ' ajoutée.') : 'Aucun ajout.'];
  if (skipped.length) details.push(skipped.length + ' en attente sur des cases occupées.');
  if (trimmed) details.push(trimmed + (trimmed > 1 ? ' durées raccourcies.' : ' durée raccourcie.'));
  $('take-status').textContent = details.join(' ');
};
$('take-show-grid').onclick = () => {
  if (!notes.includes(lastTransferred)) return;
  switchMode(typeof lastTransferred.pitch === 'number' ? 'piano' : 'drums');
  selectNote(lastTransferred);
  revealSelected();
};
window.addEventListener('pagehide', () => {
  stop();
  if (micSession) endMic(micSession, 'Prise interrompue.');
  if (recording === 'keys') finishKeys();
});
setOctave(4);
analyseTake();
refreshTakeTempo();

for (const [field, control] of Object.entries(controls)) {
  control.addEventListener('change', () => updateSelected(field));
}
noteSettings.addEventListener('submit', event => event.preventDefault());
for (const pitch of [...pitches].reverse()) controls.pitch.add(new Option(pitchName(pitch), pitch));

for (let measure = 0; measure < STEP_COUNT / STEPS_PER_MEASURE; measure += 1) {
  const jump = button('M' + (measure + 1), 'measure-jump');
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 28;
  canvas.setAttribute('aria-hidden', 'true');
  jump.append(canvas);
  jump.setAttribute('aria-label', `Afficher la mesure ${measure + 1}`);
  jump.addEventListener('click', () => {
    const width = grid.clientWidth - grid.querySelector('.grid-label').offsetWidth;
    scroll.scrollLeft = measure * width / (STEP_COUNT / STEPS_PER_MEASURE);
  });
  $('measure-nav').append(jump);
}

$('tempo').addEventListener('change', event => {
  const value = Math.min(210, Math.max(55, Math.round(event.target.valueAsNumber || audio.bpm)));
  event.target.value = value;
  audio.setTempo(value);
  refreshTakeTempo();
  recordChange();
});

$('delete-note').addEventListener('click', deleteSelected);
$('load-example').addEventListener('click', () => refill(example(), 'Remplacer la boucle par l’exemple ?'));
$('clear-pattern').addEventListener('click', () => refill([], 'Effacer les notes et frappes de cette boucle ?'));
$('play').addEventListener('click', togglePlay);
$('stop').addEventListener('click', stop);

function updateOverview() {
  const visible = notes.filter(note => rows.has(note.pitch));
  const indices = new Map(instruments[mode].map((item, i) => [item.pitch, i]));
  const indicesUsed = visible.map(note => indices.get(note.pitch));
  const top = indicesUsed.length ? Math.min(...indicesUsed) : 0;
  const range = indicesUsed.length ? Math.max(4, Math.max(...indicesUsed) - top + 1) : 4;
  document.querySelectorAll('.measure-jump canvas').forEach((canvas, bar) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const start = bar * 16;
    for (const note of visible) {
      const from = Math.max(note.step, start);
      const to = Math.min(note.step + note.length, start + 16);
      if (to <= from) continue;
      ctx.fillStyle = selection.has(note) ? '#ffffff' : mode === 'piano' ? '#ffb889' : '#91dfcc';
      ctx.fillRect((from - start) * 8, 2 + (indices.get(note.pitch) - top) / range * 23, (to - from) * 8 - 1, 2);
    }
  });
}

function noteAt(pitch, step) {
  return notes.find(note => note.pitch === pitch && note.step <= step && step < note.step + note.length);
}

function toggleMember(note) {
  if (selection.has(note)) selection.delete(note);
  else selection.add(note);
  showSelection(note);
}

function targetsFor(dx, dy, resize = false) {
  const voices = instruments[mode];
  return Array.from(selection, note => {
    const index = voices.findIndex(item => item.pitch === note.pitch);
    return {
      ...note,
      pitch: resize ? note.pitch : voices[index + dy]?.pitch,
      step: resize ? note.step : note.step + dx,
      length: resize ? Math.max(1, note.length + dx) : note.length,
    };
  });
}

function canPlace(targets, excluded) {
  return fitsArrangement(notes, targets, excluded);
}

function applyPositions(targets) {
  if (!canPlace(targets, selection)) {
    showSelection(selected, 'Déplacement impossible · case occupée ou limite de la grille.');
    return false;
  }
  const before = [...selection].map(note => note.step);
  [...selection].forEach((note, index) => Object.assign(note, targets[index]));
  new Set(before.concat(targets.map(note => note.step))).forEach(step => audio.refreshStep(step));
  recordChange();
  showSelection(selected);
  return true;
}

function duplicateSelection() {
  if (!selection.size) return;
  const group = [...selection];
  const first = Math.min(...group.map(note => note.step));
  const end = Math.max(...group.map(note => note.step + note.length));
  for (let offset = end - first; end + offset <= STEP_COUNT; offset++) {
    const copies = group.map(note => ({ ...note, step: note.step + offset }));
    if (!canPlace(copies, new Set())) continue;
    notes.push(...copies);
    selection = new Set(copies);
    refreshSteps(copies);
    recordChange();
    showSelection(copies[0]);
    revealSelected();
    return;
  }
  showSelection(selected, 'Aucune place libre après la sélection.');
}

function revealSelected() {
  if (!selected) return;
  const node = blocks.get(selected);
  if (!node) return;
  const frame = scroll.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  const left = frame.left + grid.querySelector('.grid-label').offsetWidth;
  const top = frame.top + grid.querySelector('.grid-header').offsetHeight;
  if (rect.left < left) scroll.scrollLeft += rect.left - left;
  else if (rect.right > frame.right) scroll.scrollLeft += rect.right - frame.right;
  if (rect.top < top) scroll.scrollTop += rect.top - top;
  else if (rect.bottom > frame.bottom) scroll.scrollTop += rect.bottom - frame.bottom;
}

function nudge(direction) {
  if (!selection.size || drag) return;
  const snap = Number($('snap').value);
  const dx = direction === 'left' ? -snap : direction === 'right' ? snap : 0;
  const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  if (applyPositions(targetsFor(dx, dy))) {
    revealSelected();
    if (dy) audition(selected);
  }
}

function chooseTool(next) {
  cancelGesture();
  tool = next;
  grid.dataset.tool = next;
  document.querySelectorAll('button[data-tool]').forEach(item => item.setAttribute('aria-pressed', item.dataset.tool === next));
  $('edit-help').textContent = tips[next];
}
document.querySelectorAll('button[data-tool]').forEach(item => item.onclick = () => chooseTool(item.dataset.tool));
document.querySelectorAll('[data-nudge]').forEach(item => item.onclick = () => nudge(item.dataset.nudge));
$('duplicate').onclick = duplicateSelection;
$('undo').onclick = () => historyStep(false);
$('redo').onclick = () => historyStep(true);
$('zoom').onchange = () => {
  const label = grid.querySelector('.grid-label').offsetWidth;
  const fraction = scroll.scrollLeft / (grid.clientWidth - label);
  grid.style.setProperty('--zoom', $('zoom').value);
  scroll.scrollLeft = fraction * (grid.clientWidth - label);
  revealSelected();
};

function removePreview() {
  cancelAnimationFrame(dragFrame);
  dragFrame = 0;
  if (!drag) return;
  drag.box?.remove();
  for (const node of drag.previews) node.remove();
  for (const note of selection) blocks.get(note)?.classList.remove('in-gesture');
}
function cancelGesture() {
  if (!drag) return;
  const id = drag.id;
  removePreview();
  drag = null;
  if (grid.hasPointerCapture(id)) grid.releasePointerCapture(id);
  showSelection(selected);
}

function createGhost(pitch, start, length, valid) {
  const ghost = document.createElement('i');
  ghost.className = 'note-ghost' + (valid ? '' : ' blocked');
  ghost.style.gridColumn = (start + 1) + ' / span ' + length;
  rows.get(pitch).steps.append(ghost);
  return ghost;
}

function previewGesture() {
  const g = drag;
  if (!g || !g.moved) return;
  const deltaX = g.clientX - g.x;
  const deltaY = g.clientY - g.y;
  if (g.kind === 'pan') {
    scroll.scrollLeft = g.left - deltaX;
    scroll.scrollTop = g.top - deltaY;
    return;
  }
  const dx = deltaX + scroll.scrollLeft - g.left;
  const dy = deltaY + scroll.scrollTop - g.top;
  if (g.kind === 'box') {
    const area = { left: g.originX + Math.min(dx, 0), top: g.originY + Math.min(dy, 0), width: Math.abs(dx), height: Math.abs(dy) };
    Object.assign(g.box.style, { left: area.left + 'px', top: area.top + 'px', width: area.width + 'px', height: area.height + 'px' });
    const bounds = g.box.getBoundingClientRect();
    selection = g.additive ? new Set(g.base) : new Set();
    for (const [note, node] of blocks) {
      const rect = node.getBoundingClientRect();
      if (rect.left < bounds.right && rect.right > bounds.left && rect.top < bounds.bottom && rect.bottom > bounds.top) selection.add(note);
      node.classList.toggle('is-selected', selection.has(note));
    }
    $('edit-help').textContent = selection.size + ' note(s) dans la sélection';
    return;
  }
  const snap = Number($('snap').value);
  const steps = Math.round(dx / g.cell / snap) * snap;
  const rowDelta = Math.round(dy / g.rowHeight);
  if (g.signature === steps + '/' + rowDelta) return;
  g.signature = steps + '/' + rowDelta;
  for (const node of g.previews) node.remove();
  g.previews = [];
  if (g.kind === 'draw') {
    const start = Math.max(0, Math.min(g.start, g.start + steps));
    const end = Math.min(STEP_COUNT, Math.max(g.start, g.start + steps) + snap);
    g.targets = [{ pitch: g.pitch, step: start, length: mode === 'drums' ? 1 : end - start, velocity: 0.74 }];
  } else {
    g.targets = targetsFor(steps, rowDelta, g.kind === 'resize');
  }
  g.valid = canPlace(g.targets, g.kind === 'draw' ? new Set() : selection);
  for (const note of g.targets) {
    if (!rows.has(note.pitch)) continue;
    const from = Math.max(0, note.step);
    const to = Math.min(STEP_COUNT, note.step + note.length);
    if (to > from) g.previews.push(createGhost(note.pitch, from, to - from, g.valid));
  }
  const first = g.targets[0];
  const name = instruments[mode].find(item => item.pitch === first.pitch)?.label;
  $('edit-help').textContent = g.valid
    ? (g.targets.length > 1 ? g.targets.length + ' notes' : name) + ' · ' + stepLabel(first.step) + ' · durée ' + first.length + ' pas'
    : 'Position indisponible · lâche pour garder la position de départ.';
}

function edgeScroll() {
  if (!drag || !drag.moved || drag.kind === 'pan') return;
  const frame = scroll.getBoundingClientRect();
  const left = frame.left + grid.querySelector('.grid-label').offsetWidth;
  const top = frame.top + grid.querySelector('.grid-header').offsetHeight;
  const speed = (point, lo, hi) => point < lo + 15 ? -8 : point > hi - 15 ? 8 : 0;
  const dx = speed(drag.clientX, left, frame.right);
  const dy = speed(drag.clientY, top, frame.bottom);
  if (dx || dy) {
    scroll.scrollLeft += dx;
    scroll.scrollTop += dy;
    previewGesture();
  }
  dragFrame = requestAnimationFrame(edgeScroll);
}

grid.addEventListener('pointerdown', event => {
  if (event.button !== 0 || drag) return;
  suppressClick = false;
  const block = event.target.closest('.note-block');
  const cell = event.target.closest('.step');
  if (!block && !cell) return;
  const pitch = readPitch(block?.dataset.voice ?? cell.dataset.pitch);
  const step = Number(block?.dataset.start ?? cell.dataset.step);
  const note = block && noteAt(pitch, step);
  if (tool === 'erase' && note) {
    selectNote(note);
    deleteSelected();
    suppressClick = true;
    event.preventDefault();
    return;
  }
  if (!note && tool === 'erase') return;
  // Empty cells in pencil mode retain native touch scrolling and tap-to-write.
  if (!note && tool === 'draw' && event.pointerType === 'touch') return;
  const rect = rows.get(pitch).steps.getBoundingClientRect();
  const toggle = tool === 'select' || event.shiftKey;
  let kind;
  if (tool === 'pan') kind = 'pan';
  else if (note) kind = event.target.closest('.resize') ? 'resize' : 'move';
  else kind = toggle ? 'box' : 'draw';
  const base = new Set(selection);
  if (note && kind !== 'pan' && !selection.has(note)) {
    if (!toggle) selection.clear();
    selection.add(note);
    showSelection(note);
  }
  const gridRect = grid.getBoundingClientRect();
  const snap = Number($('snap').value);
  drag = {
    id: event.pointerId, kind, toggle, note, pitch, start: Math.floor(step / snap) * snap, base, cellNode: cell,
    x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY,
    left: scroll.scrollLeft, top: scroll.scrollTop, cell: rect.width / STEP_COUNT, rowHeight: rect.height,
    originX: event.clientX - gridRect.left, originY: event.clientY - gridRect.top, previews: [], moved: false,
  };
  if (kind === 'box') {
    drag.additive = event.shiftKey;
    drag.box = document.createElement('div');
    drag.box.className = 'marquee';
    grid.append(drag.box);
  }
  grid.setPointerCapture(event.pointerId);
  event.preventDefault();
});

grid.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  if (!drag.moved) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    drag.moved = true;
    if (drag.note && drag.kind !== 'pan') {
      for (const note of selection) blocks.get(note)?.classList.add('in-gesture');
    }
    dragFrame = requestAnimationFrame(edgeScroll);
  }
  previewGesture();
});

function finishGesture(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const g = drag;
  suppressClick = true;
  if (event.type !== 'pointerup') {
    selection = new Set(g.base);
    cancelGesture();
    return;
  }
  if (g.moved) {
    g.clientX = event.clientX;
    g.clientY = event.clientY;
    previewGesture();
  }
  removePreview();
  drag = null;
  if (g.kind === 'pan') return;
  if (!g.moved) {
    if (g.note) {
      if (g.toggle && g.base.has(g.note)) toggleMember(g.note);
      else if (g.toggle) showSelection(g.note);
      else selectNote(g.note);
      if (selection.has(g.note)) audition(g.note);
    } else if (g.kind === 'box') selectNote(null);
    else editCell(g.cellNode);
    return;
  }
  if (g.kind === 'box') { showSelection(selected); return; }
  if (!g.valid) { showSelection(selected, 'Position indisponible · position de départ conservée.'); return; }
  if (g.kind === 'draw') {
    const note = g.targets[0];
    notes.push(note);
    selectNote(note);
    refreshSteps([note]);
    recordChange();
    audition(note);
  } else {
    applyPositions(g.targets);
    if (g.kind === 'move' && selected) audition(selected);
  }
}
grid.addEventListener('pointerup', finishGesture);
grid.addEventListener('pointercancel', finishGesture);
grid.addEventListener('lostpointercapture', finishGesture);
grid.addEventListener('contextmenu', event => {
  const block = event.target.closest('.note-block');
  if (!block) return;
  event.preventDefault();
  cancelGesture();
  const note = noteAt(readPitch(block.dataset.voice), Number(block.dataset.start));
  if (!selection.has(note)) selectNote(note);
  deleteSelected();
});

document.addEventListener('keydown', event => {
  if (event.target.closest?.('input, select, textarea, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  const command = event.ctrlKey || event.metaKey;
  if (key === 'escape') {
    if (drag) { selection = new Set(drag.base); cancelGesture(); }
    else selectNote(null);
    return;
  }
  if (drag) return;
  if (command && (key === 'z' || key === 'y')) {
    event.preventDefault();
    historyStep(key === 'y' || event.shiftKey);
  } else if (command && key === 'd' && selection.size) {
    event.preventDefault();
    duplicateSelection();
  } else if (event.shiftKey && key.startsWith('arrow') && selection.size) {
    event.preventDefault();
    nudge(key.slice(5));
  } else if ((key === 'delete' || key === 'backspace') && selection.size) {
    event.preventDefault();
    deleteSelected();
  }
});

$('keyboard-link').onclick = () => switchMode('piano');
document.querySelector('.project-menu').addEventListener('click', event => {
  if (event.target.closest('button')) event.currentTarget.open = false;
});
$('save-project').onclick = () => download(URL.createObjectURL(new Blob([currentSnapshot], { type: 'application/json' })), 'meloa-projet.json');
$('open-project').onclick = () => $('project-file').click();
$('project-file').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || recording) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('Fichier trop volumineux.');
    const project = decodeProject(await file.text());
    if (recording) return;
    restore(project);
    recordChange();
    $('edit-help').textContent = 'Projet ouvert · ' + notes.length + ' événements.';
  } catch { $('edit-help').textContent = 'Ouverture impossible. Choisis un fichier projet Meloa valide.'; }
};
$('export-wav').onclick = async () => {
  if (exporting || !notes.length) return;
  exporting = true;
  syncHistory();
  const snapshot = decodeProject(currentSnapshot);
  $('export-wav').textContent = 'Export en cours…';
  try {
    await prepareAudio();
    const buffer = await audio.renderLoop(snapshot.notes, snapshot.bpm);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const data = new Float32Array(left.length * 2);
    for (let i = 0; i < left.length; i++) {
      data[2 * i] = left[i];
      data[2 * i + 1] = right[i];
    }
    download(makeWav(data, buffer.sampleRate, 2), 'meloa-' + snapshot.bpm + 'bpm.wav');
  } catch { $('status').textContent = 'Export audio impossible. Réessaie.'; }
  finally { exporting = false; $('export-wav').textContent = 'Exporter en WAV'; syncHistory(); }
};
$('tempo').value = audio.bpm;
if (saved) $('save-state').textContent = 'Boucle restaurée';
buildGrid();
chooseTool('draw');
