// Work at roughly 8 kHz. Averaging input samples attenuates high-frequency noise.
function downsample(input, rate) {
  const stride = Math.max(1, Math.round(rate / 8000));
  const data = new Float32Array(Math.floor(input.length / stride));
  for (let i = 0; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < stride; j++) sum += input[i * stride + j];
    data[i] = sum / stride;
  }
  return { data, rate: rate / stride };
}

function pitchAt(data, offset, rate, enhanced) {
  const length = Math.floor(rate * 0.024);
  const maxLag = Math.ceil(rate / 62);
  if (offset + length + maxLag >= data.length) return null;
  let total = 0;
  let previous = 1;
  const threshold = enhanced ? 0.20 : 0.30;
  // YIN cumulative mean normalized difference, first local minimum below threshold.
  for (let lag = 1; lag <= maxLag; lag++) {
    let difference = 0;
    for (let i = 0; i < length; i++) {
      const delta = data[offset + i] - data[offset + i + lag];
      difference += delta * delta;
    }
    total += difference;
    const value = total ? difference * lag / total : 1;
    if (lag > rate / 1100 && previous < threshold && value >= previous) {
      const midi = Math.round(69 + 12 * Math.log2(rate / (lag - 1) / 440));
      return midi >= 36 && midi <= 84 ? midi : null;
    }
    previous = value;
  }
  return null;
}

export function transcribe(input, sampleRate, mode, bpm, enhanced) {
  const { data, rate } = downsample(input, sampleRate);
  const hop = Math.max(1, Math.round(rate * 0.012));
  const frames = [];
  for (let offset = 0; offset + hop <= data.length; offset += hop) {
    let sum = 0;
    for (let i = offset; i < offset + hop; i++) sum += data[i] * data[i];
    frames.push(Math.sqrt(sum / hop));
  }
  if (!frames.length) return [];
  const sorted = [...frames].sort((a, b) => a - b);
  const gate = enhanced ? Math.max(0.004, Math.min(sorted[Math.floor(sorted.length * 0.12)] * 2.8, sorted.at(-1) * 0.18)) : 0.009;
  const events = [];
  let lastAttack = -100;
  let envelope = 0;
  const labels = [];
  frames.forEach((level, i) => {
    const attack = level > gate && level > envelope * 1.8 && i - lastAttack >= (enhanced ? 6 : 4);
    if (attack) lastAttack = i;
    envelope = Math.max(level, envelope * 0.84);
    if (mode === 'rhythm') {
      if (attack) events.push({ pitch: 'kick', start: i, end: i + 1, level });
    } else {
      labels.push(level < gate ? null : pitchAt(data, i * hop, rate, enhanced));
    }
  });
  if (mode !== 'rhythm') {
    const stable = labels.map((pitch, i) => enhanced && i > 0 && i + 1 < labels.length && labels[i-1] === labels[i+1] ? labels[i-1] : pitch);
    for (let i = 0; i < stable.length;) {
      const start = i;
      const pitch = stable[i++];
      while (i < stable.length && stable[i] === pitch) i++;
      if (pitch !== null && i - start >= (enhanced ? 4 : 2)) {
        events.push({ pitch, start, end: i, level: Math.max(...frames.slice(start, i)) });
      }
    }
  }
  if (!events.length) return [];
  const scale = hop / rate * bpm * 4 / 60;
  const first = events[0].start;
  return events.map((event, index) => {
    const step = mode === 'pitch' ? index * 4 : Math.round((event.start - first) * scale);
    const length = mode === 'pitch' ? 4 : Math.max(1, Math.round((event.end - event.start) * scale));
    return { pitch: event.pitch, step, length: Math.min(64 - step, length), velocity: Math.min(1, 0.4 + event.level * 2.5) };
  }).filter(note => note.step < 64);
}
