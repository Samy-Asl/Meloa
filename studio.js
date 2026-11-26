import { DRUMS, STEP_COUNT, STEPS_PER_MEASURE, StudioAudio } from './audio.js';

const $ = id => document.getElementById(id);
const grid = $('grid');
const scroll = $('grid-scroll');
const tabs = [...document.querySelectorAll('[role="tab"]')];
const noteSettings = $('note-settings');
const pitchClasses = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const pitches = Array.from({ length: 25 }, (_, index) => 72 - index);
const keys = 'qzsedftgyhujk';
const instruments = {
  piano: pitches.map(pitch => ({ pitch, label: pitchName(pitch), natural: !pitchName(pitch).includes('♯') })),
  drums: DRUMS.map(drum => ({ pitch: drum.id, label: drum.label, natural: true })),
};
const controls = {
  step: $('note-step'), length: $('note-length'), pitch: $('note-pitch'), velocity: $('note-velocity'),
};
const help = {
  piano: 'Clique sur une case pour ajouter une note ou sur une note pour la modifier.',
  drums: 'Clique sur une case pour ajouter une frappe ou sur une frappe pour la modifier.',
};

let notes = example();
let mode = 'piano';
let selected = null;
let rows = new Map();
let lastCell = null;
let animation = null;
let playRequest = 0;
let auditionSession = 0;
let loadingAudio = null;

const audio = new StudioAudio(step => notes.filter(note => note.step === step), 92);

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
    const label = document.createElement('span');
    label.textContent = `Mesure ${bar}`;
    measures.append(label);
  }
  header.append(title, measures);

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
    rows.set(pitch, { steps, cells });
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
  for (const [pitch, { steps, cells }] of rows) {
    steps.querySelectorAll('.note-block').forEach(block => block.remove());
    const covered = new Set();
    for (const note of notes) {
      if (note.pitch !== pitch) continue;
      const block = document.createElement('span');
      block.className = 'note-block';
      block.classList.toggle('is-selected', note === selected);
      block.style.gridColumn = `${note.step + 1} / span ${note.length}`;
      block.style.opacity = 0.48 + note.velocity * 0.52;
      block.setAttribute('aria-hidden', 'true');
      steps.append(block);
      for (let step = note.step; step < note.step + note.length; step += 1) covered.add(step);
    }
    cells.forEach((cell, step) => cell.setAttribute('aria-pressed', covered.has(step)));
  }
}

function selectNote(note, message) {
  selected = note;
  noteSettings.hidden = !note;
  $('edit-help').textContent = message || (note
    ? `${instruments[mode].find(item => item.pitch === note.pitch).label} · ${stepLabel(note.step)}`
    : help[mode]);
  if (note) {
    controls.step.value = note.step + 1;
    controls.length.value = note.length;
    controls.length.max = maxLength(note.pitch, note.step, note);
    controls.pitch.value = note.pitch;
    controls.velocity.value = Math.round(note.velocity * 100);
  }
  renderNotes();
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
  const step = Number(cell.dataset.step);
  const pitch = readPitch(cell.dataset.pitch);
  const existing = notes.find(note => note.pitch === pitch && note.step <= step && step < note.step + note.length);
  if (existing) {
    selectNote(existing);
    return;
  }
  const note = { pitch, step, length: Math.min(mode === 'piano' ? 2 : 1, maxLength(pitch, step)), velocity: 0.74 };
  notes.push(note);
  audio.refreshStep(step);
  selectNote(note);
  audition(note);
}

function updateSelected(field) {
  if (!selected) return;
  const step = controls.step.valueAsNumber - 1;
  const pitch = readPitch(controls.pitch.value);
  const available = maxLength(pitch, step, selected);
  if (!Number.isInteger(step) || step < 0 || step >= STEP_COUNT || !available) {
    selectNote(selected, 'Choisis un départ libre dans les quatre mesures.');
    return;
  }
  const length = mode === 'drums' ? 1 : Math.min(Math.max(1, Math.round(controls.length.valueAsNumber || 1)), available);
  const previousStep = selected.step;
  const pitchChanged = selected.pitch !== pitch;
  Object.assign(selected, { pitch, step, length, velocity: controls.velocity.valueAsNumber / 100 });
  audio.refreshStep(previousStep);
  if (previousStep !== step) audio.refreshStep(step);
  selectNote(selected);
  if (field === 'velocity' || pitchChanged) audition(selected);
}

function deleteSelected() {
  if (!selected) return;
  const step = selected.step;
  notes = notes.filter(note => note !== selected);
  audio.refreshStep(step);
  selectNote(null);
  lastCell.focus({ preventScroll: true });
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
  const session = auditionSession;
  try {
    await prepareAudio();
    if (session === auditionSession) audio.preview({ ...note, length: Math.min(note.length, 3) });
  } catch {
    // The status above offers a retry on the next interaction.
  }
}

async function togglePlay() {
  if (audio.playing) {
    audio.pause();
    updateTransport();
    return;
  }
  const request = ++playRequest;
  $('play').disabled = true;
  try {
    await prepareAudio();
    if (request !== playRequest) return;
    audio.start();
    updateTransport();
  } catch {
    // Keep the play button available for a retry.
  } finally {
    if (request === playRequest) $('play').disabled = false;
  }
}

function stop() {
  playRequest += 1;
  auditionSession += 1;
  audio.stop();
  $('play').disabled = false;
  updateTransport();
}

function showPosition() {
  const position = audio.position;
  const measure = Math.floor(position / STEPS_PER_MEASURE) + 1;
  const beat = Math.floor(position % STEPS_PER_MEASURE / 4) + 1;
  const display = `0${measure} · 0${beat}`;
  if ($('position').value !== display) $('position').value = display;
  grid.classList.toggle('is-running', audio.playing || position > 0);
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
  mode = next;
  selected = null;
  for (const tab of tabs) {
    const active = tab.dataset.mode === mode;
    tab.tabIndex = active ? 0 : -1;
    tab.setAttribute('aria-selected', active);
    if (active && focus) tab.focus();
  }
  $('instrument-panel').setAttribute('aria-labelledby', mode === 'piano' ? 'piano-tab' : 'drums-tab');
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
}

grid.addEventListener('click', event => {
  const cell = event.target.closest('[data-step]');
  if (cell) {
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
  if (!cell) return;
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
      if (selected) deleteSelected();
      return;
    default: return;
  }
  event.preventDefault();
  if (!next) return;
  lastCell.tabIndex = -1;
  lastCell = next;
  next.tabIndex = 0;
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

const keyboardButtons = new Map();
for (let index = 0; index < keys.length; index += 1) {
  const pitch = 60 + index;
  const note = pitchName(pitch);
  const key = button(note, note.includes('♯') ? 'key is-black' : 'key');
  const shortcut = document.createElement('kbd');
  shortcut.textContent = keys[index].toUpperCase();
  key.append(shortcut);
  key.setAttribute('aria-label', `Jouer ${note}, touche ${shortcut.textContent}`);
  key.addEventListener('click', () => touchKey(pitch, key));
  keyboardButtons.set(keys[index], { pitch, key });
  $('keyboard').append(key);
}

function touchKey(pitch, key) {
  key.classList.add('is-active');
  setTimeout(() => key.classList.remove('is-active'), 180);
  audition({ pitch, length: 3, velocity: 0.78 });
}

document.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target.closest?.('input, select, textarea, [contenteditable]')) return;
  if (event.code === 'Space' && !event.target.closest?.('button, a')) {
    event.preventDefault();
    if (!$('play').disabled) togglePlay();
    return;
  }
  const key = keyboardButtons.get(event.key.toLowerCase());
  if (key && mode === 'piano') touchKey(key.pitch, key.key);
});

for (const [field, control] of Object.entries(controls)) {
  control.addEventListener('change', () => updateSelected(field));
}
noteSettings.addEventListener('submit', event => event.preventDefault());
for (const pitch of [...pitches].reverse()) controls.pitch.add(new Option(pitchName(pitch), pitch));

for (let measure = 0; measure < STEP_COUNT / STEPS_PER_MEASURE; measure += 1) {
  const jump = button(`M${measure + 1}`, 'measure-jump');
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
});

$('delete-note').addEventListener('click', deleteSelected);
$('load-example').addEventListener('click', () => refill(example(), 'Remplacer la boucle par l’exemple ?'));
$('clear-pattern').addEventListener('click', () => refill([], 'Effacer les notes et frappes de cette boucle ?'));
$('play').addEventListener('click', togglePlay);
$('stop').addEventListener('click', stop);

buildGrid();
