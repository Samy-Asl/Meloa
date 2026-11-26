export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

const secondsFormat = new Intl.NumberFormat('fr', { maximumFractionDigits: 1 });

function timeLabel(seconds) {
  return secondsFormat.format(seconds) + ' s';
}

function paintCanvas(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * scale)) canvas.width = Math.round(width * scale);
  if (canvas.height !== Math.round(height * scale)) canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function peakBars(channels, count) {
  const peaks = new Float32Array(count);
  for (const samples of channels) {
    for (let i = 0; i < samples.length; i++) {
      const bar = Math.floor(i * count / samples.length);
      peaks[bar] = Math.max(peaks[bar], Math.abs(samples[i]));
    }
  }
  return peaks;
}

export function renderPattern(canvas, notes, stepCount) {
  const surface = paintCanvas(canvas);
  if (!surface) return;
  const { context, width, height } = surface;
  const style = getComputedStyle(canvas.parentElement);
  for (let i = 1; i < 16; i++) {
    context.fillStyle = style.getPropertyValue(i % 4 ? '--preview-tick' : '--preview-guide') || '#273345';
    context.fillRect(Math.round(width * i / 16), 0, 1, height);
  }
  if (!notes.length) return;
  const pitches = notes.map(note => typeof note.pitch === 'number' ? note.pitch : 0);
  const high = Math.max(...pitches);
  const low = Math.min(...pitches);
  const spread = Math.max(4, high - low + 1);
  const pixelsPerStep = width / stepCount;
  context.fillStyle = style.getPropertyValue('--preview-note') || '#82b5ff';
  for (const [i, note] of notes.entries()) {
    const x = note.step * pixelsPerStep;
    const y = 8 + (high - pitches[i] + (spread - 1 - high + low) / 2) / spread * (height - 13);
    context.fillRect(x, y, Math.max(2, note.length * pixelsPerStep - 1), Math.min(5, (height - 12) / spread));
  }
}

export class TakePlayer {
  constructor(review, { resume, beforePlay, canPlay }) {
    this.review = review;
    this.resume = resume;
    this.beforePlay = beforePlay;
    this.canPlay = canPlay;
    this.playButton = review.querySelector('#take-play');
    this.seek = review.querySelector('#take-seek');
    this.canvas = review.querySelector('#take-waveform');
    this.current = review.querySelector('#take-current');
    this.duration = review.querySelector('#take-duration');
    this.status = review.querySelector('#take-player-status');
    this.tabs = [...review.querySelectorAll('[data-take-source]')];
    this.tracks = {};
    this.kind = 'original';
    this.position = 0;
    this.request = 0;
    this.playButton.onclick = () => this.toggle();
    this.seek.oninput = () => this.seekTo(this.seek.valueAsNumber);
    this.tabs.forEach(tab => tab.onclick = () => this.select(tab.dataset.takeSource));
    new ResizeObserver(() => this.drawWaveform()).observe(this.canvas);
  }

  get track() { return this.tracks[this.kind]; }
  get elapsed() {
    if (!this.node) return this.position;
    return Math.min(this.track.duration, this.context.currentTime - this.startedAt);
  }

  setTracks(tracks, preferred, { reset = false } = {}) {
    const kind = reset ? preferred : tracks[this.kind] ? this.kind : preferred;
    const changed = kind !== this.kind || tracks[kind] !== this.track;
    if (changed) this.pause();
    this.tracks = tracks;
    this.kind = kind;
    if (changed) {
      this.position = 0;
      this.error = '';
    }
    this.update();
    if (changed) this.preload();
  }

  select(kind) {
    if (kind === this.kind || !this.tracks[kind]) return;
    this.pause();
    this.kind = kind;
    this.position = 0;
    this.error = '';
    this.update();
    this.preload();
  }

  loadTrack(track, context) {
    track.loading ??= Promise.resolve()
      .then(() => track.load(context))
      .then(buffer => { track.buffer = buffer; })
      .finally(() => { track.loading = null; });
    return track.loading;
  }

  async preload() {
    const track = this.track;
    if (this.kind !== 'result' || !track || track.buffer) return;
    const loading = this.loadTrack(track);
    this.update();
    try {
      await loading;
    } catch {
      if (this.track === track && !this.pending) this.error = 'Aperçu indisponible. Réessaie la lecture.';
    }
    if (this.track === track) this.update();
  }

  pause() {
    ++this.request;
    this.pending = false;
    cancelAnimationFrame(this.frame);
    if (this.node) {
      this.position = this.elapsed;
      this.disconnect();
    }
    this.update();
  }

  disconnect() {
    const node = this.node;
    this.node = null;
    node.onended = null;
    node.stop();
    node.disconnect();
  }

  async toggle() {
    if (this.node || this.pending) return this.pause();
    const track = this.track;
    if (!track || !this.canPlay()) return;
    this.beforePlay();
    this.error = '';
    const request = ++this.request;
    this.pending = true;
    this.update();
    try {
      const context = await this.resume();
      if (request !== this.request) return;
      if (!track.buffer) await this.loadTrack(track, context);
      if (request !== this.request) return;
      this.context = context;
      this.pending = false;
      if (this.position >= track.duration - 0.002) this.position = 0;
      this.start(this.position);
    } catch {
      if (request !== this.request) return;
      this.pending = false;
      this.error = 'Lecture impossible. Réessaie.';
      this.update();
    }
  }

  start(position) {
    const node = this.context.createBufferSource();
    try {
      node.buffer = this.track.buffer;
      node.connect(this.context.destination);
      node.start(0, position);
    } catch (error) {
      node.disconnect();
      throw error;
    }
    this.node = node;
    this.startedAt = this.context.currentTime - position;
    node.onended = () => {
      if (this.node !== node) return;
      node.disconnect();
      this.node = null;
      this.position = this.track.duration;
      this.update();
    };
    cancelAnimationFrame(this.frame);
    this.tick();
    this.update();
  }

  seekTo(position) {
    if (!this.track || !Number.isFinite(position)) return;
    this.position = Math.max(0, Math.min(this.track.duration, position));
    if (this.node) {
      this.disconnect();
      cancelAnimationFrame(this.frame);
      try {
        if (this.position < this.track.duration - 0.002) this.start(this.position);
      } catch {
        this.error = 'Lecture impossible. Réessaie.';
      }
    }
    this.update();
  }

  tick() {
    if (!this.node) return;
    this.updateTime();
    this.frame = requestAnimationFrame(() => this.tick());
  }

  update() {
    const track = this.track;
    this.review.dataset.source = this.kind;
    this.review.dataset.playing = String(Boolean(this.node));
    this.review.dataset.playerBusy = String(Boolean(this.pending));
    this.playButton.disabled = !track || !this.canPlay();
    this.playButton.setAttribute('aria-label', this.pending ? 'Annuler la lecture' : this.node ? 'Mettre en pause' : 'Lire la prise');
    this.seek.disabled = !track || !this.canPlay();
    this.seek.max = String(track?.duration ?? 0);
    for (const tab of this.tabs) {
      tab.disabled = !this.tracks[tab.dataset.takeSource] || !this.canPlay();
      tab.setAttribute('aria-pressed', String(tab.dataset.takeSource === this.kind));
    }
    this.status.dataset.tone = this.error ? 'error' : 'neutral';
    if (this.error) this.status.textContent = this.error;
    else if (this.pending) this.status.textContent = 'Préparation de la lecture…';
    else if (track?.loading) this.status.textContent = 'Préparation de la forme d’onde…';
    else this.status.textContent = track ? '' : this.emptyMessage || '';
    this.updateTime();
  }

  updateTime() {
    const elapsed = this.elapsed;
    const duration = this.track?.duration ?? 0;
    const clock = duration > 0 && duration < 1 ? timeLabel : formatTime;
    const currentText = clock(elapsed);
    const durationText = clock(duration);
    if (this.current.textContent !== currentText) this.current.textContent = currentText;
    if (this.duration.textContent !== durationText) this.duration.textContent = durationText;
    this.seek.value = String(elapsed);
    const valueText = timeLabel(elapsed) + ' sur ' + timeLabel(duration);
    if (this.seek.getAttribute('aria-valuetext') !== valueText) this.seek.setAttribute('aria-valuetext', valueText);
    this.canvas.parentElement.style.setProperty('--progress', (duration ? 100 * elapsed / duration : 0) + '%');
    this.drawWaveform();
  }

  drawWaveform() {
    const surface = paintCanvas(this.canvas);
    if (!surface) return;
    const { context, width, height } = surface;
    const style = getComputedStyle(this.canvas.parentElement);
    const count = Math.max(1, Math.floor(width / 4));
    const spacing = width / count;
    const track = this.track;
    const channels = track?.samples ? [track.samples] : track?.buffer ? Array.from(
      { length: track.buffer.numberOfChannels }, (_, i) => track.buffer.getChannelData(i)) : null;
    if (channels && (this.peakTrack !== track || this.peaks?.length !== count)) {
      this.peakTrack = track;
      this.peaks = peakBars(channels, count);
    }
    const progress = track?.duration ? this.elapsed / track.duration : 0;
    const played = style.getPropertyValue('--wave-played') || '#91bcff';
    const unplayed = style.getPropertyValue('--wave-track') || '#3d577e';
    const empty = style.getPropertyValue('--wave-empty') || '#293344';
    for (let i = 0; i < count; i++) {
      const amplitude = channels ? Math.min(1, Math.sqrt(this.peaks[i])) : 0;
      const size = 2 + amplitude * (height - 10);
      context.fillStyle = channels ? (i < progress * count ? played : unplayed) : empty;
      context.fillRect(i * spacing + 1, (height - size) / 2, spacing - 1.5, size);
    }
  }
}
