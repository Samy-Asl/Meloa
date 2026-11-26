export const STEPS_PER_MEASURE = 16;
export const STEP_COUNT = 4 * STEPS_PER_MEASURE;

export const DRUMS = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Caisse claire' },
  { id: 'hat-closed', label: 'Charley fermé' },
  { id: 'hat-open', label: 'Charley ouvert' },
];

const PIANO_ROOTS = [48, 51, 54, 57, 60, 63, 66, 69, 72];
const DRUM_SAMPLES = DRUMS.flatMap(({ id }) => id === 'hat-open'
  ? [id] : [`${id}-soft`, `${id}-hard`]);
const SAMPLE_FILES = [
  ...PIANO_ROOTS.flatMap(pitch => ['soft', 'hard'].map(layer => `piano/${pitch}-${layer}.mp3`)),
  ...DRUM_SAMPLES.map(name => `drums/${name}.wav`),
];
const LOOKAHEAD = 0.12;
const START_DELAY = 0.045;

export class StudioAudio {
  constructor(notesAtStep, bpm) {
    this.notesAtStep = notesAtStep;
    this.bpm = bpm;
    this.buffers = new Map();
    this.voices = new Map();
    this.cursor = 0;
    this.timer = null;
  }

  get playing() { return this.timer !== null; }

  async ready() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      this.context = new Context({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = 0.68;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -11;
      limiter.knee.value = 9;
      limiter.ratio.value = 4;
      this.master.connect(limiter);
      limiter.connect(this.context.destination);
    }
    const resume = this.context.resume();
    this.loading ??= Promise.all(SAMPLE_FILES.map(async file => {
      if (this.buffers.has(file)) return;
      const response = await fetch(new URL(`./assets/${file}`, import.meta.url));
      if (!response.ok) throw new Error(`Échantillon indisponible : ${file}`);
      this.buffers.set(file, await this.context.decodeAudioData(await response.arrayBuffer()));
    })).catch(error => {
      this.loading = null;
      throw error;
    });
    await Promise.all([resume, this.loading]);
  }

  get stepDuration() { return 60 / (this.bpm * 4); }

  get position() {
    if (!this.playing) return this.cursor;
    const elapsed = Math.max(0, this.context.currentTime - this.referenceTime);
    return (this.referencePosition + elapsed / this.stepDuration) % STEP_COUNT;
  }

  start() {
    if (this.playing) return;
    this.referenceTime = this.context.currentTime + START_DELAY;
    this.referencePosition = this.cursor;
    this.nextStep = Math.ceil(this.cursor);
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  pause() {
    this.cursor = this.position;
    clearInterval(this.timer);
    this.timer = null;
    this.cancelVoices();
  }

  stop() {
    this.pause();
    this.cursor = 0;
  }

  setTempo(bpm) {
    if (this.bpm === bpm) return;
    if (!this.playing) {
      this.bpm = bpm;
      return;
    }
    const now = this.context.currentTime;
    const countIn = this.referenceTime > now;
    this.referencePosition = this.position;
    if (!countIn) this.referenceTime = now;
    this.bpm = bpm;
    this.cancelVoices(voice => voice.step !== null && voice.time > now);
    this.nextStep = countIn ? Math.ceil(this.referencePosition) : Math.floor(this.referencePosition) + 1;
    this.schedule();
  }

  timeAt(step) {
    return this.referenceTime + (step - this.referencePosition) * this.stepDuration;
  }

  schedule() {
    const now = this.context.currentTime;
    if (this.timeAt(this.nextStep) < now) {
      this.nextStep = Math.ceil(this.referencePosition + (now - this.referenceTime) / this.stepDuration);
    }
    while (this.timeAt(this.nextStep) <= now + LOOKAHEAD) {
      this.scheduleStep(this.nextStep);
      this.nextStep += 1;
    }
  }

  scheduleStep(step) {
    const time = this.timeAt(step);
    for (const note of this.notesAtStep(step % STEP_COUNT)) this.playNote(note, time, step);
  }

  refreshStep(step) {
    if (!this.playing) return;
    const nextCycle = Math.floor(this.nextStep / STEP_COUNT);
    let scheduled = nextCycle * STEP_COUNT + step;
    if (scheduled >= this.nextStep) scheduled -= STEP_COUNT;
    const now = this.context.currentTime;
    if (scheduled < 0 || this.timeAt(scheduled) <= now + 0.005) return;
    this.cancelVoices(voice => voice.step === scheduled);
    this.scheduleStep(scheduled);
  }

  preview(note) {
    return this.playNote(note, this.context.currentTime);
  }

  playNote(note, time, step = null) {
    const { pitch, velocity } = note;
    const layer = velocity < 0.68 ? 'soft' : 'hard';
    let file;
    let rate = 1;
    let duration;
    if (typeof pitch === 'number') {
      const root = PIANO_ROOTS.reduce((closest, candidate) =>
        Math.abs(pitch - candidate) < Math.abs(pitch - closest) ? candidate : closest);
      file = `piano/${root}-${layer}.mp3`;
      rate = 2 ** ((pitch - root) / 12);
      duration = note.length * this.stepDuration;
    } else {
      const name = pitch === 'hat-open' ? pitch : `${pitch}-${layer}`;
      file = `drums/${name}.wav`;
    }
    const buffer = this.buffers.get(file);
    if (!buffer) return;

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = 0.32 + velocity * 0.68;
    source.connect(gain);
    gain.connect(this.master);
    this.voices.set(source, { time, step, gain });
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start(time);

    if (duration !== undefined) {
      const end = time + Math.min(duration, buffer.duration / rate);
      gain.gain.setValueAtTime(gain.gain.value, end);
      gain.gain.linearRampToValueAtTime(0, end + 0.095);
      source.stop(end + 0.10);
    }
    return source;
  }

  cancelVoices(matches = () => true) {
    for (const [source, voice] of this.voices) {
      if (!matches(voice)) continue;
      // Disconnect immediately so already queued sources cannot leak past Stop.
      voice.gain.disconnect();
      source.stop();
      this.voices.delete(source);
    }
  }
}
