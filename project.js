import { DRUMS, STEP_COUNT } from './audio.js';

const FORMAT = 'meloa-studio';
const STORAGE_KEY = 'meloa.studio.loop.v1';
const voices = new Set(DRUMS.map(item => item.id));

export function encodeProject(notes, bpm) {
  return JSON.stringify({ format: FORMAT, version: 1, bpm, notes });
}

export function decodeProject(text) {
  const project = JSON.parse(text);
  if (project?.format !== FORMAT || project.version !== 1 || !Array.isArray(project.notes) ||
      project.notes.length > 53 * STEP_COUNT || !Number.isInteger(project.bpm) || project.bpm < 55 || project.bpm > 210) {
    throw new Error('Format de projet inconnu.');
  }
  const notes = project.notes.map(({ pitch, step, length, velocity }) => ({ pitch, step, length, velocity }));
  if (!fitsArrangement([], notes, new Set())) throw new Error('Notes invalides ou superposées.');
  return { bpm: project.bpm, notes };
}

// All notes in a gesture must fit together before any part of the edit is applied.
export function fitsArrangement(existing, targets, excluded) {
  const occupied = new Map();
  function reserve(note) {
    let row = occupied.get(note.pitch);
    if (!row) {
      row = new Uint8Array(STEP_COUNT);
      occupied.set(note.pitch, row);
    }
    const end = note.step + note.length;
    for (let i = note.step; i < end; i++) {
      if (row[i]) return false;
      row[i] = 1;
    }
    return true;
  }
  for (const note of existing) if (!excluded.has(note)) reserve(note);
  return targets.every(note => {
    const piano = Number.isInteger(note.pitch) && note.pitch >= 36 && note.pitch <= 84;
    if (!piano && (!voices.has(note.pitch) || note.length !== 1)) return false;
    if (!Number.isInteger(note.step) || note.step < 0 || !Number.isInteger(note.length) ||
        note.length < 1 || note.step + note.length > STEP_COUNT) return false;
    return Number.isFinite(note.velocity) && note.velocity >= 0 && note.velocity <= 1 && reserve(note);
  });
}

export function readSaved() {
  const text = localStorage.getItem(STORAGE_KEY);
  return text && decodeProject(text);
}

export function saveLocal(text) {
  localStorage.setItem(STORAGE_KEY, text);
}

export function download(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
