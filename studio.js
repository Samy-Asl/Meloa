import { transcribe } from './listen.js';
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
const help = {
  piano: 'Clique pour écrire, glisse une note pour la déplacer ou tire son bord droit pour l’allonger.',
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
      block.dataset.start = note.step;
      block.dataset.voice = note.pitch;
      if (mode === 'piano') {
        const grip = document.createElement('span');
        grip.className = 'resize';
        block.append(grip);
      }
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
  const pitch = mode === 'drums' ? selected.pitch : Number(controls.pitch.value);
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
  if (event.target.closest('.note-block')) return;
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

let octave = 4;
let recording = '';
let take = [];
let takeMode = 'piano';
let keyStart = null;
let keyTimeout;
let micSession;
let originalPCM;
let originalURL;
let takeBpm = audio.bpm;
const held = new Map();
const keyboardButtons = new Map();
const say = message => { $('take-status').textContent = message; };

function refreshTakeControls() {
  $('key-record').textContent = recording === 'keys' ? 'Terminer la prise' : 'Enregistrer le clavier';
  $('mic-record').textContent = recording === 'mic' ? 'Terminer la prise' : 'Enregistrer au micro';
  $('mic-record').disabled = recording === 'keys';
  $('key-record').disabled = recording === 'mic';
  $('key-record').setAttribute('aria-pressed', recording === 'keys');
  $('mic-record').setAttribute('aria-pressed', recording === 'mic');
  $('transfer').hidden = !!recording || !take.length;
  $('tempo').disabled = !!recording;
}

function clearOriginal() {
  originalPCM = null;
  $('original').pause();
  $('original').removeAttribute('src');
  $('original').load();
  $('original').hidden = true;
  if (originalURL) URL.revokeObjectURL(originalURL);
  originalURL = null;
}

function arm(kind) {
  if (recording || (take.length && !confirm('Remplacer la prise en attente ?'))) return false;
  take = [];
  clearOriginal();
  takeBpm = audio.bpm;
  recording = kind;
  $(kind === 'keys' ? 'keyboard-panel' : 'listen-panel').after($('take-bar'));
  refreshTakeControls();
  return true;
}

function describeTake() {
  const count = take.length;
  say(count ? `${count} événement${count > 1 ? 's' : ''} à ajouter à la piste ${takeMode === 'piano' ? 'piano' : 'batterie'}.` : 'Aucun événement détecté. Essaie une prise plus nette ou change le mode.');
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
  describeTake();
}

async function pressKey(id, pitch, key) {
  if (held.has(id)) return;
  const started = performance.now();
  const item = { key, started };
  held.set(id, item);
  key.classList.add('is-active');
  if (recording === 'keys') {
    if (keyStart === null) {
      keyStart = started;
      keyTimeout = setTimeout(finishKeys, STEP_COUNT * audio.stepDuration * 1000);
      say('Enregistrement du clavier en cours…');
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
  try {
    await prepareAudio();
    if (recording === 'keys' && keyStart === null) say('Joue ta première note pour lancer les quatre mesures.');
  } catch { finishKeys(); }
};

function makeWav(data, rate) {
  const view = new DataView(new ArrayBuffer(44 + data.length * 2));
  const tag = (index, text) => [...text].forEach((char, i) => view.setUint8(index + i, char.charCodeAt(0)));
  tag(0, 'RIFF'); tag(8, 'WAVE'); tag(12, 'fmt '); tag(36, 'data');
  for (const [index, value] of [[4, 36 + data.length * 2], [16, 16], [24, rate], [28, rate * 2], [40, data.length * 2]]) view.setUint32(index, value, true);
  for (const [index, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(index, value, true);
  data.forEach((value, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true));
  return URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
}

function analyseTake() {
  const method = $('listen-mode').value;
  $('listen-help').textContent = {
    both: 'Fredonne une mélodie, une note à la fois. Les notes et leurs durées seront placées sur la grille.',
    pitch: 'Fredonne une mélodie, une note à la fois. Chaque hauteur détectée occupera un temps.',
    rhythm: 'Tape un rythme. Chaque attaque détectée deviendra un kick sur la grille.',
  }[method];
  if (!originalPCM || recording) return;
  takeMode = method === 'rhythm' ? 'drums' : 'piano';
  take = transcribe(originalPCM.data, originalPCM.rate, method, takeBpm, $('enhance').checked);
  describeTake();
}
$('listen-mode').onchange = $('enhance').onchange = analyseTake;

function cleanMic(session) {
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
  refreshTakeControls();
  if (error || !session.chunks.length) {
    say(error || 'Prise micro vide.');
    return;
  }
  const data = new Float32Array(session.chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of session.chunks) { data.set(chunk, offset); offset += chunk.length; }
  originalPCM = { data, rate: session.context.sampleRate };
  originalURL = makeWav(data, originalPCM.rate);
  $('original').src = originalURL;
  $('original').hidden = false;
  analyseTake();
}
function finishMic() {
  if (!micSession) return;
  if (micSession.node) micSession.node.port.postMessage('stop');
  else endMic(micSession, 'Prise annulée.');
}

$('mic-record').onclick = async () => {
  if (recording === 'mic') return finishMic();
  if (!arm('mic')) return;
  stop();
  const session = { chunks: [] };
  micSession = session;
  say('Ouverture du microphone…');
  try {
    session.context = new AudioContext();
    await session.context.resume();
    if (session !== micSession) return;
    session.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    if (session !== micSession) return cleanMic(session);
    await session.context.audioWorklet.addModule(new URL('./recorder.js', import.meta.url));
    if (session !== micSession) return;
    session.node = new AudioWorkletNode(session.context, 'meloa-mic', { processorOptions: { frames: Math.ceil(STEP_COUNT * audio.stepDuration * session.context.sampleRate) } });
    session.node.port.onmessage = ({ data }) => {
      if (data === null) endMic(session);
      else session.chunks.push(data);
    };
    session.input = session.context.createMediaStreamSource(session.stream);
    session.input.connect(session.node);
    session.node.connect(session.context.destination);
    session.stream.getAudioTracks()[0].onended = finishMic;
    say('Micro ouvert · quatre mesures maximum. Termine la prise quand tu veux.');
  } catch (error) {
    endMic(session, error.name === 'NotAllowedError' ? 'Accès au micro refusé. Autorise le microphone pour enregistrer.' : 'Micro indisponible. Vérifie le périphérique et réessaie.');
  }
};

$('transfer').onclick = () => {
  if (recording || !take.length) return;
  let added = 0;
  const total = take.length;
  let firstAdded;
  const skipped = [];
  for (const entry of take) {
    const length = Math.min(entry.length, maxLength(entry.pitch, entry.step));
    if (!length) {
      skipped.push(entry);
      continue;
    }
    const note = { ...entry, length };
    notes.push(note);
    firstAdded ??= note;
    audio.refreshStep(note.step);
    added++;
  }
  switchMode(takeMode);
  selectNote(firstAdded);
  if (firstAdded) rows.get(firstAdded.pitch).cells[firstAdded.step].scrollIntoView({block:'nearest', inline:'nearest'});
  take = skipped;
  refreshTakeControls();
  say(`${added} / ${total} ajouté(s) à la grille.${added < total ? ' Les positions déjà occupées ont été conservées.' : ''}`);
};
window.addEventListener('pagehide', () => {
  if (micSession) endMic(micSession, 'Prise interrompue.');
  if (recording === 'keys') finishKeys();
});
setOctave(4);
analyseTake();
refreshTakeControls();

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

let drag;
grid.addEventListener('pointerdown', event => {
  const block = event.target.closest('.note-block');
  if (!block || event.button !== 0 || drag) return;
  const pitch = readPitch(block.dataset.voice);
  const note = notes.find(item => item.pitch === pitch && item.step === Number(block.dataset.start));
  if (!note) return;
  const rect = rows.get(pitch).steps.getBoundingClientRect();
  const resize = event.target.classList.contains('resize');
  drag = {
    id: event.pointerId, block, note, resize,
    x: event.clientX, y: event.clientY, cellWidth: rect.width / STEP_COUNT,
    rowHeight: rect.height, target: { ...note },
  };
  grid.setPointerCapture(event.pointerId);
  block.classList.add('dragging');
  event.preventDefault();
});

grid.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const { note, cellWidth, rowHeight } = drag;
  const dx = Math.round((event.clientX - drag.x) / cellWidth);
  const dy = Math.round((event.clientY - drag.y) / rowHeight);
  const voices = instruments[mode];
  const index = voices.findIndex(item => item.pitch === note.pitch);
  const row = drag.resize ? index : Math.min(voices.length - 1, Math.max(0, index + dy));
  const pitch = voices[row].pitch;
  const step = drag.resize ? note.step : Math.max(0, Math.min(STEP_COUNT - note.length, note.step + dx));
  const length = drag.resize ? Math.max(1, Math.min(STEP_COUNT - step, note.length + dx)) : note.length;
  if (maxLength(pitch, step, note) < length) return;
  drag.target = { pitch, step, length };
  drag.block.style.transform = `translate(${(step - note.step) * cellWidth}px, ${(row - index) * rowHeight}px)`;
  drag.block.style.gridColumnEnd = `span ${length}`;
});

function finishDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const { note, target } = drag;
  drag = null;
  if (event.type === 'pointerup') {
    const oldStep = note.step;
    Object.assign(note, target);
    audio.refreshStep(oldStep);
    if (note.step !== oldStep) audio.refreshStep(note.step);
  }
  selectNote(note);
}
grid.addEventListener('pointerup', finishDrag);
grid.addEventListener('pointercancel', finishDrag);
grid.addEventListener('lostpointercapture', finishDrag);
grid.addEventListener('contextmenu', event => {
  const block = event.target.closest('.note-block');
  if (!block) return;
  event.preventDefault();
  selected = notes.find(note => note.pitch === readPitch(block.dataset.voice) && note.step === Number(block.dataset.start));
  deleteSelected();
});
$('duplicate').onclick = () => {
  if (!selected) return;
  for (let step = selected.step + selected.length; step <= STEP_COUNT - selected.length; step++) {
    if (maxLength(selected.pitch, step) < selected.length) continue;
    const copy = { ...selected, step };
    notes.push(copy);
    audio.refreshStep(step);
    selectNote(copy);
    return;
  }
  selectNote(selected, 'Aucune place libre après cette note.');
};
